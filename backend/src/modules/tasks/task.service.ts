import { randomInt } from 'crypto';
import { z } from 'zod';
import { LegalDocument, Scenario, TaskTemplate, type TaskTemplateDoc } from '../content/content.model';
import { isTarget, locateQuotes } from '../review/review-engine';
import type { ExtractionKind } from '../review/extraction-engine';
import { splitPhrases } from '../review/mines-engine';
import { startNodeFor } from '../sim/sim-engine';
import { Hearing } from '../hearing/hearing.model';
import { initialState, type HearingScenario } from '../hearing/hearing-engine';
import { InstanceVariant, TaskInstance } from './task.model';
import { Attempt } from '../attempts/attempt.model';
import { SkillRating } from '../gamification/gamification.model';
import { START_RATING, difficultyForRating } from '../gamification/gamification.service';
import { addDays, formatRuDate, isIsoDate, tashkentToday } from '../legal/engines/dates';
import { deadlineFor, feeFor } from '../legal/legal.service';
import { aiAvailable, aiGenerate } from '../ai/ai.service';
import { languageName, loadPrompt, render } from '../ai/prompts';
import { pick, type Locale } from '../../utils/localized';
import { HttpError } from '../../utils/http';
import { logWarn } from '../../logger';
import type { UserDoc } from '../users/user.model';

// ---------- Variable values: picked by code, never by the LLM (PRD 10.4) ----------

const money = (n: number, locale: Locale) =>
    `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ${locale === 'uz' ? "so'm" : 'сум'}`;

export type WorldValues = Record<string, { raw: string | number; display: string }>;

export function pickValues(template: TaskTemplateDoc, today: string, locale: Locale, world: WorldValues = {}) {
    const raw: Record<string, string | number> = {};
    const display: Record<string, string> = {};
    for (const v of template.variablesSchema ?? []) {
        // A case track fixes the value for all its stages (PRD 4.10)
        if (world[v.key]) {
            raw[v.key] = world[v.key].raw;
            display[v.key] = world[v.key].display;
        } else if (v.kind === 'money') {
            const step = Math.max(1, v.step || 1);
            const lo = Math.ceil((v.min || 0) / step);
            const hi = Math.max(lo, Math.floor((v.max || 0) / step));
            const value = randomInt(lo, hi + 1) * step;
            raw[v.key] = value;
            display[v.key] = money(value, locale);
        } else if (v.kind === 'date') {
            const lo = Math.min(v.min || 0, v.max || 0);
            const hi = Math.max(v.min || 0, v.max || 0);
            const value = addDays(today, randomInt(lo, hi + 1));
            raw[v.key] = value;
            display[v.key] = formatRuDate(value);
        } else {
            const options = v.options ?? [];
            if (!options.length) throw new HttpError(400, 'bad_template', `Variable ${v.key} has no options`);
            const chosen = options[randomInt(0, options.length)];
            raw[v.key] = pick(chosen as any, 'ru');
            display[v.key] = pick(chosen as any, locale);
        }
    }
    return { raw, display };
}

export const substitute = (text: string, display: Record<string, string>) =>
    text.replace(/\{\{(\w+)\}\}/g, (m, k) => (display[k] !== undefined ? display[k] : m));

// ---------- Instance generation ----------

export const generatedCaseSchema = z.object({ caseText: z.string().min(50) });
export const clientStorySchema = z.object({ story: z.string().min(50) });

const valuesBlock = (display: Record<string, string>) => Object.entries(display).map(([k, v]) => `${k}: ${v}`).join('\n') || '-';

// Templates whose story the AI rewrites on every start: the drafting and procedural trainers, with or without
// variables (without them the story still changes, the parties, sums and dates stay). The document trainers keep
// the author's text, it is tied to the document markup; the timeline keeps its dates.
const REWRITE_TYPES = new Set(['draft_full', 'draft_part', 'proc_next_step', 'proc_draft']);
export const caseRewritable = (template: TaskTemplateDoc) => REWRITE_TYPES.has(template.taskType) || (template.variablesSchema ?? []).length > 0;

