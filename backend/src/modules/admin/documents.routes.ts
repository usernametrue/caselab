import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { validateBody } from '../../middleware/validate';
import { LegalDocument, SEGMENT_KEYS, TaskTemplate } from '../content/content.model';
import { locateQuotes } from '../review/review-engine';
import { aiAvailable } from '../ai/ai.service';
import { registerJobHandler, runOrQueue } from '../ai/batch';
import { languageName, loadPrompt, render } from '../ai/prompts';
import { localizedZod } from '../../utils/localized';

// ADM-4: documents for the review trainers. Admin only (mounted under the admin router).
const router = Router();

const DOC_TYPES = ['contract', 'labor_contract', 'claim', 'court_act', 'admin_act'] as const;
const partyZod = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Party key: latin letters, digits, _'), name: localizedZod });

export const documentZod = z.object({
    type: z.enum(DOC_TYPES),
    title: z.string().trim().min(3).max(300),
    language: z.enum(['ru', 'uz']),
    script: z.enum(['cyrl', 'latn']).default('latn'),
    text: z.string().min(50).max(100000),
    parties: z.array(partyZod).min(1).max(6),
    flaws: z.array(z.object({
        quote: z.string().min(1).max(3000),
        type: z.string().max(200).default('risk'),
        severity: z.enum(['low', 'medium', 'high']).default('medium'),
        badFor: z.string().default('both'),
        normRef: z.string().max(200).default(''),
        explanation: localizedZod.default({ ru: '', uz: '' }),
        fix: localizedZod.default({ ru: '', uz: '' }),
        segmentKey: z.enum(['', ...SEGMENT_KEYS]).default(''),
        expectedValue: z.object({
            kind: z.enum(['none', 'date', 'money']).default('none'),
            value: z.string().max(100).default('')
        }).default({ kind: 'none', value: '' }),
        options: z.array(z.object({ text: z.string().trim().min(1).max(1000), correct: z.boolean().default(false) })).max(4).default([])
    })).max(60).default([]),
    counterpartyEdits: z.array(z.object({
        quote: z.string().min(1).max(3000),
        replacement: z.string().max(5000).default(''),
        badFor: z.string().default('none'),
        explanation: localizedZod.default({ ru: '', uz: '' })
    })).max(60).default([]),
    segments: z.array(z.object({ key: z.enum(SEGMENT_KEYS), startQuote: z.string().min(1).max(500) })).max(20).default([]),
    caseNumber: z.string().max(100).default(''),
    actType: z.enum(['', 'decision', 'resolution', 'ruling', 'order']).default(''),
    instance: z.enum(['', 'first', 'appeal', 'cassation', 'revision']).default(''),
    originalId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
    status: z.enum(['draft', 'review', 'published']).default('draft')
}).superRefine((d, ctx) => {
    const keys = new Set(d.parties.map(p => p.key));
    d.flaws.forEach((f, i) => {
        if (f.expectedValue.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(f.expectedValue.value)) ctx.addIssue({ code: 'custom', path: ['flaws', i, 'expectedValue', 'value'], message: 'Date as YYYY-MM-DD' });
        if (f.expectedValue.kind === 'money' && !/^\d[\d\s]*$/.test(f.expectedValue.value)) ctx.addIssue({ code: 'custom', path: ['flaws', i, 'expectedValue', 'value'], message: 'Sum in digits' });
        if (f.options.length && !f.options.some(o => o.correct)) ctx.addIssue({ code: 'custom', path: ['flaws', i, 'options'], message: 'Mark at least one safe option' });
        if (f.options.length === 1) ctx.addIssue({ code: 'custom', path: ['flaws', i, 'options'], message: 'Give 3-4 options or none' });
    });
    const segKeys = d.segments.map(x => x.key);
    if (new Set(segKeys).size !== segKeys.length) ctx.addIssue({ code: 'custom', path: ['segments'], message: 'Each part of the act once' });
    d.flaws.forEach((f, i) => {
        if (f.badFor !== 'both' && !keys.has(f.badFor)) ctx.addIssue({ code: 'custom', path: ['flaws', i, 'badFor'], message: `Unknown party "${f.badFor}"` });
    });
    d.counterpartyEdits.forEach((e, i) => {
        if (e.badFor !== 'none' && e.badFor !== 'both' && !keys.has(e.badFor)) ctx.addIssue({ code: 'custom', path: ['counterpartyEdits', i, 'badFor'], message: `Unknown party "${e.badFor}"` });
    });
});

