import { Router } from 'express';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { ROLES, User, toPublicUser } from '../users/user.model';
import { BCRYPT_COST } from '../auth/auth.routes';
import { EXTRACTION_KINDS, LegalDocument, MODES, Scenario, Skill, TASK_TYPES, TaskTemplate, modeOfTaskType } from '../content/content.model';
import { locateQuotes } from '../review/review-engine';
import { validValue } from '../review/extraction-engine';
import documentRoutes from './documents.routes';
import scenarioRoutes from './scenarios.routes';
import importRoutes from './import.routes';
import trackAdminRoutes from '../tracks/track-admin.routes';
import templateGenerateRoutes from './template-generate.routes';
import aiRoutes from './ai.routes';
import hearingAdminRoutes from './hearings.routes';
import usageRoutes from './usage.routes';
import { Hearing } from '../hearing/hearing.model';
import { REGISTER_SITE, bodyExists, fetchRegisterOrgs, upsertRegisterBodies } from '../legal/bodies-import';
import { BrvValue, Body, CalendarDay, Court, DeadlineRule, FeeRate, Norm } from '../legal/legal.model';
import { Attempt, CRITERIA, ScoringConfig } from '../attempts/attempt.model';
import { DEFAULT_WEIGHTS } from '../attempts/evaluation.service';
import { TaskInstance } from '../tasks/task.model';
import { requeue } from '../../jobs/evaluate-attempt.job';
import { localizedZod } from '../../utils/localized';
import { AuditLog } from './audit';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- ADM-1: accounts ----------

router.get('/users', asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (typeof req.query.role === 'string' && (ROLES as readonly string[]).includes(req.query.role)) filter.role = req.query.role;
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
        const rx = new RegExp(escapeRegex(req.query.q.trim()), 'i');
        filter.$or = [{ email: rx }, { fullName: rx }];
    }
    const users = await User.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ users: users.map(toPublicUser) });
}));

const tempPassword = () => randomBytes(9).toString('base64url');

const createUserSchema = z.object({
    email: z.email(),
    fullName: z.string().trim().min(3).max(120),
    role: z.enum(ROLES),
    locale: z.enum(['ru', 'uz']).default('ru'),
    course: z.coerce.number().int().min(1).max(6).optional()
});

// Created with a temporary password that must be changed at the first login
router.post('/users', validateBody(createUserSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createUserSchema>;
    const password = tempPassword();
    const user = await User.create({
        ...body,
        email: body.email.toLowerCase(),
        organizationId: req.user!.organizationId,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        mustChangePassword: true
    });
    res.status(201).json({ user: toPublicUser(user), temporaryPassword: password });
}));

const patchUserSchema = z.object({
    role: z.enum(ROLES).optional(),
    isBlocked: z.boolean().optional(),
    fullName: z.string().trim().min(3).max(120).optional(),
    resetPassword: z.boolean().optional()
});

router.patch('/users/:id', validateBody(patchUserSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof patchUserSchema>;
    const user = await User.findById(req.params.id);
    if (!user) throw notFound('User');
    if (String(user._id) === req.user!.id && (body.role && body.role !== 'admin' || body.isBlocked)) {
        throw new HttpError(400, 'self_lockout', 'You cannot remove your own admin role or block yourself');
    }
    if (body.role) user.role = body.role;
    if (body.fullName) user.fullName = body.fullName;
    if (body.isBlocked !== undefined) {
        user.isBlocked = body.isBlocked;
        if (body.isBlocked) user.tokenVersion += 1;
    }
    let temporaryPassword: string | undefined;
    // AUTH-6: manual reset - temporary password and a forced change at login
    if (body.resetPassword) {
        temporaryPassword = tempPassword();
        user.passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
        user.mustChangePassword = true;
        user.tokenVersion += 1;
    }
    await user.save();
    res.json({ user: toPublicUser(user), temporaryPassword });
}));

// ---------- ADM-3: task templates ----------

const variableZod = z.object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
    kind: z.enum(['money', 'date', 'choice']),
    label: z.string().default(''),
    min: z.coerce.number().default(0),
    max: z.coerce.number().default(0),
    step: z.coerce.number().min(1).default(1),
    options: z.array(localizedZod).default([])
});