// Every value must stay verbatim in the AI text, otherwise the template text is used
export const keepsValues = (text: string, display: Record<string, string>) => Object.values(display).every(v => text.includes(v));

// The template case and its level are the cached part: every rewrite of one template shares them
export function caseRewriteRequest(template: TaskTemplateDoc, locale: Locale, baseCase: string, display: Record<string, string>, weak: string[]) {
    const prompt = loadPrompt('generate-instance', 2);
    return {
        promptVersion: prompt.version,
        req: {
            task: 'generateInstance' as const,
            ...render(prompt, { caseText: baseCase, difficulty: template.difficulty, language: languageName(locale), values: valuesBlock(display), weakSpots: weak.join(', ') || '-' })
        }
    };
}

// "Where to apply": the LLM writes the client's own words from the facts the client tells without being asked.
// Facts "on request" are not passed, so they cannot leak into the story (PRD 10.2 generateClientStory).
export function clientStoryRequest(template: TaskTemplateDoc, locale: Locale, baseStory: string, display: Record<string, string>) {
    const facts = (template.route?.clientFacts ?? []).filter(f => !f.onRequest).map(f => substitute(pick(f.text as any, locale), display));
    const prompt = loadPrompt('generate-client-story', 2);
    return {
        promptVersion: prompt.version,
        req: {
            task: 'generateClientStory' as const,
            ...render(prompt, {
                story: baseStory,
                facts: facts.map((f, i) => `${i + 1}. ${f}`).join('\n') || '-',
                difficulty: template.difficulty,
                language: languageName(locale),
                values: valuesBlock(display)
            })
        }
    };
}

async function clientStory(template: TaskTemplateDoc, baseStory: string, display: Record<string, string>, locale: Locale, templateId: string) {
    if (!aiAvailable() || !template.aiRewrite) return null;
    const { req, promptVersion } = clientStoryRequest(template, locale, baseStory, display);
    try {
        const res = await aiGenerate({ ...req, promptVersion, schema: clientStorySchema });
        if (keepsValues(res.data.story, display)) return res.data.story;
        logWarn('generateClientStory: the story lost a value, template text used', {}, { templateId });
    } catch (e: any) {
        logWarn('generateClientStory: LLM failed, template text used', {}, { templateId, error: String(e?.message ?? e) });
    }
    return null;
}

export const templateRev = (template: TaskTemplateDoc) => String((template as any).updatedAt?.getTime?.() ?? 0);

// A case prepared by the night batch for this template, language and date: taken once
async function takeVariant(template: TaskTemplateDoc, kind: 'instance' | 'client_story', locale: Locale, today: string) {
    return InstanceVariant.findOneAndDelete(
        { templateId: template._id, templateRev: templateRev(template), kind, locale, today },
        { sort: { createdAt: 1 } }
    ).lean();
}

export interface StageWorld { today: string; values: WorldValues; runId: string; stageKey: string }