// Ranges always come from the quotes, so editing the text never leaves stale offsets
export function withRanges(body: z.infer<typeof documentZod>) {
    const f = locateQuotes(body.text, body.flaws.map(x => x.quote));
    const e = locateQuotes(body.text, body.counterpartyEdits.map(x => x.quote));
    const sg = locateQuotes(body.text, body.segments.map(x => x.startQuote));
    const message = (reason: string) => (reason === 'not_unique' ? 'The quote occurs more than once - make it longer' : 'The quote is not found in the text');
    const details = [
        ...f.problems.map(p => ({ path: ['flaws', p.index, 'quote'], message: message(p.reason) })),
        ...e.problems.map(p => ({ path: ['counterpartyEdits', p.index, 'quote'], message: message(p.reason) })),
        ...sg.problems.map(p => ({ path: ['segments', p.index, 'startQuote'], message: message(p.reason) }))
    ];
    if (details.length) throw new HttpError(400, 'validation_error', 'Quotes do not match the text', details);
    // A part of the act runs from its start quote to the start of the next part
    const starts = body.segments.map((x, i) => ({ ...x, from: sg.ranges[i]!.from })).sort((a, b) => a.from - b.from);
    const segments = starts.map((x, i) => ({ key: x.key, startQuote: x.startQuote, from: x.from, to: i + 1 < starts.length ? starts[i + 1].from : body.text.length }));
    const segmentOf = (from: number) => segments.find(x => from >= x.from && from < x.to)?.key ?? '';
    return {
        ...body,
        segments,
        // A flaw without a part gets the part it lies in
        flaws: body.flaws.map((x, i) => ({ ...x, ...f.ranges[i]!, segmentKey: x.segmentKey || segmentOf(f.ranges[i]!.from) })),
        counterpartyEdits: body.counterpartyEdits.map((x, i) => ({ ...x, ...e.ranges[i]! }))
    };
}

router.get('/', asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (typeof req.query.status === 'string') filter.status = req.query.status;
    if (typeof req.query.type === 'string') filter.type = req.query.type;
    const documents = await LegalDocument.find(filter).select('type title language status source parties flaws counterpartyEdits updatedAt').sort({ updatedAt: -1 }).lean();
    res.json({
        documents: documents.map(d => ({
            _id: d._id, type: d.type, title: d.title, language: d.language, status: d.status, source: d.source, parties: d.parties,
            flawsCount: d.flaws?.length ?? 0, editsCount: d.counterpartyEdits?.length ?? 0, updatedAt: (d as any).updatedAt
        }))
    });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const document = await LegalDocument.findById(req.params.id).lean();
    if (!document) throw notFound('Document');
    res.json({ document });
}));

router.post('/', validateBody(documentZod), asyncHandler(async (req, res) => {
    const document = await LegalDocument.create({ ...withRanges(req.body), authorId: req.user!.id, organizationId: req.user!.organizationId });
    res.status(201).json({ document });
}));

router.put('/:id', validateBody(documentZod), asyncHandler(async (req, res) => {
    const existing = await LegalDocument.findById(req.params.id);
    if (!existing) throw notFound('Document');
    existing.set(withRanges(req.body));
    await existing.save();
    res.json({ document: existing });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    // Documents used by templates are archived to draft; running tasks keep their own snapshot
    if (await TaskTemplate.exists({ 'review.documentId': req.params.id })) {
        await LegalDocument.updateOne({ _id: req.params.id }, { status: 'draft' });
        res.json({ archived: true });
        return;
    }
    const r = await LegalDocument.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) throw notFound('Document');
    res.json({ deleted: true });
}));

// ---------- AI draft of a document with flaws (PRD 10.2 generateFlawedDocument) ----------

const generateZod = z.object({
    type: z.enum(DOC_TYPES),
    topic: z.string().trim().min(5).max(500),
    language: z.enum(['ru', 'uz']),
    parties: z.array(partyZod).min(2).max(4),
    flawsCount: z.coerce.number().int().min(1).max(12).default(5),
    editsCount: z.coerce.number().int().min(0).max(8).default(3),
    difficulty: z.coerce.number().int().min(1).max(5).default(3)
});