export const templateZod = z.object({
    taskType: z.enum(TASK_TYPES),
    branch: z.string().default('economic'),
    jurisdiction: z.string().default('UZ'),
    skills: z.array(z.object({ key: z.string().min(1), weight: z.coerce.number().min(0).max(1).default(1) })).min(1).max(3),
    difficulty: z.coerce.number().int().min(1).max(5),
    title: localizedZod,
    instructions: localizedZod,
    context: z.object({
        role: localizedZod.default({ ru: '', uz: '' }),
        today: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default('')
    }).default({ role: { ru: '', uz: '' }, today: '' }),
    caseText: localizedZod,
    variablesSchema: z.array(variableZod).default([]),
    lockedDocument: localizedZod.default({ ru: '', uz: '' }),
    scaffold: z.array(z.object({ title: localizedZod, hint: localizedZod.default({ ru: '', uz: '' }) })).default([]),
    relatedNorms: z.array(z.object({ code: z.string().min(1), article: z.string().min(1) })).default([]),
    referenceAnswer: localizedZod.default({ ru: '', uz: '' }),
    checklist: z.array(localizedZod).default([]),
    review: z.object({
        documentId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
        clientSide: z.string().default(''),
        clientGoals: localizedZod.default({ ru: '', uz: '' })
    }).default({ documentId: null, clientSide: '', clientGoals: { ru: '', uz: '' } }),
    process: z.object({
        acceptableCourts: z.array(z.string()).default([]),
        deadline: z.object({
            ruleCode: z.string().default(''),
            eventDateVar: z.string().default(''),
            eventDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(''),
            extensionDays: z.coerce.number().int().min(0).default(0)
        }).default({ ruleCode: '', eventDateVar: '', eventDate: '', extensionDays: 0 }),
        fee: z.object({
            rateCode: z.string().default(''),
            amountVar: z.string().default(''),
            amount: z.coerce.number().nullable().default(null),
            filingDateVar: z.string().default(''),
            isSme: z.boolean().default(false),
            instance: z.enum(['first', 'appeal', 'cassation', 'revision']).default('first')
        }).default({ rateCode: '', amountVar: '', amount: null, filingDateVar: '', isSme: false, instance: 'first' }),
        draftDocType: localizedZod.default({ ru: '', uz: '' }),
        instructionsHidden: localizedZod.default({ ru: '', uz: '' }),
        timeline: z.object({
            events: z.array(z.object({
                key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Event key: latin letters, digits, _'),
                title: localizedZod,
                date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(''),
                dateVar: z.string().default(''),
                text: localizedZod.default({ ru: '', uz: '' })
            })).max(30).default([]),
            checks: z.array(z.object({
                key: z.string().min(1).max(60),
                label: localizedZod.default({ ru: '', uz: '' }),
                fromEventKey: z.string().min(1),
                ruleCode: z.string().min(1),
                toEventKey: z.string().default(''),
                extensionDays: z.coerce.number().int().min(0).default(0)
            })).max(20).default([])
        }).default({ events: [], checks: [] })
    }).default({
        acceptableCourts: [], deadline: { ruleCode: '', eventDateVar: '', eventDate: '', extensionDays: 0 }, fee: { rateCode: '', amountVar: '', amount: null, filingDateVar: '', isSme: false, instance: 'first' },
        draftDocType: { ru: '', uz: '' }, instructionsHidden: { ru: '', uz: '' }, timeline: { events: [], checks: [] }
    }),
    rubric: z.record(z.string(), localizedZod).nullable().default(null),
    deterministicCheck: z.object({
        kind: z.enum(['none', 'claim_requisites']).default('none'),
        params: z.object({
            amountVar: z.string().default(''),
            amount: z.coerce.number().nullable().default(null),
            filingDateVar: z.string().default(''),
            filingDate: z.string().default(''),
            feeRateCode: z.string().default('property'),
            isSme: z.boolean().default(false),
            acceptableCourts: z.array(z.string()).default([])
        }).default({ amountVar: '', amount: null, filingDateVar: '', filingDate: '', feeRateCode: 'property', isSme: false, acceptableCourts: [] })
    }).default({ kind: 'none', params: { amountVar: '', amount: null, filingDateVar: '', filingDate: '', feeRateCode: 'property', isSme: false, acceptableCourts: [] } }),
    route: z.object({
        clientFacts: z.array(z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Fact key: latin letters, digits, _'),
            text: localizedZod,
            onRequest: z.boolean().default(false)
        })).max(30).default([]),
        acceptableRoutes: z.array(z.object({
            score: z.union([z.literal(100), z.literal(70)]).default(100),
            comment: localizedZod.default({ ru: '', uz: '' }),
            steps: z.array(z.object({
                bodyCode: z.string().min(1),
                basis: z.string().max(500).default(''),
                deadline: localizedZod.default({ ru: '', uz: '' }),
                pretrial: z.boolean().default(false)
            })).min(1).max(8)
        })).max(10).default([])
    }).default({ clientFacts: [], acceptableRoutes: [] }),
    sim: z.object({
        scenarioId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
        role: z.string().default('')
    }).default({ scenarioId: null, role: '' }),
    hearing: z.object({
        scenarioId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null)
    }).default({ scenarioId: null }),
    // Extraction of terms (4.8): the package, the terms and the reference value of every term in every document
    extraction: z.object({
        documentIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(5).default([]),
        fields: z.array(z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Term key: latin letters, digits, _'),
            label: localizedZod,
            kind: z.enum(EXTRACTION_KINDS).default('text'),
            hint: localizedZod.default({ ru: '', uz: '' })
        })).max(15).default([]),
        reference: z.array(z.object({
            documentId: z.string().regex(/^[a-f0-9]{24}$/),
            fieldKey: z.string().min(1),
            value: z.string().trim().max(2000).default(''),
            absent: z.boolean().default(false),
            quote: z.string().max(3000).default('')
        })).max(75).default([])
    }).default({ documentIds: [], fields: [], reference: [] }),
    timerSec: z.coerce.number().int().min(0).max(7200).default(0),
    weightsOverride: z.record(z.string(), z.number().min(0)).nullable().default(null),
    aiRewrite: z.boolean().default(true),
    status: z.enum(['draft', 'review', 'published']).default('draft')
}).superRefine((t, ctx) => {
    // Every {{placeholder}} in the case must have a variable, and every variable referenced by the check must exist
    const keys = new Set(t.variablesSchema.map(v => v.key));
    const used = [...`${t.caseText.ru} ${t.caseText.uz} ${t.instructions.ru} ${t.instructions.uz}`.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).filter(k => k !== 'PART');
    for (const k of used) if (!keys.has(k)) ctx.addIssue({ code: 'custom', path: ['variablesSchema'], message: `Placeholder {{${k}}} has no variable` });
    const p = t.deterministicCheck.params;
    for (const k of [p.amountVar, p.filingDateVar].filter(Boolean)) {
        if (!keys.has(k)) ctx.addIssue({ code: 'custom', path: ['deterministicCheck'], message: `Variable ${k} is not defined` });
    }
    if (t.taskType === 'draft_part' && !`${t.lockedDocument.ru}${t.lockedDocument.uz}`.includes('{{PART}}')) {
        ctx.addIssue({ code: 'custom', path: ['lockedDocument'], message: 'draft_part needs {{PART}} in the locked document' });
    }
    if (!t.title.ru && !t.title.uz) ctx.addIssue({ code: 'custom', path: ['title'], message: 'Title is required' });
    if (!t.caseText.ru && !t.caseText.uz) ctx.addIssue({ code: 'custom', path: ['caseText'], message: 'Case text is required' });
    const needsReference = t.taskType.startsWith('draft') || ['proc_next_step', 'proc_draft', 'route_and_apply'].includes(t.taskType);
    if (needsReference && !t.referenceAnswer.ru && !t.referenceAnswer.uz) ctx.addIssue({ code: 'custom', path: ['referenceAnswer'], message: 'Reference answer is required' });
    if (t.taskType.startsWith('review') || t.taskType === 'mines') {
        if (!t.review.documentId) ctx.addIssue({ code: 'custom', path: ['review', 'documentId'], message: 'Choose a document' });
        // Court acts and "mines" have no client side: the act is checked for legality, the mines are dangerous for whoever signs
        const needsSide = ['review_contract', 'review_fix_check', 'review_admin_act'].includes(t.taskType);
        if (needsSide && !t.review.clientSide) ctx.addIssue({ code: 'custom', path: ['review', 'clientSide'], message: 'Choose the client side' });
    }
    if (t.taskType === 'route_and_apply') {
        if (!t.route.acceptableRoutes.length) ctx.addIssue({ code: 'custom', path: ['route', 'acceptableRoutes'], message: 'Add at least one acceptable route' });
        else if (!t.route.acceptableRoutes.some(r => r.score === 100)) ctx.addIssue({ code: 'custom', path: ['route', 'acceptableRoutes'], message: 'One route must be optimal (100)' });
        const factKeys = t.route.clientFacts.map(f => f.key);
        if (new Set(factKeys).size !== factKeys.length) ctx.addIssue({ code: 'custom', path: ['route', 'clientFacts'], message: 'Fact keys must be unique' });
    }
    if (t.taskType === 'proc_draft' && !t.process.draftDocType.ru && !t.process.draftDocType.uz) {
        ctx.addIssue({ code: 'custom', path: ['process', 'draftDocType'], message: 'Name the document the situation requires' });
    }
    if (t.taskType === 'proc_timeline') {
        const tl = t.process.timeline;
        const eventKeys = tl.events.map(e => e.key);
        if (!tl.events.length) ctx.addIssue({ code: 'custom', path: ['process', 'timeline', 'events'], message: 'Add the events of the case' });
        if (new Set(eventKeys).size !== eventKeys.length) ctx.addIssue({ code: 'custom', path: ['process', 'timeline', 'events'], message: 'Event keys must be unique' });
        tl.events.forEach((e, i) => {
            if (!e.date && !e.dateVar) ctx.addIssue({ code: 'custom', path: ['process', 'timeline', 'events', i, 'date'], message: 'The event needs a date or a date variable' });
            if (e.dateVar && !keys.has(e.dateVar)) ctx.addIssue({ code: 'custom', path: ['process', 'timeline', 'events', i, 'dateVar'], message: `Variable ${e.dateVar} is not defined` });
        });
        if (!tl.checks.length) ctx.addIssue({ code: 'custom', path: ['process', 'timeline', 'checks'], message: 'Add at least one deadline to check' });
        tl.checks.forEach((c, i) => {
            for (const k of [c.fromEventKey, c.toEventKey].filter(Boolean)) {
                if (!eventKeys.includes(k)) ctx.addIssue({ code: 'custom', path: ['process', 'timeline', 'checks', i], message: `Event ${k} does not exist` });
            }
        });
    }
    if (t.taskType === 'sim_branching' && !t.sim.scenarioId) ctx.addIssue({ code: 'custom', path: ['sim', 'scenarioId'], message: 'Choose a scenario' });
    if (t.taskType === 'sim_hearing' && !t.hearing.scenarioId) ctx.addIssue({ code: 'custom', path: ['hearing', 'scenarioId'], message: 'Choose a hearing scenario' });
    if (t.taskType === 'extraction_compare') {
        const ex = t.extraction;
        if (!ex.documentIds.length) ctx.addIssue({ code: 'custom', path: ['extraction', 'documentIds'], message: 'Choose 1-5 documents of the package' });
        if (new Set(ex.documentIds).size !== ex.documentIds.length) ctx.addIssue({ code: 'custom', path: ['extraction', 'documentIds'], message: 'Each document once' });
        if (!ex.fields.length) ctx.addIssue({ code: 'custom', path: ['extraction', 'fields'], message: 'Add the terms to extract' });
        const fieldKeys = ex.fields.map(f => f.key);
        if (new Set(fieldKeys).size !== fieldKeys.length) ctx.addIssue({ code: 'custom', path: ['extraction', 'fields'], message: 'Term keys must be unique' });
        ex.fields.forEach((f, i) => { if (!f.label.ru && !f.label.uz) ctx.addIssue({ code: 'custom', path: ['extraction', 'fields', i, 'label'], message: 'Name the term' }); });
        // Every term of every document has exactly one reference cell: a value or "not in the document"
        const kinds = new Map(ex.fields.map(f => [f.key, f.kind]));
        const seen = new Set<string>();
        ex.reference.forEach((c, i) => {
            const path = ['extraction', 'reference', i];
            if (!ex.documentIds.includes(c.documentId) || !kinds.has(c.fieldKey)) { ctx.addIssue({ code: 'custom', path, message: 'The cell belongs to no document or term of the package' }); return; }
            const k = `${c.documentId}|${c.fieldKey}`;
            if (seen.has(k)) ctx.addIssue({ code: 'custom', path, message: 'One reference value per term and document' });
            seen.add(k);
            if (!c.absent && !validValue(kinds.get(c.fieldKey)!, c.value)) {
                ctx.addIssue({ code: 'custom', path: [...path, 'value'], message: `Term ${c.fieldKey}: ${kinds.get(c.fieldKey) === 'date' ? 'date as YYYY-MM-DD' : kinds.get(c.fieldKey) === 'money' ? 'sum in digits' : kinds.get(c.fieldKey) === 'bool' ? 'yes or no' : 'a value'}, or mark "not in the document"` });
            }
        });
        for (const d of ex.documentIds) for (const f of fieldKeys) {
            if (!seen.has(`${d}|${f}`)) ctx.addIssue({ code: 'custom', path: ['extraction', 'reference'], message: `Term ${f} has no reference value for one of the documents` });
        }
    }
    if (t.taskType === 'proc_next_step') {
        const pr = t.process;
        if (!pr.acceptableCourts.length && !pr.deadline.ruleCode && !pr.fee.rateCode) {
            ctx.addIssue({ code: 'custom', path: ['process'], message: 'Set at least one of: courts, deadline rule, fee rate' });
        }
        for (const k of [pr.deadline.eventDateVar, pr.fee.amountVar, pr.fee.filingDateVar].filter(Boolean)) {
            if (!keys.has(k)) ctx.addIssue({ code: 'custom', path: ['process'], message: `Variable ${k} is not defined` });
        }
        // No event date and no variable: the deadline runs from the task's "today"

    }
});

