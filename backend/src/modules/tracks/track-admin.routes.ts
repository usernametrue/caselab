import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { validateBody } from '../../middleware/validate';
import { Track, TrackRun, CONDITION_KINDS, COURT_ACT_KINDS } from './track.model';
import { validateTrack } from './track.service';
import { LegalDocument, Scenario, Skill, TaskTemplate, modeOfTaskType } from '../content/content.model';
import { DeadlineRule, FeeRate } from '../legal/legal.model';
import { aiAvailable } from '../ai/ai.service';
import { registerJobHandler, runOrQueue } from '../ai/batch';
import { languageName, loadPrompt, render } from '../ai/prompts';
import { localizedZod } from '../../utils/localized';

// Track constructor (PRD 4.10, 9.4 CRUD /admin/tracks). Admin only; mounted under the admin router.
const router = Router();

const keyZod = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Key: latin letters, digits, _');
const L0 = { ru: '', uz: '' };

export const trackZod = z.object({
    title: localizedZod,
    description: localizedZod.default(L0),
    role: localizedZod.default(L0),
    startDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(''),
    values: z.array(z.object({
        key: keyZod,
        kind: z.enum(['money', 'date', 'text']),
        value: z.string().max(100).default(''),
        text: localizedZod.default(L0)
    }).superRefine((v, ctx) => {
        if (v.kind === 'money' && !/^\d+$/.test(v.value)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Sum in digits' });
        if (v.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v.value)) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Date as YYYY-MM-DD' });
    })).max(40).default([]),
    folder: z.array(z.object({ title: localizedZod, text: localizedZod.default(L0), date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default('') })).max(20).default([]),
    stages: z.array(z.object({
        key: keyZod,
        title: localizedZod,
        templateId: z.string().regex(/^[a-f0-9]{24}$/, 'Choose a template'),
        daysAfter: z.coerce.number().int().min(0).max(365).default(0),
        weight: z.coerce.number().min(0).max(10).default(1),
        setback: z.boolean().default(false),
        opponentBefore: z.object({ enabled: z.boolean().default(false), title: localizedZod.default(L0), brief: localizedZod.default(L0) }).default({ enabled: false, title: L0, brief: L0 }),
        transitions: z.array(z.object({
            condition: z.object({ kind: z.enum(CONDITION_KINDS), param: z.string().max(40).default('') }),
            next: z.string().min(1),
            courtAct: z.enum(COURT_ACT_KINDS).default('')
        })).max(10).default([]),
        defaultNext: z.string().default(''),
        defaultCourtAct: z.enum(COURT_ACT_KINDS).default('')
    })).min(1).max(15),
    firstStageKey: z.string().min(1),
    status: z.enum(['draft', 'review', 'published']).default('draft')
}).superRefine((t, ctx) => {
    if (!t.title.ru && !t.title.uz) ctx.addIssue({ code: 'custom', path: ['title'], message: 'Title is required' });
});

// A published track needs a sound graph and published templates
async function check(body: z.infer<typeof trackZod>) {
    const problems = validateTrack(body);
    const ids = [...new Set(body.stages.map(s => s.templateId))];
    const templates = await TaskTemplate.find({ _id: { $in: ids } }).select('status').lean();
    for (const id of ids) {
        const t = templates.find(x => String(x._id) === id);
        if (!t) problems.push(`Template ${id} does not exist`);
        else if (body.status === 'published' && t.status !== 'published') problems.push(`Template ${id} is not published`);
    }
    if (problems.length && body.status === 'published') throw new HttpError(400, 'validation_error', 'The track has problems', problems.map(message => ({ path: ['stages'], message })));
    return problems;
}