const generatedZod = z.object({
    title: z.string().min(3),
    text: z.string().min(200),
    flaws: z.array(z.object({
        quote: z.string(),
        type: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
        badFor: z.string(),
        normRef: z.string(),
        explanation: z.string(),
        fix: z.string()
    })).max(15),
    counterpartyEdits: z.array(z.object({
        quote: z.string(),
        replacement: z.string(),
        badFor: z.string(),
        explanation: z.string()
    })).max(10)
});

const TYPE_NAMES: Record<string, string> = {
    contract: 'гражданско-правовой договор', labor_contract: 'трудовой договор (ТК РУз)', claim: 'исковое заявление',
    court_act: 'судебный акт экономического суда', admin_act: 'административный акт'
};

// The draft is saved with status "draft": students see it only after a person checks and publishes it (PRD 10.4)
interface GenerateMeta { body: z.infer<typeof generateZod> }

async function saveGenerated(meta: GenerateMeta, data: z.infer<typeof generatedZod>, job: { createdBy: unknown; organizationId: unknown }) {
    const body = meta.body;
    // Code checks every quote verbatim and computes the ranges itself; unusable items are dropped and reported
    const keys = new Set(body.parties.map(p => p.key));
    const f = locateQuotes(data.text, data.flaws.map(x => x.quote));
    const e = locateQuotes(data.text, data.counterpartyEdits.map(x => x.quote));
    const lang = body.language;
    const L = (s: string) => ({ ru: lang === 'ru' ? s : '', uz: lang === 'uz' ? s : '' });
    const flaws = data.flaws.flatMap((x, i) => (f.ranges[i] ? [{
        quote: x.quote, ...f.ranges[i]!, type: x.type, severity: x.severity,
        badFor: keys.has(x.badFor) ? x.badFor : 'both', normRef: x.normRef, explanation: L(x.explanation), fix: L(x.fix)
    }] : []));
    const counterpartyEdits = data.counterpartyEdits.flatMap((x, i) => (e.ranges[i] ? [{
        quote: x.quote, ...e.ranges[i]!, replacement: x.replacement,
        badFor: keys.has(x.badFor) ? x.badFor : 'none', explanation: L(x.explanation)
    }] : []));

    const document = await LegalDocument.create({
        type: body.type, title: data.title, language: lang, script: 'latn', text: data.text,
        parties: body.parties, flaws, counterpartyEdits, status: 'draft', source: 'ai',
        authorId: job.createdBy, organizationId: job.organizationId
    });
    return {
        document: { _id: String(document._id), title: document.title },
        dropped: { flaws: data.flaws.length - flaws.length, counterpartyEdits: data.counterpartyEdits.length - counterpartyEdits.length }
    };
}
registerJobHandler('generate_document', { schema: generatedZod, onResult: saveGenerated });

router.post('/generate', validateBody(generateZod), asyncHandler(async (req, res) => {
    if (!aiAvailable()) throw new HttpError(503, 'llm_not_configured', 'ANTHROPIC_API_KEY is not set');
    const body = req.body as z.infer<typeof generateZod>;
    const prompt = loadPrompt('generate-document', 2);
    let out;
    try {
        out = await runOrQueue('generate_document', {
            task: 'generateFlawedDocument',
            ...render(prompt, {
                documentType: TYPE_NAMES[body.type],
                topic: body.topic,
                parties: body.parties.map(p => `${p.key}: ${p.name[body.language] || p.name.ru || p.name.uz}`).join('\n'),
                flawsCount: body.flawsCount,
                editsCount: body.editsCount,
                difficulty: body.difficulty,
                language: languageName(body.language)
            })
        }, { promptVersion: prompt.version, meta: { body }, label: body.topic, createdBy: req.user!.id, organizationId: req.user!.organizationId });
    } catch {
        throw new HttpError(502, 'llm_failed', 'The LLM could not generate the document, try again');
    }
    // Queued for a batch: the draft appears in the list when the answer comes
    if (out.queued) return res.status(202).json({ job: out.job });
    const r = out.result as Awaited<ReturnType<typeof saveGenerated>>;
    res.status(201).json({ ...r, document: await LegalDocument.findById(r.document._id).lean() });
}));


// ---------- AI errors in a court act (PRD 4.3, 10.2 injectActErrors) ----------

const injectZod = z.object({
    errorsCount: z.coerce.number().int().min(1).max(8).default(3),
    difficulty: z.coerce.number().int().min(1).max(5).default(3)
});

