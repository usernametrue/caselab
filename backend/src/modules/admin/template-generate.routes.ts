import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../../utils/http';
import { validateBody } from '../../middleware/validate';
import { Skill, TaskTemplate, modeOfTaskType } from '../content/content.model';
import { Body, Court, DeadlineRule, FeeRate } from '../legal/legal.model';
import { aiAvailable } from '../ai/ai.service';
import { registerJobHandler, runOrQueue } from '../ai/batch';
import { languageName, loadPrompt, render } from '../ai/prompts';
import { checkTemplateLinks, templateZod } from './admin.routes';

// PRD 10.2 generateTemplate: a draft template by topic, skills and task type. Admin only (mounted under the admin router).
const router = Router();

// The review trainers and "mines" use the document markup as the reference (generateFlawedDocument), the simulation - a scenario
export const GENERATABLE_TYPES = ['draft_full', 'draft_part', 'proc_next_step', 'proc_draft', 'proc_timeline', 'route_and_apply'] as const;

const TYPE_DESCRIPTIONS: Record<typeof GENERATABLE_TYPES[number], string> = {
    draft_full: 'студент составляет документ целиком (иск, претензию, отзыв, ходатайство) по казусу',
    draft_part: 'студент пишет часть готового документа (просительную часть, предмет договора), остальной документ заблокирован',
    proc_next_step: 'процессуальная карточка: следующее действие, суд, последний день срока и госпошлина с расчетом',
    proc_draft: 'документ, который требует процессуальная ситуация; с уровня 3 вид документа не называется',
    proc_timeline: 'хронология дела: пакет документов с датами, студент считает сроки и находит нарушения',
    route_and_apply: 'клиент рассказывает ситуацию обыденным языком, студент выясняет факты, строит маршрут обращения по органам и пишет обращение'
};

const generateZod = z.object({
    taskType: z.enum(GENERATABLE_TYPES),
    topic: z.string().trim().min(5).max(500),
    skills: z.array(z.string().min(1)).min(1).max(3),
    difficulty: z.coerce.number().int().min(1).max(5).default(3),
    language: z.enum(['ru', 'uz'])
});

const KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const generatedZod = z.object({
    title: z.string().min(3),
    instructions: z.string().min(10),
    role: z.string(),
    caseText: z.string().min(50),
    variables: z.array(z.object({
        key: z.string(),
        kind: z.enum(['money', 'date', 'choice']),
        label: z.string(),
        min: z.number(),
        max: z.number(),
        step: z.number(),
        options: z.array(z.string()).max(6)
    })).max(10),
    referenceAnswer: z.string(),
    checklist: z.array(z.string()).max(12),
    relatedNorms: z.array(z.object({ code: z.string(), article: z.string() })).max(10),
    scaffold: z.array(z.object({ title: z.string(), hint: z.string() })).max(12),
    lockedDocument: z.string(),
    acceptableCourts: z.array(z.string()).max(4),
    deadlineRuleCode: z.string(),
    eventDateVar: z.string(),
    feeRateCode: z.string(),
    feeAmountVar: z.string(),
    draftDocType: z.string(),
    instructionsHidden: z.string(),
    timelineEvents: z.array(z.object({ key: z.string(), title: z.string(), date: z.string(), dateVar: z.string(), text: z.string() })).max(15),
    timelineChecks: z.array(z.object({ key: z.string(), label: z.string(), fromEventKey: z.string(), ruleCode: z.string(), toEventKey: z.string() })).max(8),
    clientFacts: z.array(z.object({ key: z.string(), text: z.string(), onRequest: z.boolean() })).max(15),
    routes: z.array(z.object({
        score: z.number(),
        comment: z.string(),
        steps: z.array(z.object({ bodyCode: z.string(), basis: z.string(), deadline: z.string(), pretrial: z.boolean() })).max(8)
    })).max(4)
});
type Generated = z.infer<typeof generatedZod>;

// The draft is saved even when it is incomplete: the editor shows what to fix before publishing (PRD 10.4)
interface TemplateMeta { body: z.infer<typeof generateZod> }