// A review template can be published only with a published document and an existing party (AI drafts need approval first)
// pending: documents and scenarios of the same import pack, by their future id; they count as existing
export async function checkTemplateLinks(body: z.infer<typeof templateZod>, pending?: { documents: Map<string, any>; scenarios: Map<string, any>; bodies?: Set<string> }) {
    const fail = (path: (string | number)[], message: string) => {
        throw new HttpError(400, 'validation_error', message, [{ path, message }]);
    };
    const docById = async (id: unknown): Promise<any> => pending?.documents.get(String(id)) ?? (/^[a-f0-9]{24}$/.test(String(id)) ? LegalDocument.findById(id).lean() : null);
    const scenarioById = async (id: unknown): Promise<any> => pending?.scenarios.get(String(id)) ?? (/^[a-f0-9]{24}$/.test(String(id)) ? Scenario.findById(id).lean() : null);
    if (body.taskType === 'route_and_apply') {
        for (const [ri, r] of body.route.acceptableRoutes.entries()) {
            for (const [si, st] of r.steps.entries()) {
                if (!pending?.bodies?.has(st.bodyCode) && !(await bodyExists(st.bodyCode))) fail(['route', 'acceptableRoutes', ri, 'steps', si, 'bodyCode'], `Unknown body ${st.bodyCode}`);
            }
        }
        return;
    }
    if (body.taskType === 'proc_timeline') {
        const codes = new Set((await DeadlineRule.find().select('code').lean()).map(r => r.code));
        body.process.timeline.checks.forEach((c, i) => { if (!codes.has(c.ruleCode)) fail(['process', 'timeline', 'checks', i, 'ruleCode'], `Unknown deadline rule ${c.ruleCode}`); });
        return;
    }
    if (body.taskType === 'extraction_compare') {
        const byId = new Map<string, any>();
        for (const id of body.extraction.documentIds) { const d = await docById(id); if (d) byId.set(id, d); }
        body.extraction.documentIds.forEach((id, i) => {
            const d = byId.get(id);
            if (!d) fail(['extraction', 'documentIds', i], 'Document not found');
            if (body.status === 'published' && d!.status !== 'published') fail(['status'], 'Publish the documents of the package before the template');
        });
        // A reference quote must occur once in its document, so the student's source can be compared with it
        body.extraction.reference.forEach((c, i) => {
            if (!c.quote.trim()) return;
            const p = locateQuotes(byId.get(c.documentId)!.text, [c.quote]).problems[0];
            if (p) fail(['extraction', 'reference', i, 'quote'], p.reason === 'not_unique' ? 'The quote occurs more than once - make it longer' : 'The quote is not found in the document');
        });
        return;
    }
    if (body.taskType === 'sim_hearing') {
        const hearing = /^[a-f0-9]{24}$/.test(String(body.hearing.scenarioId)) ? await Hearing.findById(body.hearing.scenarioId).lean() : null;
        if (!hearing) fail(['hearing', 'scenarioId'], 'Hearing scenario not found');
        if (body.status === 'published' && hearing!.status !== 'published') fail(['status'], 'Publish the hearing scenario before the template');
        return;
    }
    if (body.taskType === 'sim_branching') {
        const scenario = await scenarioById(body.sim.scenarioId);
        if (!scenario) fail(['sim', 'scenarioId'], 'Scenario not found');
        if (body.sim.role && !scenario!.roles.some((r: any) => r.key === body.sim.role)) fail(['sim', 'role'], 'The scenario has no such role');
        if (body.status === 'published' && scenario!.status !== 'published') fail(['status'], 'Publish the scenario before the template');
        return;
    }
    if (!(body.taskType.startsWith('review') || body.taskType === 'mines') || !body.review.documentId) return;
    if (body.taskType === 'review_admin_act' && body.review.documentId) {
        const doc = await docById(body.review.documentId);
        if (doc && doc.type !== 'admin_act') fail(['review', 'documentId'], 'Choose an administrative act');
    }
    if (body.taskType === 'review_court_act' || body.taskType === 'mines') {
        const doc = await docById(body.review.documentId);
        if (!doc) fail(['review', 'documentId'], 'Document not found');
        if (body.taskType === 'review_court_act' && doc!.type !== 'court_act') fail(['review', 'documentId'], 'Choose a court act');
        if (body.taskType === 'mines' && !(doc!.flaws ?? []).length) fail(['review', 'documentId'], 'The document has no mines');
        if (body.status === 'published' && doc!.status !== 'published') fail(['status'], 'Publish the document before the template');
        return;
    }
    const doc = await docById(body.review.documentId);
    if (!doc) throw new HttpError(400, 'validation_error', 'Document not found', [{ path: ['review', 'documentId'], message: 'Document not found' }]);
    if (!(doc.parties ?? []).some((p: any) => p.key === body.review.clientSide)) {
        throw new HttpError(400, 'validation_error', 'Unknown party', [{ path: ['review', 'clientSide'], message: 'The document has no such party' }]);
    }
    if (body.taskType === 'review_fix_check' && !(doc.counterpartyEdits ?? []).length) {
        throw new HttpError(400, 'validation_error', 'No counterparty edits', [{ path: ['review', 'documentId'], message: 'The document has no counterparty edits' }]);
    }
    if (body.status === 'published' && doc.status !== 'published') {
        throw new HttpError(400, 'validation_error', 'Document not published', [{ path: ['status'], message: 'Publish the document before the template' }]);
    }
}