export async function generateInstance(templateId: string, user: UserDoc, opts: { assignmentId?: string; isExam?: boolean; world?: StageWorld; locale?: Locale } = {}) {
    const template = await TaskTemplate.findById(templateId);
    if (!template) throw new HttpError(404, 'not_found', 'Template not found');
    if (template.status !== 'published' && user.role === 'student') throw new HttpError(404, 'not_found', 'Template not found');

    const locale = opts.locale ?? ((user.locale as Locale) || 'ru');
    const world = opts.world;
    // A track stage lives on the case calendar
    const today = world?.today || (template.context?.today && isIsoDate(template.context.today) ? template.context.today : tashkentToday());
    let { raw, display } = pickValues(template, today, locale, world?.values ?? {});

    const baseCase = substitute(pick(template.caseText as any, locale), display);
    let caseText = baseCase;
    let generatedByAi = false;
    // A prepared case brings its own values: everything below (engines, instructions) uses them
    const useVariant = (v: { raw: any; display: any; caseText: string }) => {
        raw = v.raw;
        display = v.display;
        caseText = v.caseText;
        generatedByAi = true;
    };

    // The LLM only rewrites the story; every value must stay verbatim, otherwise the template text is used
    // Track stages keep the author's text: a rewritten story could contradict the case folder
    if (world) {
        generatedByAi = false;
    } else if (template.taskType === 'route_and_apply') {
        const variant = template.aiRewrite ? await takeVariant(template, 'client_story', locale, today) : null;
        if (variant) useVariant(variant);
        else {
            const story = await clientStory(template, baseCase, display, locale, templateId);
            if (story) {
                caseText = story;
                generatedByAi = true;
            }
        }
    } else if (aiAvailable() && template.aiRewrite && caseRewritable(template)) {
        const weak = await weakSpots(String(user._id), template.skills.map(s => s.key));
        // A student with repeated errors gets a case written around them; the others take a prepared one
        const variant = weak.length ? null : await takeVariant(template, 'instance', locale, today);
        if (variant) useVariant(variant);
        else {
            const { req, promptVersion } = caseRewriteRequest(template, locale, baseCase, display, weak);
            try {
                const res = await aiGenerate({ ...req, promptVersion, schema: generatedCaseSchema });
                if (keepsValues(res.data.caseText, display)) {
                    caseText = res.data.caseText;
                    generatedByAi = true;
                } else {
                    logWarn('generateInstance: generated case lost a value, template text used', {}, { templateId });
                }
            } catch (e: any) {
                logWarn('generateInstance: LLM failed, template text used', {}, { templateId, error: String(e?.message ?? e) });
            }
        }
    }

    // Scaffold depends on difficulty (PRD 4.0): 1-2 sections with hints, 3 sections only, 4-5 blank page
    // The application in "where to apply" has a scaffold on 1-2 only (PRD 4.5)
    const scaffoldUpTo = template.taskType === 'route_and_apply' ? 2 : 3;
    const scaffold = template.difficulty <= scaffoldUpTo
        ? (template.scaffold ?? []).map(s => ({
            title: pick(s.title as any, locale),
            hint: template.difficulty <= 2 ? pick(s.hint as any, locale) : ''
        }))
        : [];

    const engine = template.taskType === 'proc_timeline'
        ? await timelineExpectations(template, raw)
        : await engineExpectations(template, raw, today);
    const timeline = template.taskType === 'proc_timeline' ? timelineContent(template, raw, locale) : null;
    // proc_draft: from level 3 the student decides which document the situation needs (PRD 4.4)
    const docType = template.taskType === 'proc_draft' ? pick(template.process?.draftDocType as any, locale) : '';
    const hideDocType = template.taskType === 'proc_draft' && template.difficulty >= 3;
    const instructions = hideDocType
        ? (pick(template.process?.instructionsHidden as any, locale) || HIDDEN_DOC_INSTRUCTIONS[locale])
        : pick(template.instructions as any, locale);
    const review = template.taskType === 'mines'
        ? await minesSnapshot(template, locale)
        : template.taskType === 'extraction_compare' ? await extractionSnapshot(template, locale)
            : template.mode === 'review' ? await reviewSnapshot(template, locale) : null;
    const special = template.taskType === 'sim_branching'
        ? await simSnapshot(template)
        : template.taskType === 'sim_hearing' ? await hearingSnapshot(template)
        : template.taskType === 'route_and_apply' ? routeSnapshot(template, display, locale) : null;

    const instance = await TaskInstance.create({
        templateId: template._id,
        userId: user._id,
        assignmentId: opts.assignmentId ?? null,
        isExam: Boolean(opts.isExam),
        runId: world?.runId ?? null,
        stageKey: world?.stageKey ?? '',
        mode: template.mode,
        taskType: template.taskType,
        difficulty: template.difficulty,
        language: locale,
        content: {
            title: pick(template.title as any, locale),
            instructions: substitute(instructions, display),
            role: substitute(pick(template.context?.role as any, locale), display),
            today,
            caseText,
            lockedDocument: template.taskType === 'draft_part' ? substitute(pick(template.lockedDocument as any, locale), display) : '',
            scaffold,
            relatedNorms: (template.relatedNorms ?? []).map(n => ({ code: n.code, article: n.article })),
            generatedByAi,
            ...(review?.content ?? {}),
            ...(special?.content ?? {}),
            ...(timeline ?? {})
        },
        expected: {
            values: { raw, display, ...(docType ? { docType, docTypeHidden: hideDocType } : {}) },
            referenceAnswer: substitute(pick(template.referenceAnswer as any, locale), display),
            checklist: (template.checklist ?? []).map(c => substitute(pick(c as any, locale), display)),
            engine: review?.engine ?? special?.engine ?? engine
        }
    });
    return instance;
}