router.get('/', asyncHandler(async (_req, res) => {
    const tracks = await Track.find().select('title status source stages updatedAt').sort({ updatedAt: -1 }).lean();
    const runs = await TrackRun.aggregate([{ $group: { _id: '$trackId', count: { $sum: 1 } } }]);
    res.json({
        tracks: tracks.map(t => ({ _id: t._id, title: t.title, status: t.status, source: t.source, stagesCount: t.stages?.length ?? 0, runs: runs.find(r => String(r._id) === String(t._id))?.count ?? 0, updatedAt: (t as any).updatedAt }))
    });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const track = await Track.findById(req.params.id).lean();
    if (!track) throw notFound('Track');
    res.json({ track, problems: validateTrack(track as any) });
}));

router.post('/', validateBody(trackZod), asyncHandler(async (req, res) => {
    const problems = await check(req.body);
    const track = await Track.create({ ...req.body, authorId: req.user!.id, organizationId: req.user!.organizationId });
    res.status(201).json({ track, problems });
}));

router.put('/:id', validateBody(trackZod), asyncHandler(async (req, res) => {
    const problems = await check(req.body);
    const track = await Track.findById(req.params.id);
    if (!track) throw notFound('Track');
    track.set(req.body);
    await track.save();
    res.json({ track, problems });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    if (await TrackRun.exists({ trackId: req.params.id })) {
        await Track.updateOne({ _id: req.params.id }, { status: 'draft' });
        res.json({ archived: true });
        return;
    }
    const r = await Track.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) throw notFound('Track');
    res.json({ deleted: true });
}));

// One click after review: the track with its templates and the documents and scenarios they use
router.post('/:id/publish-all', asyncHandler(async (req, res) => {
    const track = await Track.findById(req.params.id);
    if (!track) throw notFound('Track');
    const problems = validateTrack(track.toObject() as any);
    if (problems.length) throw new HttpError(400, 'validation_error', 'The track has problems', problems.map(message => ({ path: ['stages'], message })));
    const ids = track.stages.map(s => s.templateId);
    const templates = await TaskTemplate.find({ _id: { $in: ids } }).select('review.documentId sim.scenarioId').lean();
    const docIds = templates.map(t => t.review?.documentId).filter(Boolean);
    const scenarioIds = templates.map(t => t.sim?.scenarioId).filter(Boolean);
    const [d, s, t] = await Promise.all([
        LegalDocument.updateMany({ _id: { $in: docIds } }, { status: 'published' }),
        Scenario.updateMany({ _id: { $in: scenarioIds } }, { status: 'published' }),
        TaskTemplate.updateMany({ _id: { $in: ids } }, { status: 'published' })
    ]);
    track.status = 'published';
    await track.save();
    res.json({ published: { templates: t.modifiedCount, documents: d.modifiedCount, scenarios: s.modifiedCount } });
}));

// ---------- AI draft of a whole track (stages of drafting and the procedural card) ----------

const genZod = z.object({
    topic: z.string().trim().min(5).max(500),
    language: z.enum(['ru', 'uz']),
    stagesCount: z.coerce.number().int().min(3).max(6).default(4)
});

const genOut = z.object({
    title: z.string().min(3),
    description: z.string(),
    role: z.string(),
    startDate: z.string(),
    values: z.array(z.object({ key: z.string(), kind: z.enum(['money', 'date', 'text']), value: z.string(), label: z.string() })).max(15),
    folder: z.array(z.object({ title: z.string(), text: z.string(), date: z.string() })).max(5),
    stages: z.array(z.object({
        key: z.string(),
        title: z.string(),
        taskType: z.enum(['draft_full', 'proc_next_step', 'proc_draft']),
        difficulty: z.number().int().min(1).max(5),
        skillKey: z.string(),
        instructions: z.string(),
        caseText: z.string(),
        referenceAnswer: z.string(),
        checklist: z.array(z.string()).max(10),
        draftDocType: z.string(),
        acceptableCourts: z.array(z.string()).max(4),
        deadlineRuleCode: z.string(),
        feeRateCode: z.string(),
        feeAmountKey: z.string(),
        daysAfter: z.number().int().min(0).max(120),
        setback: z.boolean(),
        opponentBrief: z.string(),
        transitions: z.array(z.object({ conditionKind: z.enum(CONDITION_KINDS), param: z.string(), next: z.string(), courtAct: z.enum(COURT_ACT_KINDS) })).max(4),
        defaultNext: z.string(),
        defaultCourtAct: z.enum(COURT_ACT_KINDS)
    })).min(2).max(8)
});