// AI draft of a template (PRD 10.2 generateTemplate)
router.use('/templates/generate', templateGenerateRoutes);

router.get('/templates', asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') filter.status = req.query.status;
    if (typeof req.query.mode === 'string') filter.mode = req.query.mode;
    const templates = await TaskTemplate.find(filter).sort({ updatedAt: -1 }).lean();
    res.json({ templates });
}));

router.get('/templates/:id', asyncHandler(async (req, res) => {
    const template = await TaskTemplate.findById(req.params.id).lean();
    if (!template) throw notFound('Template');
    res.json({ template });
}));

router.post('/templates', validateBody(templateZod), asyncHandler(async (req, res) => {
    await checkTemplateLinks(req.body);
    const template = await TaskTemplate.create({ ...req.body, mode: modeOfTaskType(req.body.taskType), authorId: req.user!.id, source: 'manual' });
    res.status(201).json({ template });
}));

router.put('/templates/:id', validateBody(templateZod), asyncHandler(async (req, res) => {
    await checkTemplateLinks(req.body);
    const template = await TaskTemplate.findByIdAndUpdate(
        req.params.id,
        { ...req.body, mode: modeOfTaskType(req.body.taskType) },
        { new: true, runValidators: true }
    );
    if (!template) throw notFound('Template');
    res.json({ template });
}));