// Review trainers: the document is copied into the instance; the markup goes to "expected" only
async function reviewSnapshot(template: TaskTemplateDoc, locale: Locale) {
    const doc = await LegalDocument.findById(template.review?.documentId);
    if (!doc) throw new HttpError(400, 'bad_template', 'The template has no document');
    const clientSide = template.review?.clientSide || '';
    const party = (doc.parties ?? []).find(p => p.key === clientSide);
    const flaws = (doc.flaws ?? []).map(f => ({
        id: String(f._id), from: f.from, to: f.to, quote: f.quote, type: f.type, severity: f.severity, badFor: f.badFor,
        normRef: f.normRef, explanation: pick(f.explanation as any, locale), fix: pick(f.fix as any, locale)
    }));
    const edits = (doc.counterpartyEdits ?? []).map(e => ({
        id: String(e._id), from: e.from, to: e.to, quote: e.quote, replacement: e.replacement, badFor: e.badFor,
        explanation: pick(e.explanation as any, locale)
    }));
    const isFix = template.taskType === 'review_fix_check';
    // Court acts: every injected error is a target, the number is known on levels 1-3 (PRD 4.3)
    if (template.taskType === 'review_court_act') {
        const actFlaws = (doc.flaws ?? []).map((f, i) => ({
            ...flaws[i], badFor: 'both', segmentKey: f.segmentKey ?? '',
            expectedValue: { kind: f.expectedValue?.kind ?? 'none', value: f.expectedValue?.value ?? '' }
        }));
        return {
            content: {
                documentTitle: doc.title,
                documentText: doc.text,
                clientSide: '',
                clientSideName: '',
                clientGoals: pick(template.review?.clientGoals as any, locale),
                flawCount: template.difficulty <= 3 ? actFlaws.length : null,
                counterpartyEdits: []
            },
            engine: { kind: 'court_act', clientSide: 'both', flaws: actFlaws, segments: (doc.segments ?? []).map(x => ({ key: x.key, from: x.from, to: x.to })) }
        };
    }
    return {
        content: {
            documentTitle: doc.title,
            documentText: doc.text,
            clientSide,
            clientSideName: party ? pick(party.name as any, locale) : clientSide,
            clientGoals: pick(template.review?.clientGoals as any, locale),
            // PRD 4.0: the number of flaws is known on difficulty 1-2 only
            flawCount: !isFix && template.difficulty <= 2 ? flaws.filter(f => isTarget(f.badFor, clientSide)).length : null,
            counterpartyEdits: isFix ? edits.map(({ id, from, to, quote, replacement }) => ({ id, from, to, quote, replacement })) : []
        },
        engine: isFix ? { kind: 'fix_check', clientSide, edits } : { kind: 'review', clientSide, flaws }
    };
}