// Templates and the track are saved as drafts: a person checks them and publishes (PRD 10.4)
interface TrackMeta { body: z.infer<typeof genZod> }

const trackDictionaries = () => Promise.all([
    Skill.find({ parentKey: { $ne: null } }).select('key').sort({ key: 1 }).lean(),
    DeadlineRule.find().select('code name').sort({ code: 1 }).lean(),
    FeeRate.find().select('code name').sort({ code: 1 }).lean()
]);

router.post('/generate', validateBody(genZod), asyncHandler(async (req, res) => {
    if (!aiAvailable()) throw new HttpError(503, 'llm_not_configured', 'ANTHROPIC_API_KEY is not set');
    const body = req.body as z.infer<typeof genZod>;
    const [skills, rules, rates] = await trackDictionaries();
    const prompt = loadPrompt('generate-track', 2);
    let out;
    try {
        out = await runOrQueue('generate_track', {
            task: 'generateTrack',
            ...render(prompt, {
                conditionKinds: CONDITION_KINDS.join(', '),
                courtActs: COURT_ACT_KINDS.filter(Boolean).join(', '),
                skills: skills.map(s => s.key).join(', '),
                deadlineRules: rules.map(r => `${r.code} (${(r.name as any)?.ru ?? ''})`).join('\n'),
                feeRates: rates.map(r => `${r.code} (${(r.name as any)?.ru ?? ''})`).join('\n'),
                stagesCount: body.stagesCount,
                topic: body.topic,
                language: languageName(body.language)
            })
        }, { promptVersion: prompt.version, meta: { body }, label: body.topic, createdBy: req.user!.id, organizationId: req.user!.organizationId });
    } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(502, 'llm_failed', 'The LLM could not generate the track, try again');
    }
    if (out.queued) return res.status(202).json({ job: out.job });
    const r = out.result as Awaited<ReturnType<typeof saveTrack>>;
    const track = await Track.findById(r.track._id).lean();
    res.status(201).json({ track, problems: r.problems });
}));