router.delete('/templates/:id', asyncHandler(async (req, res) => {
    // Templates with generated instances are archived to draft instead of deleted - attempts keep their history
    const used = await TaskInstance.exists({ templateId: req.params.id });
    if (used) {
        await TaskTemplate.updateOne({ _id: req.params.id }, { status: 'draft' });
        res.json({ archived: true });
        return;
    }
    const r = await TaskTemplate.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) throw notFound('Template');
    res.json({ deleted: true });
}));

// ---------- ADM-4: document library ----------
// Scenarios of the simulation live next to the documents

router.use('/documents', documentRoutes);
router.use('/scenarios', scenarioRoutes);
router.use('/hearings', hearingAdminRoutes);
router.use('/usage', usageRoutes);
router.use('/import', importRoutes);
router.use('/tracks', trackAdminRoutes);
router.use('/ai', aiRoutes);

// ---------- ADM-9: log of admin actions ----------

router.get('/audit', asyncHandler(async (req, res) => {
    const q = req.query;
    const filter: Record<string, any> = {};
    if (typeof q.actorId === 'string' && /^[a-f0-9]{24}$/.test(q.actorId)) filter.actorId = q.actorId;
    if (typeof q.q === 'string' && q.q.trim()) filter.path = { $regex: escapeRegex(q.q.trim()), $options: 'i' };
    if (q.failed === '1') filter.status = { $gte: 400 };
    // Dates are Tashkent days (UTC+5)
    const day = (s: unknown, end = false) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(Date.parse(`${s}T${end ? '23:59:59.999' : '00:00:00'}Z`) - 5 * 3600 * 1000) : null);
    const from = day(q.from);
    const to = day(q.to, true);
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const page = Math.max(0, Number(q.page) || 0);
    const [total, items] = await Promise.all([
        AuditLog.countDocuments(filter),
        AuditLog.find(filter).sort({ createdAt: -1 }).skip(page * limit).limit(limit).lean()
    ]);
    const actors = await User.find({ _id: { $in: [...new Set(items.map(i => String(i.actorId)))] } }).select('fullName email').lean();
    const byId = new Map(actors.map(a => [String(a._id), { fullName: a.fullName, email: a.email }]));
    const admins = await User.find({ role: 'admin' }).select('fullName email').sort({ fullName: 1 }).lean();
    res.json({
        total, page, limit,
        items: items.map(i => ({ id: String(i._id), actor: byId.get(String(i.actorId)) ?? null, method: i.method, path: i.path, action: i.action, targetIds: i.targetIds, status: i.status, body: i.body, createdAt: i.createdAt })),
        admins: admins.map(a => ({ id: String(a._id), fullName: a.fullName, email: a.email }))
    });
}));