const HIDDEN_DOC_INSTRUCTIONS: Record<Locale, string> = {
    ru: 'Определи, какой процессуальный документ требует ситуация, и составь его.',
    uz: "Vaziyat qaysi protsessual hujjatni talab qilishini aniqla va uni tuz."
};

const eventDate = (e: { date?: string | null; dateVar?: string | null }, raw: Record<string, string | number>) =>
    e.dateVar ? String(raw[e.dateVar] ?? '') : (e.date ?? '');

// proc_timeline: the package of documents with dates; the deadlines to compute are named on levels 1-2 only
function timelineContent(template: TaskTemplateDoc, raw: Record<string, string | number>, locale: Locale) {
    const t = template.process?.timeline;
    return {
        timelineEvents: (t?.events ?? []).map(e => ({ key: e.key, title: pick(e.title as any, locale), date: eventDate(e, raw), text: pick(e.text as any, locale) })),
        timelineChecks: template.difficulty <= 2
            ? (t?.checks ?? []).map(c => ({ key: c.key, label: pick(c.label as any, locale), fromEventKey: c.fromEventKey }))
            : []
    };
}

// Last days and violations come from the deadline engine (PRD 4.4, 8.3), never from the LLM
async function timelineExpectations(template: TaskTemplateDoc, raw: Record<string, string | number>) {
    const t = template.process?.timeline;
    const dates = new Map((t?.events ?? []).map(e => [e.key, eventDate(e, raw)]));
    const checks = [];
    for (const c of t?.checks ?? []) {
        const from = dates.get(c.fromEventKey);
        if (!from) throw new HttpError(400, 'bad_template', `Event ${c.fromEventKey} has no date`);
        const r = await deadlineFor({ ruleCode: c.ruleCode, eventDate: from, extensionDays: c.extensionDays || 0 });
        const to = c.toEventKey ? dates.get(c.toEventKey) ?? '' : '';
        checks.push({
            key: c.key, label: pick(c.label as any, 'ru'), fromEventKey: c.fromEventKey, toEventKey: c.toEventKey || '',
            endDate: r.endDate, steps: r.steps, articleRef: r.rule.articleRef,
            // The later event broke the deadline
            violated: Boolean(to && to > r.endDate)
        });
    }
    return { kind: 'timeline', checks, violations: [...new Set(checks.filter(c => c.violated).map(c => c.toEventKey))] };
}

// Extraction of terms (4.8): the package goes to the content, the reference table to "expected" only
async function extractionSnapshot(template: TaskTemplateDoc, locale: Locale) {
    const ex = template.extraction;
    const ids = (ex?.documentIds ?? []).map(String);
    const docs = await LegalDocument.find({ _id: { $in: ids } }).lean();
    const byId = new Map(docs.map(d => [String(d._id), d]));
    if (!ids.length || ids.some(id => !byId.has(id))) throw new HttpError(400, 'bad_template', 'The template has no documents');
    const fields = (ex?.fields ?? []).map(f => ({
        key: f.key, label: pick(f.label as any, locale), kind: f.kind as ExtractionKind,
        // Hints on difficulty 1-2 only (PRD 4.0)
        hint: template.difficulty <= 2 ? pick(f.hint as any, locale) : ''
    }));
    const kindOf = new Map(fields.map(f => [f.key, f.kind]));
    const cells = (ex?.reference ?? []).map(c => {
        const text = byId.get(String(c.documentId))?.text ?? '';
        const range = c.quote ? locateQuotes(text, [c.quote]).ranges[0] : null;
        return { documentId: String(c.documentId), fieldKey: c.fieldKey, kind: kindOf.get(c.fieldKey) ?? 'text', value: c.value ?? '', absent: Boolean(c.absent), quote: c.quote ?? '', range };
    });
    return {
        content: {
            documentTitle: ids.length === 1 ? byId.get(ids[0])!.title : '',
            extraction: { documents: ids.map(id => ({ id, title: byId.get(id)!.title, text: byId.get(id)!.text })), fields }
        },
        engine: { kind: 'extraction', cells }
    };
}