const injectedZod = z.object({
    text: z.string().min(200),
    flaws: z.array(z.object({
        quote: z.string(),
        original: z.string(),
        segmentKey: z.enum(SEGMENT_KEYS),
        type: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
        normRef: z.string(),
        explanation: z.string(),
        expectedKind: z.enum(['none', 'date', 'money']),
        expectedValue: z.string()
    })).max(10)
});

// The original act stays untouched and becomes the reference; the copy with errors is a draft for moderation
interface InjectMeta { originalId: string }

async function saveInjected(meta: InjectMeta, data: z.infer<typeof injectedZod>, job: { createdBy: unknown; organizationId: unknown }) {
    const original = await LegalDocument.findById(meta.originalId);
    if (!original) throw new Error('The original act was deleted');
    // Each error must be found verbatim once in the new text, and its original once in the source act
    const f = locateQuotes(data.text, data.flaws.map(x => x.quote));
    const o = locateQuotes(original.text, data.flaws.map(x => x.original));
    const L = (s: string) => ({ ru: original.language === 'ru' ? s : '', uz: original.language === 'uz' ? s : '' });
    const flaws = data.flaws.flatMap((x, i) => (f.ranges[i] && o.ranges[i] && x.quote !== x.original ? [{
        quote: x.quote, ...f.ranges[i]!, type: x.type, severity: x.severity, badFor: 'both', normRef: x.normRef,
        explanation: L(x.explanation), fix: L(x.original), segmentKey: x.segmentKey,
        expectedValue: { kind: x.expectedKind, value: x.expectedKind === 'none' ? '' : x.expectedValue }
    }] : []));
    // Parts of the copy are found again by their start quotes; a quote changed by an error drops that part
    const sg = locateQuotes(data.text, original.segments.map(x => x.startQuote));
    const starts = original.segments.flatMap((x, i) => (sg.ranges[i] ? [{ key: x.key, startQuote: x.startQuote, from: sg.ranges[i]!.from }] : [])).sort((a, b) => a.from - b.from);
    const segments = starts.map((x, i) => ({ ...x, to: i + 1 < starts.length ? starts[i + 1].from : data.text.length }));

    const document = await LegalDocument.create({
        type: 'court_act', title: `${original.title} (с ошибками)`, language: original.language, script: original.script, text: data.text,
        parties: original.parties, flaws, counterpartyEdits: [], segments,
        caseNumber: original.caseNumber, actType: original.actType, instance: original.instance, originalId: original._id,
        status: 'draft', source: 'ai', authorId: job.createdBy, organizationId: job.organizationId
    });
    return { document: { _id: String(document._id), title: document.title }, dropped: { flaws: data.flaws.length - flaws.length, segments: original.segments.length - segments.length } };
}
registerJobHandler('inject_errors', { schema: injectedZod, onResult: saveInjected });

router.post('/:id/inject-errors', validateBody(injectZod), asyncHandler(async (req, res) => {
    if (!aiAvailable()) throw new HttpError(503, 'llm_not_configured', 'ANTHROPIC_API_KEY is not set');
    const original = await LegalDocument.findById(req.params.id);
    if (!original) throw notFound('Document');
    if (original.type !== 'court_act') throw new HttpError(400, 'not_court_act', 'Errors are injected into court acts only');
    if (!(original.segments ?? []).length) throw new HttpError(400, 'no_segments', 'Mark the parts of the act first');
    const body = req.body as z.infer<typeof injectZod>;
    const prompt = loadPrompt('inject-act-errors', 2);
    let out;
    try {
        // The act is the cached part: several error sets for one act re-read it from the cache
        out = await runOrQueue('inject_errors', {
            task: 'injectActErrors',
            ...render(prompt, {
                segments: original.segments.map(x => `${x.key}: "${original.text.slice(x.from, Math.min(x.to, x.from + 160))}..."`).join('\n'),
                text: original.text,
                script: original.script === 'cyrl' ? 'кириллица' : 'латиница',
                errorsCount: body.errorsCount,
                difficulty: body.difficulty
            })
        }, { promptVersion: prompt.version, meta: { originalId: String(original._id) }, label: original.title, createdBy: req.user!.id, organizationId: req.user!.organizationId });
    } catch {
        throw new HttpError(502, 'llm_failed', 'The LLM could not prepare the act, try again');
    }
    if (out.queued) return res.status(202).json({ job: out.job });
    const r = out.result as Awaited<ReturnType<typeof saveInjected>>;
    res.status(201).json({ ...r, document: await LegalDocument.findById(r.document._id).lean() });
}));

export default router;