// ---------- ADM-6: dictionaries ----------

const DICTIONARIES: Record<string, mongoose.Model<any>> = {
    brvValues: BrvValue,
    feeRates: FeeRate,
    calendarDays: CalendarDay,
    courts: Court,
    deadlineRules: DeadlineRule,
    norms: Norm,
    bodies: Body,
    skills: Skill
};

const dictionary = (name: string) => {
    const m = DICTIONARIES[name];
    if (!m) throw new HttpError(404, 'unknown_dictionary', `Dictionary ${name} does not exist`);
    return m;
};

router.get('/dictionaries', (_req, res) => {
    res.json({ dictionaries: Object.keys(DICTIONARIES) });
});

// Bodies from the open register of state functions (reestr.gov.uz): new ones are added, names of imported ones refreshed
router.post('/dictionaries/bodies/import-register', asyncHandler(async (_req, res) => {
    let orgs;
    try {
        orgs = await fetchRegisterOrgs();
    } catch (e: any) {
        throw new HttpError(502, 'register_unavailable', `The register is not reachable: ${String(e?.message ?? e)}`);
    }
    res.json({ ...(await upsertRegisterBodies(orgs)), received: orgs.length, source: REGISTER_SITE });
}));

router.get('/dictionaries/:name', asyncHandler(async (req, res) => {
    const items = await dictionary(req.params.name).find().sort({ _id: 1 }).limit(2000).lean();
    res.json({ items });
}));