// "Mines": the document is split into phrases; the mines with their options stay in "expected" (PRD 4.7)
async function minesSnapshot(template: TaskTemplateDoc, locale: Locale) {
    const doc = await LegalDocument.findById(template.review?.documentId);
    if (!doc) throw new HttpError(400, 'bad_template', 'The template has no document');
    const mines = (doc.flaws ?? []).map(f => ({
        id: String(f._id), from: f.from, to: f.to, quote: f.quote, type: f.type, severity: f.severity, normRef: f.normRef,
        explanation: pick(f.explanation as any, locale), fix: pick(f.fix as any, locale),
        options: (f.options ?? []).map(o => ({ text: o.text, correct: Boolean(o.correct) }))
    }));
    const simplified = template.difficulty <= 2;
    return {
        content: {
            documentTitle: doc.title,
            documentText: doc.text,
            flawCount: simplified ? mines.length : null,
            mines: { segments: splitPhrases(doc.text), clicks: [], timerSec: template.timerSec || 0, startedAt: new Date(), simplified }
        },
        engine: { kind: 'mines', mines, simplified }
    };
}

// Simulation: the whole scenario goes to "expected"; the student is served one node at a time
async function simSnapshot(template: TaskTemplateDoc) {
    const scenario = await Scenario.findById(template.sim?.scenarioId).lean();
    if (!scenario) throw new HttpError(400, 'bad_template', 'The template has no scenario');
    const roles = (scenario.roles ?? []).map(r => ({ key: r.key, name: r.name }));
    const preset = template.sim?.role || (roles.length === 1 ? roles[0].key : '');
    const snapshot = {
        startNodeId: scenario.startNodeId,
        roles: (scenario.roles ?? []).map(r => ({ key: r.key, name: r.name, startNodeId: r.startNodeId ?? '' })),
        nodes: (scenario.nodes ?? []).map(n => ({
            id: n.id, stage: n.stage ?? '', speaker: n.speaker ?? '', text: n.text, freeTextRubric: n.freeTextRubric ?? '', outcome: n.outcome ?? '',
            choices: (n.choices ?? []).map(c => ({ id: c.id, text: c.text, next: c.next ?? '', verdict: c.verdict, explanation: c.explanation ?? '', normRef: c.normRef ?? '' }))
        }))
    };
    return {
        content: {
            documentTitle: scenario.title,
            sim: {
                role: preset,
                roleName: roles.find(r => r.key === preset)?.name ?? '',
                roles,
                currentNodeId: preset ? startNodeFor(snapshot, preset) : '',
                history: [],
                finished: false
            }
        },
        engine: { kind: 'sim', scenario: snapshot }
    };
}

// Hearing simulation: the scenario with personas and hidden facts goes to "expected", the student gets the stages and the transcript
async function hearingSnapshot(template: TaskTemplateDoc) {
    const h = await Hearing.findById(template.hearing?.scenarioId).lean();
    if (!h) throw new HttpError(400, 'bad_template', 'The template has no hearing scenario');
    const scenario: HearingScenario = {
        title: h.title, language: h.language as 'ru' | 'uz', court: h.court ?? '', caseNumber: h.caseNumber ?? '', caseText: h.caseText ?? '',
        hiddenFacts: h.hiddenFacts ?? '', decisionGuide: h.decisionGuide ?? '',
        studentRole: { name: h.studentRole?.name ?? '', goal: h.studentRole?.goal ?? '' },
        participants: (h.participants ?? []).map(p => ({ key: p.key, name: p.name, role: p.role ?? 'other', persona: p.persona ?? '' })),
        stages: (h.stages ?? []).map(st => ({ key: st.key, title: st.title, goal: st.goal ?? '', studentTask: st.studentTask ?? '', opening: st.opening ?? '', openingBy: st.openingBy ?? '', maxTurns: st.maxTurns ?? 4 })),
        criteria: (h.criteria ?? []).map(c => ({ key: c.key, title: c.title, description: c.description ?? '' }))
    };
    return {
        content: { documentTitle: h.title, hearing: initialState(scenario) },
        engine: { kind: 'hearing', scenario }
    };
}