async function saveTrack(meta: TrackMeta, data: z.infer<typeof genOut>, job: { createdBy: unknown; organizationId: unknown }) {
    const body = meta.body;
    const [skills, rules, rates] = await trackDictionaries();
    const lang = body.language;
    const L = (s: string) => ({ ru: lang === 'ru' ? s : '', uz: lang === 'uz' ? s : '' });
    const skillKeys = new Set(skills.map(s => s.key));
    const ruleCodes = new Set(rules.map(r => r.code));
    const rateCodes = new Set(rates.map(r => r.code));
    // Values the code accepts: digits for sums, ISO dates; the rest are dropped
    const values = data.values.filter(v => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(v.key) && (v.kind === 'text' || (v.kind === 'money' ? /^\d+$/.test(v.value) : /^\d{4}-\d{2}-\d{2}$/.test(v.value))));
    const valueKeys = new Set(values.map(v => v.key));
    const stageKeys = new Set(data.stages.map(s => s.key).filter(k => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(k)));
    const validNext = (n: string) => ['outcome:win', 'outcome:partial', 'outcome:loss'].includes(n) || stageKeys.has(n);
    const owner = { authorId: job.createdBy, organizationId: job.organizationId };

    const stages = [];
    for (const s of data.stages.filter(x => stageKeys.has(x.key))) {
        // Placeholders only for the track values; each becomes a template variable fixed by the track
        const used = [...new Set([...`${s.caseText} ${s.instructions}`.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].filter(k => valueKeys.has(k));
        const strip = (t: string) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (used.includes(k) ? m : k));
        const variablesSchema = used.map(k => {
            const v = values.find(x => x.key === k)!;
            return v.kind === 'money'
                ? { key: k, kind: 'money', label: v.label, min: Number(v.value), max: Number(v.value), step: 1 }
                : v.kind === 'date' ? { key: k, kind: 'date', label: v.label, min: 0, max: 0 } : { key: k, kind: 'choice', label: v.label, options: [L(v.value)] };
        });
        const amountKey = valueKeys.has(s.feeAmountKey) && values.find(v => v.key === s.feeAmountKey)?.kind === 'money' ? s.feeAmountKey : '';
        if (amountKey && !used.includes(amountKey)) variablesSchema.push({ key: amountKey, kind: 'money', label: '', min: Number(values.find(v => v.key === amountKey)!.value), max: Number(values.find(v => v.key === amountKey)!.value), step: 1 });
        const template = await TaskTemplate.create({
            ...owner, mode: modeOfTaskType(s.taskType), taskType: s.taskType, difficulty: s.difficulty,
            skills: [{ key: skillKeys.has(s.skillKey) ? s.skillKey : [...skillKeys][0], weight: 1 }],
            title: L(s.title), instructions: L(strip(s.instructions)), caseText: L(strip(s.caseText)), referenceAnswer: L(s.referenceAnswer),
            checklist: s.checklist.map(L), variablesSchema, aiRewrite: false, status: 'draft', source: 'ai',
            context: { role: L(data.role), today: '' },
            deterministicCheck: s.taskType === 'draft_full' && (s.acceptableCourts.length || amountKey)
                ? { kind: 'claim_requisites', params: { amountVar: amountKey, feeRateCode: rateCodes.has(s.feeRateCode) ? s.feeRateCode : 'property', acceptableCourts: s.acceptableCourts } }
                : { kind: 'none' },
            process: {
                acceptableCourts: s.taskType === 'proc_next_step' ? s.acceptableCourts : [],
                deadline: { ruleCode: s.taskType === 'proc_next_step' && ruleCodes.has(s.deadlineRuleCode) ? s.deadlineRuleCode : '' },
                fee: { rateCode: s.taskType === 'proc_next_step' && rateCodes.has(s.feeRateCode) ? s.feeRateCode : '', amountVar: amountKey },
                draftDocType: L(s.draftDocType)
            }
        });
        stages.push({
            key: s.key, title: L(s.title), templateId: template._id, daysAfter: s.daysAfter, weight: 1, setback: s.setback,
            opponentBefore: { enabled: Boolean(s.opponentBrief), title: L(''), brief: L(s.opponentBrief) },
            transitions: s.transitions.filter(t => validNext(t.next)).map(t => ({ condition: { kind: t.conditionKind, param: t.param }, next: t.next, courtAct: t.courtAct })),
            defaultNext: validNext(s.defaultNext) ? s.defaultNext : 'outcome:loss',
            defaultCourtAct: s.defaultCourtAct
        });
    }
    if (!stages.length) throw new HttpError(502, 'llm_failed', 'The LLM returned no usable stages, try again');
    const track = await Track.create({
        ...owner, title: L(data.title), description: L(data.description), role: L(data.role),
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(data.startDate) ? data.startDate : '',
        values: values.map(v => ({ key: v.key, kind: v.kind, value: v.kind === 'text' ? '' : v.value, text: v.kind === 'text' ? L(v.value) : L('') })),
        folder: data.folder.map(f => ({ title: L(f.title), text: L(f.text), date: /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : '' })),
        stages, firstStageKey: stages[0].key, status: 'draft', source: 'ai'
    });
    return { track: { _id: String(track._id) }, problems: validateTrack(track.toObject() as any) };
}
registerJobHandler('generate_track', { schema: genOut, onResult: saveTrack });

export default router;