// Body is validated by the Mongoose schema of the dictionary
const stripMeta = (b: Record<string, unknown>) => {
    const { _id, __v, createdAt, updatedAt, ...rest } = b ?? {};
    return rest;
};

router.post('/dictionaries/:name', asyncHandler(async (req, res) => {
    const item = await dictionary(req.params.name).create(stripMeta(req.body));
    res.status(201).json({ item });
}));

router.put('/dictionaries/:name/:id', asyncHandler(async (req, res) => {
    const item = await dictionary(req.params.name).findOneAndReplace({ _id: req.params.id }, stripMeta(req.body), { new: true, runValidators: true });
    if (!item) throw notFound('Record');
    res.json({ item });
}));

router.delete('/dictionaries/:name/:id', asyncHandler(async (req, res) => {
    const r = await dictionary(req.params.name).deleteOne({ _id: req.params.id });
    if (!r.deletedCount) throw notFound('Record');
    res.json({ deleted: true });
}));

// ---------- ADM-5: criteria weights per mode ----------

router.get('/scoring', asyncHandler(async (_req, res) => {
    const saved = await ScoringConfig.find().lean();
    res.json({
        configs: MODES.map(mode => ({ mode, weights: saved.find(s => s.mode === mode)?.weights ?? DEFAULT_WEIGHTS[mode] }))
    });
}));