// "Where to apply": routes and all facts go to "expected"; the client answers questions from the facts
function routeSnapshot(template: TaskTemplateDoc, display: Record<string, string>, locale: Locale) {
    const r = template.route;
    return {
        content: { clientDialog: [] },
        engine: {
            kind: 'route',
            facts: (r?.clientFacts ?? []).map(f => ({ key: f.key, text: substitute(pick(f.text as any, locale), display), onRequest: Boolean(f.onRequest) })),
            routes: (r?.acceptableRoutes ?? []).map(x => ({
                score: x.score,
                comment: pick(x.comment as any, locale),
                steps: (x.steps ?? []).map(st => ({ bodyCode: st.bodyCode, basis: st.basis ?? '', deadline: pick(st.deadline as any, locale), pretrial: Boolean(st.pretrial) }))
            }))
        }
    };
}

// Expected requisites computed by the engines from the code-picked values
async function engineExpectations(template: TaskTemplateDoc, raw: Record<string, string | number>, today: string) {
    if (template.taskType === 'proc_next_step') return processExpectations(template, raw, today);
    const check = template.deterministicCheck;
    if (!check || check.kind !== 'claim_requisites') return null;
    const p = check.params ?? ({} as any);
    const amount = p.amountVar ? Number(raw[p.amountVar]) : (p.amount ?? null);
    // Empty filing date = the task's "today", as the template editor says
    const filingDate = p.filingDateVar ? String(raw[p.filingDateVar]) : (p.filingDate || today);
    let fee = null;
    if (amount != null && filingDate && p.feeRateCode) {
        fee = await feeFor({ rateCode: p.feeRateCode, filingDate, amount, isSme: Boolean(p.isSme) });
    }
    return {
        kind: 'claim_requisites',
        amount,
        filingDate,
        fee: fee?.fee ?? null,
        feeSteps: fee?.steps ?? [],
        acceptableCourts: (p.acceptableCourts ?? []).filter(Boolean)
    };
}

// Procedural card: the right court, last day and fee come from the engines, never from the LLM (PRD 10.4)
async function processExpectations(template: TaskTemplateDoc, raw: Record<string, string | number>, today: string) {
    const p = template.process;
    let deadline = null;
    if (p?.deadline?.ruleCode) {
        // Empty event date = the task's "today" (the day the court act in the case was made)
        const eventDate = p.deadline.eventDateVar ? String(raw[p.deadline.eventDateVar]) : (p.deadline.eventDate || today);
        const r = await deadlineFor({ ruleCode: p.deadline.ruleCode, eventDate, extensionDays: p.deadline.extensionDays || 0 });
        deadline = { endDate: r.endDate, steps: r.steps, ruleCode: p.deadline.ruleCode, articleRef: r.rule.articleRef, eventDate };
    }
    let fee = null;
    if (p?.fee?.rateCode) {
        const amount = p.fee.amountVar ? Number(raw[p.fee.amountVar]) : (p.fee.amount ?? undefined);
        const filingDate = p.fee.filingDateVar ? String(raw[p.fee.filingDateVar]) : today;
        const r = await feeFor({ rateCode: p.fee.rateCode, filingDate, amount, isSme: Boolean(p.fee.isSme), instance: p.fee.instance as any });
        fee = { fee: r.fee, steps: r.steps };
    }
    return { kind: 'process', courts: (p?.acceptableCourts ?? []).filter(Boolean), deadline, fee };
}