async function saveTemplate(meta: TemplateMeta, data: Generated, job: { createdBy: unknown; organizationId: unknown }) {
    const body = meta.body;
    // Codes are checked against the dictionaries as they are when the answer comes
    const [rules, rates, bodies] = await Promise.all([
        DeadlineRule.find().select('code').lean(),
        FeeRate.find().select('code').lean(),
        body.taskType === 'route_and_apply' ? Body.find().select('code').lean() : Promise.resolve([] as any[])
    ]);
    const draft = buildTemplate(body, data, {
        ruleCodes: new Set(rules.map(r => r.code)),
        rateCodes: new Set(rates.map(r => r.code)),
        bodyCodes: new Set(bodies.map(b => b.code))
    });
    // What the editor will refuse on save is reported now; the draft keeps whatever the AI gave
    const problems: { path: (string | number)[]; message: string }[] = [];
    const parsed = templateZod.safeParse(draft);
    if (parsed.success) {
        try {
            await checkTemplateLinks(parsed.data);
        } catch (e: any) {
            if (e instanceof HttpError && Array.isArray(e.details)) problems.push(...(e.details as any[]));
            else throw e;
        }
    } else {
        problems.push(...parsed.error.issues.map(i => ({ path: i.path as (string | number)[], message: i.message })));
    }
    const template = await TaskTemplate.create({
        ...(parsed.success ? parsed.data : draft),
        mode: modeOfTaskType(body.taskType), status: 'draft', source: 'ai',
        authorId: job.createdBy, organizationId: job.organizationId
    });
    return { template: { _id: String(template._id) }, problems };
}
registerJobHandler('generate_template', { schema: generatedZod, onResult: saveTemplate });

router.post('/', validateBody(generateZod), asyncHandler(async (req, res) => {
    if (!aiAvailable()) throw new HttpError(503, 'llm_not_configured', 'ANTHROPIC_API_KEY is not set');
    const body = req.body as z.infer<typeof generateZod>;
    const [skills, rules, rates, courts, bodies] = await Promise.all([
        Skill.find({ key: { $in: body.skills } }).lean(),
        DeadlineRule.find().select('code name').sort({ code: 1 }).lean(),
        FeeRate.find().select('code name').sort({ code: 1 }).lean(),
        Court.find().select('name').sort({ level: 1, _id: 1 }).limit(300).lean(),
        body.taskType === 'route_and_apply' ? Body.find().select('code name kind').sort({ code: 1 }).limit(600).lean() : Promise.resolve([] as any[])
    ]);
    if (skills.length !== body.skills.length) throw new HttpError(400, 'validation_error', 'Unknown skill', [{ path: ['skills'], message: 'Unknown skill' }]);
    const lang = body.language;
    const nameOf = (n: any) => n?.[lang] || n?.ru || n?.uz || '';

    const prompt = loadPrompt('generate-template', 2);
    let out;
    try {
        // The dictionaries are the cached part (sorted, so the text is the same between drafts)
        out = await runOrQueue('generate_template', {
            task: 'generateTemplate',
            ...render(prompt, {
                courts: courts.map(c => nameOf(c.name)).filter(Boolean).join('\n') || '-',
                deadlineRules: rules.map(r => `${r.code} (${nameOf(r.name)})`).join('\n'),
                feeRates: rates.map(r => `${r.code} (${nameOf(r.name)})`).join('\n'),
                bodies: bodies.length ? bodies.map(b => `${b.code} (${nameOf(b.name)})`).join('\n') : '-',
                taskType: body.taskType,
                taskTypeDescription: TYPE_DESCRIPTIONS[body.taskType],
                difficulty: body.difficulty,
                skills: skills.map(s => `${s.key} (${nameOf(s.name)})`).join(', '),
                topic: body.topic,
                language: languageName(lang)
            })
        }, { promptVersion: prompt.version, meta: { body }, label: body.topic, createdBy: req.user!.id, organizationId: req.user!.organizationId });
    } catch {
        throw new HttpError(502, 'llm_failed', 'The LLM could not generate the template, try again');
    }
    if (out.queued) return res.status(202).json({ job: out.job });
    const r = out.result as Awaited<ReturnType<typeof saveTemplate>>;
    res.status(201).json({ template: await TaskTemplate.findById(r.template._id).lean(), problems: r.problems });
}));