const weightsSchema = z.object(Object.fromEntries(CRITERIA.map(k => [k, z.coerce.number().int().min(0).max(100)])) as Record<string, z.ZodNumber>)
    .refine(w => Object.values(w).reduce((a, b) => a + b, 0) === 100, 'The weights must sum to 100');

router.put('/scoring/:mode', validateBody(weightsSchema), asyncHandler(async (req, res) => {
    if (!(MODES as readonly string[]).includes(req.params.mode)) throw new HttpError(400, 'unknown_mode', 'Unknown mode');
    const config = await ScoringConfig.findOneAndUpdate({ mode: req.params.mode }, { weights: req.body }, { upsert: true, new: true });
    res.json({ config });
}));

// ---------- ADM-2: results table ----------

async function loadResults(query: Record<string, unknown>, limit: number) {
    const filter: Record<string, unknown> = {};
    if (typeof query.status === 'string' && query.status) filter.status = query.status;
    if (typeof query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.from)) filter.createdAt = { $gte: new Date(`${query.from}T00:00:00+05:00`) };
    if (typeof query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) filter.createdAt = { ...((filter.createdAt as object) || {}), $lt: new Date(new Date(`${query.to}T00:00:00+05:00`).getTime() + 86400000) };
    if (typeof query.mode === 'string' && query.mode) {
        filter.instanceId = { $in: await TaskInstance.find({ mode: query.mode }).distinct('_id') };
    }
    const attempts = await Attempt.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const [users, instances] = await Promise.all([
        User.find({ _id: { $in: attempts.map(a => a.userId) } }).select('fullName email course').lean(),
        TaskInstance.find({ _id: { $in: attempts.map(a => a.instanceId) } }).select('content.title mode taskType difficulty isExam').lean()
    ]);
    return { attempts, u: new Map(users.map(x => [String(x._id), x])), t: new Map(instances.map(x => [String(x._id), x])) };
}

// ADM-8: the same table as CSV (UTF-8 with BOM so that Excel opens Cyrillic correctly), up to 10 000 rows
const csvCell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    // Leading = + - @ would run as a formula in a spreadsheet
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

router.get('/results.csv', asyncHandler(async (req, res) => {
    const { attempts, u, t } = await loadResults(req.query as Record<string, unknown>, 10000);
    const header = ['date', 'student', 'email', 'course', 'task', 'mode', 'taskType', 'difficulty', 'exam', 'iteration', 'status', 'score', ...CRITERIA, 'xp', 'reviewReasons'];
    const lines = attempts.map(a => {
        const user = u.get(String(a.userId));
        const inst = t.get(String(a.instanceId));
        const crit = Object.fromEntries((a.criteriaFinal ?? []).map(c => [c.key, c.score]));
        return [
            (a as any).createdAt?.toISOString(), user?.fullName, user?.email, user?.course, inst?.content?.title, inst?.mode, inst?.taskType, inst?.difficulty,
            inst?.isExam ? 'yes' : 'no', a.iteration, a.status, a.finalScore, ...CRITERIA.map(k => crit[k]), a.xpAwarded, (a.reviewReasons ?? []).join(' ')
        ].map(csvCell).join(';');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="results-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`\ufeff${header.join(';')}\n${lines.join('\n')}\n`);
}));

router.get('/results', asyncHandler(async (req, res) => {
    const { attempts, u, t } = await loadResults(req.query as Record<string, unknown>, 300);
    res.json({
        results: attempts.map(a => ({
            id: String(a._id),
            user: u.get(String(a.userId)) ? { fullName: u.get(String(a.userId))!.fullName, email: u.get(String(a.userId))!.email } : null,
            title: t.get(String(a.instanceId))?.content?.title ?? '',
            mode: t.get(String(a.instanceId))?.mode,
            difficulty: t.get(String(a.instanceId))?.difficulty,
            iteration: a.iteration,
            status: a.status,
            finalScore: a.finalScore,
            reviewReasons: a.reviewReasons,
            lastError: a.lastError,
            createdAt: (a as any).createdAt
        }))
    });
}));

router.post('/results/:id/requeue', asyncHandler(async (req, res) => {
    const a = await Attempt.findById(req.params.id);
    if (!a) throw notFound('Attempt');
    if (a.status !== 'failed' && a.status !== 'evaluating') throw new HttpError(409, 'not_failed', 'Only failed or pending attempts can be requeued');
    await requeue(req.params.id);
    res.json({ ok: true });
}));

export default router;