// Error types repeated by the student in these skills - passed to generation
async function weakSpots(userId: string, skillKeys: string[]) {
    const ratings = await SkillRating.find({ userId, skillKey: { $in: skillKeys } }).lean();
    const counts: Record<string, number> = {};
    for (const r of ratings) for (const t of (r.recentErrors ?? []).slice(0, 10)) counts[t] = (counts[t] || 0) + 1;
    return Object.entries(counts).filter(([, c]) => c >= 2).map(([t]) => t);
}

// ---------- Next task selection (PRD 6.3) ----------

export async function selectTemplate(user: UserDoc, filter: { mode?: string; skillKey?: string }) {
    const query: Record<string, unknown> = { status: 'published' };
    if (filter.mode) query.mode = filter.mode;
    if (filter.skillKey) query['skills.key'] = filter.skillKey;
    const templates = await TaskTemplate.find(query).lean();
    if (!templates.length) return null;

    const allSkills = [...new Set(templates.flatMap(t => t.skills.map(s => s.key)))];
    const ratings = await SkillRating.find({ userId: user._id, skillKey: { $in: allSkills } }).lean();
    const byKey = new Map(ratings.map(r => [r.skillKey, r]));
    const start = START_RATING[user.startLevel ?? 'beginner'] ?? 900;

    // Skill: 60% weakest, 25% not trained for 7+ days, 15% new
    let skill = filter.skillKey;
    if (!skill) {
        const trained = allSkills.filter(k => byKey.has(k));
        const fresh = allSkills.filter(k => !byKey.has(k));
        const stale = trained.filter(k => (byKey.get(k)!.lastAt?.getTime() ?? 0) < Date.now() - 7 * 86400000);
        const roll = randomInt(0, 100);
        if (roll < 60 && trained.length) skill = trained.sort((a, b) => byKey.get(a)!.rating - byKey.get(b)!.rating)[0];
        else if (roll < 85 && stale.length) skill = stale[randomInt(0, stale.length)];
        else if (fresh.length) skill = fresh[randomInt(0, fresh.length)];
        else skill = allSkills[randomInt(0, allSkills.length)];
    }

    const rating = byKey.get(skill!)?.rating ?? start;
    const targetDifficulty = difficultyForRating(rating);
    const withSkill = templates.filter(t => t.skills.some(s => s.key === skill));
    const pool = withSkill.length ? withSkill : templates;

    // Closest difficulty, excluding templates done in the last 14 days when possible
    const recent = await TaskInstance.find({ userId: user._id, createdAt: { $gte: new Date(Date.now() - 14 * 86400000) } }).distinct('templateId');
    const recentSet = new Set(recent.map(String));
    const notRecent = pool.filter(t => !recentSet.has(String(t._id)));
    const candidates = notRecent.length ? notRecent : pool;
    const minGap = Math.min(...candidates.map(t => Math.abs(t.difficulty - targetDifficulty)));
    const closest = candidates.filter(t => Math.abs(t.difficulty - targetDifficulty) === minGap);
    return closest[randomInt(0, closest.length)];
}

// Has the student already submitted the first iteration of this instance?
export async function iterationInfo(instanceId: string) {
    const attempts = await Attempt.find({ instanceId }).sort({ iteration: 1 }).lean();
    return attempts;
}

// Exam instances of a user whose results are still hidden (PRD 5.3) - lists must not show their scores
export async function hiddenExamInstanceIds(userId: string, instanceIds: unknown[]) {
    const { Assignment } = await import('../users/user.model');
    const exams = await TaskInstance.find({ _id: { $in: instanceIds }, userId, isExam: true }).select('assignmentId').lean();
    if (!exams.length) return new Set<string>();
    const published = new Set((await Assignment.find({ _id: { $in: exams.map(e => e.assignmentId) }, resultsPublished: true }).select('_id').lean()).map(a => String(a._id)));
    return new Set(exams.filter(e => !published.has(String(e.assignmentId))).map(e => String(e._id)));
}