// AI output -> template body in the shape of templateZod; keys and codes the code cannot trust are dropped
export function buildTemplate(
    body: z.infer<typeof generateZod>,
    d: Generated,
    dict: { ruleCodes: Set<string>; rateCodes: Set<string>; bodyCodes: Set<string> }
) {
    const lang = body.language;
    const L = (s: string) => ({ ru: lang === 'ru' ? s : '', uz: lang === 'uz' ? s : '' });
    const t = body.taskType;

    const seen = new Set<string>();
    const variablesSchema = d.variables.filter(v => KEY.test(v.key) && v.key !== 'PART' && !seen.has(v.key) && seen.add(v.key)).map(v => {
        if (v.kind === 'choice') return { key: v.key, kind: 'choice' as const, label: v.label, min: 0, max: 0, step: 1, options: v.options.filter(Boolean).map(L) };
        const [min, max] = v.min <= v.max ? [v.min, v.max] : [v.max, v.min];
        return { key: v.key, kind: v.kind, label: v.label, min: Math.round(min), max: Math.round(max), step: Math.max(1, Math.round(v.step || 1)), options: [] };
    }).filter(v => v.kind !== 'choice' || v.options.length);
    const varKeys = new Set(variablesSchema.map(v => v.key));
    const varOfKind = (k: string, kind: string) => (variablesSchema.some(v => v.key === k && v.kind === kind) ? k : '');
    // Placeholders without a variable become plain words, so the template passes the placeholder check
    const strip = (s: string, keep: string[] = []) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => (varKeys.has(k) || keep.includes(k) ? m : k));

    const amountVar = varOfKind(d.feeAmountVar, 'money');
    const courts = d.acceptableCourts.map(c => c.trim()).filter(Boolean);
    const eventKeys = new Set<string>();
    const events = t === 'proc_timeline' ? d.timelineEvents.filter(e => KEY.test(e.key) && !eventKeys.has(e.key) && eventKeys.add(e.key)).map(e => ({
        key: e.key, title: L(e.title), date: ISO.test(e.date) ? e.date : '', dateVar: varOfKind(e.dateVar, 'date'), text: L(strip(e.text))
    })) : [];
    const checks = t === 'proc_timeline' ? d.timelineChecks.filter(c => eventKeys.has(c.fromEventKey) && dict.ruleCodes.has(c.ruleCode)).map((c, i) => ({
        key: c.key || `check${i + 1}`, label: L(c.label), fromEventKey: c.fromEventKey, ruleCode: c.ruleCode,
        toEventKey: eventKeys.has(c.toEventKey) ? c.toEventKey : '', extensionDays: 0
    })) : [];
    const factKeys = new Set<string>();
    const clientFacts = t === 'route_and_apply' ? d.clientFacts.map(f => ({ ...f, key: f.key.toLowerCase() })).filter(f => /^[a-z][a-z0-9_]*$/.test(f.key) && f.text && !factKeys.has(f.key) && factKeys.add(f.key)).map(f => ({ key: f.key, text: L(f.text), onRequest: f.onRequest })) : [];
    const acceptableRoutes = t === 'route_and_apply' ? d.routes.map(r => ({
        score: (r.score >= 85 ? 100 : 70) as 100 | 70,
        comment: L(r.comment),
        steps: r.steps.filter(s => dict.bodyCodes.has(s.bodyCode)).map(s => ({ bodyCode: s.bodyCode, basis: s.basis.slice(0, 500), deadline: L(s.deadline), pretrial: s.pretrial }))
    })).filter(r => r.steps.length) : [];

    return {
        taskType: t,
        skills: body.skills.map(key => ({ key, weight: 1 })),
        difficulty: body.difficulty,
        title: L(d.title),
        instructions: L(strip(d.instructions)),
        context: { role: L(d.role), today: '' },
        caseText: L(strip(d.caseText)),
        variablesSchema,
        lockedDocument: L(t === 'draft_part' ? strip(d.lockedDocument, ['PART']) : ''),
        scaffold: t.startsWith('draft') || t === 'proc_draft' ? d.scaffold.filter(s => s.title).map(s => ({ title: L(s.title), hint: L(s.hint) })) : [],
        relatedNorms: d.relatedNorms.filter(n => n.code.trim() && n.article.trim()).map(n => ({ code: n.code.trim(), article: n.article.trim() })),
        referenceAnswer: L(d.referenceAnswer),
        checklist: d.checklist.filter(Boolean).map(L),
        process: {
            acceptableCourts: t === 'proc_next_step' ? courts : [],
            deadline: {
                ruleCode: t === 'proc_next_step' && dict.ruleCodes.has(d.deadlineRuleCode) ? d.deadlineRuleCode : '',
                eventDateVar: t === 'proc_next_step' ? varOfKind(d.eventDateVar, 'date') : '', eventDate: '', extensionDays: 0
            },
            fee: {
                rateCode: t === 'proc_next_step' && dict.rateCodes.has(d.feeRateCode) ? d.feeRateCode : '',
                amountVar: t === 'proc_next_step' ? amountVar : '', amount: null, filingDateVar: '', isSme: false, instance: 'first' as const
            },
            draftDocType: L(t === 'proc_draft' ? d.draftDocType : ''),
            instructionsHidden: L(t === 'proc_draft' ? strip(d.instructionsHidden) : ''),
            timeline: { events, checks }
        },
        deterministicCheck: t === 'draft_full' && (courts.length || amountVar)
            ? { kind: 'claim_requisites' as const, params: { amountVar, amount: null, filingDateVar: '', filingDate: '', feeRateCode: dict.rateCodes.has(d.feeRateCode) ? d.feeRateCode : 'property', isSme: false, acceptableCourts: courts } }
            : { kind: 'none' as const, params: { amountVar: '', amount: null, filingDateVar: '', filingDate: '', feeRateCode: 'property', isSme: false, acceptableCourts: [] } },
        route: { clientFacts, acceptableRoutes },
        aiRewrite: true,
        status: 'draft' as const
    };
}

export default router;
