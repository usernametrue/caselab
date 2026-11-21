import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { Attempt, type AttemptDoc } from './attempt.model';
import { TaskInstance, type TaskInstanceDoc } from '../tasks/task.model';
import { EvaluationDeferred, explainCheck, scoreLabel } from './evaluation.service';
import { UserAchievement } from '../gamification/gamification.model';
import { Assignment } from '../users/user.model';
import { hiddenExamInstanceIds } from '../tasks/task.service';
import { bodyExists } from '../legal/bodies-import';
import { mineOfSegment } from '../review/mines-engine';

const router = Router();
router.use(requireAuth);

const selectionItem = z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(1),
    quote: z.string().max(3000),
    comment: z.string().trim().min(5, 'Every edit needs a comment').max(3000),
    replacement: z.string().max(5000).default('')
}).refine(i => i.to > i.from, 'Empty selection');

// Answer shape per task type (PRD 9.5: validated by the taskType schema)
// The formatted copy from the document editor: kept to reopen the draft, the grading reads the plain text
const richHtml = z.string().max(200000).optional();
const answerSchemas: Record<string, z.ZodType> = {
    draft_full: z.object({ text: z.string().trim().min(30, 'The document is too short').max(30000), html: richHtml }),
    draft_part: z.object({ text: z.string().trim().min(10, 'The part is too short').max(15000), html: richHtml }),
    proc_draft: z.object({ text: z.string().trim().min(30, 'The document is too short').max(30000), html: richHtml }),
    proc_timeline: z.object({
        deadlines: z.array(z.object({
            fromEventKey: z.string().min(1).max(60),
            label: z.string().max(300).default(''),
            endDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(''),
            calc: z.string().max(3000).default('')
        })).max(20),
        violations: z.array(z.object({ eventKey: z.string().min(1).max(60), explanation: z.string().max(3000).default('') })).max(20),
        summary: z.string().max(3000).default('')
    }).refine(a => a.deadlines.length > 0 || a.violations.length > 0, 'Add at least one deadline'),
    // Selections in the document: range, quote, risk comment, new wording (empty = acceptable risk left as is)
    review_contract: z.object({
        items: z.array(z.object({
            from: z.number().int().min(0),
            to: z.number().int().min(1),
            quote: z.string().max(3000),
            comment: z.string().trim().min(5, 'Every edit needs a comment').max(3000),
            replacement: z.string().max(5000).default('')
        }).refine(i => i.to > i.from, 'Empty selection')).min(1, 'Mark at least one fragment').max(60)
    }),
    review_fix_check: z.object({
        decisions: z.array(z.object({
            editId: z.string(),
            decision: z.enum(['accept', 'reject']),
            reason: z.string().max(3000).default(''),
            counter: z.string().max(5000).default('')
        })).min(1).max(60)
    }),
    // A court act may have no errors on levels 4-5, so an empty list is an answer (PRD 4.3)
    review_admin_act: z.object({ items: z.array(selectionItem).min(1, 'Mark at least one fragment').max(60) }),
    review_court_act: z.object({ items: z.array(selectionItem).max(60) }),
    mines: z.object({
        items: z.array(z.object({
            segment: z.number().int().min(0),
            replacement: z.string().max(3000).default(''),
            danger: z.string().max(1000).default(''),
            optionIndex: z.number().int().min(0).max(5).nullable().default(null)
        })).max(60)
    }),
    route_and_apply: z.object({
        qualification: z.string().trim().min(30, 'Describe the legal problem in a few sentences').max(5000),
        steps: z.array(z.object({
            bodyCode: z.string().min(1).max(100),
            // Shown back to the student on rework; the check uses the code only
            bodyName: z.string().max(500).default(''),
            basis: z.string().max(1000).default(''),
            deadline: z.string().max(500).default('')
        })).min(1, 'Add at least one step').max(8),
        document: z.string().trim().min(30, 'The application is too short').max(20000)
    }),
    // Extraction of terms (4.8): one cell per term and document; the source is a selection in that document
    extraction_compare: z.object({
        cells: z.array(z.object({
            documentId: z.string().regex(/^[a-f0-9]{24}$/),
            fieldKey: z.string().min(1).max(60),
            value: z.string().trim().max(2000).default(''),
            absent: z.boolean().default(false),
            quote: z.string().max(3000).default(''),
            from: z.number().int().min(0).nullable().default(null),
            to: z.number().int().min(1).nullable().default(null)
        })).max(75),
        notes: z.string().max(3000).default('')
    }).refine(a => a.cells.some(c => c.absent || c.value), 'Fill at least one term'),
    // The path is kept on the server move by move; the submission only confirms the end of the hearing
    sim_branching: z.object({}).passthrough(),
    sim_hearing: z.object({}).passthrough(),
    proc_next_step: z.object({
        action: z.string().trim().min(5, 'Describe the action').max(3000),
        court: z.string().max(500).default(''),
        courtBasis: z.string().max(3000).default(''),
        deadline: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(''),
        deadlineCalc: z.string().max(3000).default(''),
        fee: z.number().min(0).nullable().default(null),
        feeCalc: z.string().max(3000).default(''),
        consequences: z.string().max(3000).default('')
    })
};

const submitSchema = z.object({
    instanceId: z.string().regex(/^[a-f0-9]{24}$/),
    answer: z.unknown(),
    durationSec: z.coerce.number().int().min(0).max(24 * 3600).default(0)
});

// Submission -> 202 with status "evaluating"; the worker grades it
router.post('/', validateBody(submitSchema), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof submitSchema>;
    const instance = await TaskInstance.findById(body.instanceId);
    if (!instance || String(instance.userId) !== req.user!.id) throw notFound('Task');
    if (instance.closed) throw new HttpError(409, 'closed', 'This task is already finished');

    const schema = answerSchemas[instance.taskType];
    if (!schema) throw new HttpError(400, 'unsupported', `Task type ${instance.taskType} is not supported yet`);
    const answer: any = schema.parse(body.answer);
    // Selections must match the instance document and not overlap
    if (instance.taskType === 'review_contract' || instance.taskType === 'review_court_act' || instance.taskType === 'review_admin_act') {
        const text = instance.content?.documentText ?? '';
        const sorted = [...answer.items].sort((a: any, b: any) => a.from - b.from);
        for (let i = 0; i < sorted.length; i++) {
            const it = sorted[i];
            if (it.to > text.length || text.slice(it.from, it.to) !== it.quote) throw new HttpError(400, 'bad_selection', 'A selection does not match the document');
            if (i > 0 && it.from < sorted[i - 1].to) throw new HttpError(400, 'overlapping_selection', 'Selections overlap');
        }
    }
    if (instance.taskType === 'review_fix_check') {
        const ids = new Set((instance.content?.counterpartyEdits ?? []).map(e => e.id));
        if (answer.decisions.length !== ids.size || answer.decisions.some((d: any) => !ids.has(d.editId))) {
            throw new HttpError(400, 'decisions_incomplete', 'Every counterparty edit needs a decision');
        }
    }

    if (instance.taskType === 'mines') {
        const m = instance.content!.mines!;
        const engine = instance.expected?.engine as any;
        const seen = new Set<number>();
        for (const it of answer.items) {
            if (seen.has(it.segment)) throw new HttpError(400, 'duplicate_segment', 'One answer per phrase');
            seen.add(it.segment);
            // Only phrases opened by a click and holding a mine can be answered
            if (!m.clicks.some(c => c.segment === it.segment && c.mine)) throw new HttpError(400, 'bad_segment', 'Open the phrase first');
            const mine = mineOfSegment<any>(m.segments[it.segment] as any, engine?.mines ?? []);
            const hasOptions = m.simplified && (mine?.options ?? []).length > 0;
            if (hasOptions) {
                if (it.optionIndex == null || it.optionIndex >= mine.options.length) throw new HttpError(400, 'option_required', 'Choose a replacement');
            } else if (it.replacement.trim().length < 3 || it.danger.trim().length < 5) {
                throw new HttpError(400, 'mine_incomplete', 'Write a safe replacement and the danger in one sentence');
            }
        }
    }
    if (instance.taskType === 'proc_timeline') {
        const keys = new Set((instance.content?.timelineEvents ?? []).map(e => e.key));
        if ([...answer.deadlines.map((d: any) => d.fromEventKey), ...answer.violations.map((v: any) => v.eventKey)].some(k => !keys.has(k))) {
            throw new HttpError(400, 'unknown_event', 'Choose events from the case package');
        }
    }
    if (instance.taskType === 'extraction_compare') {
        const ex = instance.content?.extraction as any;
        const docs = new Map<string, string>((ex?.documents ?? []).map((d: any) => [d.id, d.text]));
        const fields = new Map<string, string>((ex?.fields ?? []).map((f: any) => [f.key, f.kind]));
        const seen = new Set<string>();
        for (const c of answer.cells) {
            if (!docs.has(c.documentId) || !fields.has(c.fieldKey)) throw new HttpError(400, 'unknown_cell', 'Fill the terms of the package documents');
            const k = `${c.documentId}|${c.fieldKey}`;
            if (seen.has(k)) throw new HttpError(400, 'duplicate_cell', 'One value per term and document');
            seen.add(k);
            if (c.absent) { c.value = ''; c.quote = ''; c.from = null; c.to = null; continue; }
            if (fields.get(c.fieldKey) === 'date' && c.value && !/^\d{4}-\d{2}-\d{2}$/.test(c.value)) throw new HttpError(400, 'bad_value', 'Date as YYYY-MM-DD');
            // The source must be the exact fragment of the document it was selected in
            if (c.from != null || c.to != null) {
                const text = docs.get(c.documentId)!;
                if (c.from == null || c.to == null || c.to <= c.from || c.to > text.length || text.slice(c.from, c.to) !== c.quote) throw new HttpError(400, 'bad_selection', 'A source does not match the document');
            } else {
                c.quote = '';
            }
        }
    }
    if (instance.taskType === 'route_and_apply') {
        for (const st of answer.steps) {
            if (!(await bodyExists(st.bodyCode))) throw new HttpError(400, 'unknown_body', 'Choose bodies from the list');
        }
    }
    if (instance.taskType === 'sim_branching') {
        const sim = instance.content!.sim!;
        if (!sim.finished) throw new HttpError(409, 'sim_not_finished', 'Finish the hearing first');
        answer.history = sim.history.map(h => ({ nodeId: h.nodeId, choiceId: h.choiceId, justification: h.justification }));
    }

    if (instance.taskType === 'sim_hearing') {
        const hearing = instance.content!.hearing as any;
        if (!hearing?.finished) throw new HttpError(409, 'sim_not_finished', 'Finish the hearing first');
        answer.transcript = hearing.transcript;
    }

    const previous = await Attempt.find({ instanceId: instance._id }).sort({ iteration: 1 });
    if ((instance.taskType === 'sim_branching' || instance.taskType === 'sim_hearing') && previous.length >= 1) throw new HttpError(409, 'no_iterations_left', 'A simulation is played once');
    if (instance.runId && previous.length >= 1) throw new HttpError(409, 'no_iterations_left', 'A stage of a case has one iteration');
    if (instance.isExam && previous.length >= 1) throw new HttpError(409, 'no_iterations_left', 'An exam has one iteration');
    if (previous.length >= 2) throw new HttpError(409, 'no_iterations_left', 'Both iterations are used');
    if (previous.some(a => a.status === 'evaluating')) throw new HttpError(409, 'evaluating', 'The previous answer is still being evaluated');
    if (previous.length === 1 && previous[0].status === 'failed') throw new HttpError(409, 'failed', 'The first answer could not be evaluated yet');

    const iteration = previous.length + 1;
    const attempt = await Attempt.create({
        instanceId: instance._id,
        userId: instance.userId,
        iteration,
        answer,
        durationSec: body.durationSec,
        status: 'evaluating',
        nextRunAt: new Date()
    });
    instance.iterationsUsed = iteration;
    await instance.save();
    res.status(202).json({ attempt: { id: String(attempt._id), iteration, status: attempt.status } });
}));

// The student finishes without a second iteration - the reference answer opens
router.post('/instances/:instanceId/close', asyncHandler(async (req, res) => {
    const instance = await TaskInstance.findById(req.params.instanceId);
    if (!instance || String(instance.userId) !== req.user!.id) throw notFound('Task');
    const evaluated = await Attempt.exists({ instanceId: instance._id, status: { $in: ['auto', 'needs_review', 'moderated'] } });
    if (!evaluated) throw new HttpError(409, 'not_evaluated', 'Submit an answer and wait for the evaluation first');
    instance.closed = true;
    await instance.save();
    res.json({ ok: true });
}));

// Engine details without the right answers - those open together with the reference
function publicDeterministic(details: any, instance: TaskInstanceDoc, showReference: boolean) {
    if (!details) return null;
    const engine = instance.expected?.engine as any;
    if (details.kind === 'review') {
        const flaws: any[] = engine?.flaws ?? [];
        return {
            kind: 'review',
            score: details.score,
            targets: details.targets,
            foundItems: details.found.map((f: any) => f.itemIndex),
            missedCount: details.missed.length,
            extras: details.extras,
            justifiedExtras: details.justifiedExtras,
            againstClientItems: details.againstClient.map((x: any) => x.itemIndex),
            // Full markup with found / missed status after the reference opens
            markup: showReference ? flaws.filter(f => f.badFor === 'both' || f.badFor === engine.clientSide || details.againstClient.some((x: any) => x.flawId === f.id)).map(f => ({
                ...f,
                status: details.found.some((x: any) => x.flawId === f.id) ? 'found' : details.againstClient.some((x: any) => x.flawId === f.id) ? 'against_client' : 'missed'
            })) : null
        };
    }
    // Hearing: everything comes from the student's own transcript, nothing to hide
    if (details.kind === 'hearing') return details;
    if (details.kind === 'timeline') {
        return {
            kind: 'timeline',
            score: details.score,
            checks: details.checks.map((c: any) => (showReference ? c : { key: c.key, label: c.label, ok: c.ok, actual: c.actual, justified: c.justified, rowIndex: c.rowIndex })),
            violationsFound: details.violations.found,
            violationsExtra: details.violations.extra,
            violationsMissedCount: details.violations.missed.length,
            violationsMissed: showReference ? details.violations.missed : null
        };
    }
    if (details.kind === 'court_act') {
        const flaws: any[] = engine?.flaws ?? [];
        return {
            kind: 'court_act',
            score: details.score,
            targets: details.targets,
            foundItems: details.found.map((f: any) => f.itemIndex),
            missedCount: details.missed.length,
            extras: details.extras,
            justifiedExtras: details.justifiedExtras,
            againstClientItems: [],
            wrongValueItems: (details.valueChecks ?? []).filter((v: any) => !v.ok).map((v: any) => v.itemIndex),
            markup: showReference ? flaws.map(f => ({
                ...f,
                status: details.found.some((x: any) => x.flawId === f.id) ? 'found' : 'missed'
            })) : null
        };
    }
    if (details.kind === 'mines') {
        const mines: any[] = engine?.mines ?? [];
        return {
            kind: 'mines',
            score: details.score,
            total: details.total,
            foundCount: details.handled.length,
            handledItems: details.handled.map((h: any) => h.itemIndex),
            missedCount: details.missed.length,
            falseClicks: details.falseClicks,
            wrongOptionItems: details.optionResults.filter((r: any) => !r.ok).map((r: any) => details.handled.find((h: any) => h.mineId === r.mineId)?.itemIndex),
            clean: details.clean,
            markup: showReference ? mines.map(m => ({
                id: m.id, from: m.from, to: m.to, quote: m.quote, type: m.type, severity: m.severity, normRef: m.normRef, explanation: m.explanation, fix: m.fix,
                options: m.options,
                status: details.handled.some((h: any) => h.mineId === m.id) ? 'found' : 'missed'
            })) : null
        };
    }
    if (details.kind === 'route') {
        const names: Record<string, string> = details.names ?? {};
        const routes: any[] = engine?.routes ?? [];
        const facts: any[] = engine?.facts ?? [];
        return {
            kind: 'route',
            score: details.score,
            optimal: details.optimal,
            orderOk: details.orderOk,
            missingPretrialCount: (details.missingPretrial ?? []).length,
            wrongBodies: (details.wrongBodies ?? []).map((c: string) => names[c] ?? c),
            revealedFacts: (details.revealedFacts ?? []).length,
            onRequestTotal: details.onRequestTotal ?? 0,
            routes: showReference ? routes.map((r, i) => ({
                score: r.score, comment: r.comment, matched: details.routeIndex === i,
                steps: r.steps.map((st: any) => ({ ...st, name: names[st.bodyCode] ?? st.bodyCode }))
            })) : null,
            missingPretrial: showReference ? (details.missingPretrial ?? []).map((c: string) => names[c] ?? c) : null,
            // Facts the client told only when asked, shown with the reference so the student sees what to ask
            onRequestFacts: showReference ? facts.filter(f => f.onRequest).map(f => ({ text: f.text, revealed: (details.revealedFacts ?? []).includes(f.key) })) : null
        };
    }
    if (details.kind === 'extraction') {
        // Status per cell right away; the reference values and fragments open with the reference
        const ref: any[] = engine?.cells ?? [];
        return {
            kind: 'extraction',
            score: details.score,
            total: details.total,
            correct: details.correct,
            partial: details.partial,
            wrong: details.wrong,
            empty: details.empty,
            cells: details.cells.map((c: any) => ({
                index: c.index, documentId: c.documentId, fieldKey: c.fieldKey, status: c.status, sourceOk: c.sourceOk, needsSource: c.needsSource,
                actual: c.actual, actualAbsent: c.actualAbsent,
                expected: showReference ? { value: ref[c.index]?.value ?? '', absent: Boolean(ref[c.index]?.absent), quote: ref[c.index]?.quote ?? '' } : null
            }))
        };
    }
    if (details.kind === 'sim') {
        // The simulation is played once, the author's verdicts open with the result
        return {
            kind: 'sim',
            score: details.score,
            outcome: details.outcome,
            steps: details.steps.map((x: any) => ({ index: x.index, stage: x.stage, choiceText: x.choiceText, verdict: x.verdict, explanation: x.explanation, normRef: x.normRef, keyNode: x.keyNode, justification: x.justification }))
        };
    }
    if (details.kind === 'fix_check') {
        const edits: any[] = engine?.edits ?? [];
        return {
            kind: 'fix_check',
            score: details.score,
            correct: details.results.filter((r: any) => r.ok).length,
            total: details.results.length,
            results: showReference ? details.results.map((r: any) => ({ ...r, explanation: edits.find(e => e.id === r.editId)?.explanation ?? '' })) : null
        };
    }
    // Draft requisites and the procedural card: ok / not ok per field, expected values with the reference
    return {
        kind: details.kind ?? 'requisites',
        score: details.score,
        checks: (details.checks ?? []).map((c: any) => showReference ? c : { key: c.key, ok: c.ok, actual: c.actual, justified: c.justified })
    };
}

function publicAttempt(a: AttemptDoc, instance: TaskInstanceDoc, achievements: string[], examHidden = false) {
    const done = a.status !== 'evaluating' && a.status !== 'failed';
    // Reference opens after the second iteration or when the task is closed (PRD 4.0)
    const showReference = done && (a.iteration === 2 || instance.closed);
    // Exam results stay hidden until the teacher publishes them (PRD 5.3)
    if (examHidden) {
        return {
            id: String(a._id),
            instanceId: String(a.instanceId),
            iteration: a.iteration,
            status: done ? 'awaiting_publication' : a.status,
            answer: a.answer,
            createdAt: (a as any).createdAt,
            retries: a.retries,
            finalScore: null, label: null, preliminary: true, criteria: [], aiCriteria: [], errors: [], missing: [],
            feedback: '', improvedVersion: '', deterministic: null, items: [], extras: [], fields: [],
            xpAwarded: 0, moderation: null, instanceBestScore: null, canRework: false, canDispute: false,
            reference: null, achievements: [], isExam: true, dispute: null
        };
    }
    return {
        id: String(a._id),
        instanceId: String(a.instanceId),
        iteration: a.iteration,
        status: a.status,
        answer: a.answer,
        createdAt: (a as any).createdAt,
        retries: a.retries,
        finalScore: done ? a.finalScore : null,
        label: done && a.finalScore != null ? scoreLabel(a.finalScore) : null,
        // Preliminary until moderated (PRD 5.3)
        preliminary: a.status !== 'moderated',
        criteria: done ? a.criteriaFinal : [],
        aiCriteria: done ? a.ai?.criteria ?? [] : [],
        errors: done ? a.ai?.errors ?? [] : [],
        missing: done ? a.ai?.missing ?? [] : [],
        feedback: done ? a.ai?.feedback ?? '' : '',
        improvedVersion: done ? a.ai?.improvedVersion ?? '' : '',
        deterministic: done ? publicDeterministic(a.deterministic?.details, instance, showReference) : null,
        items: done ? (a.ai as any)?.items ?? [] : [],
        extras: done ? (a.ai as any)?.extras ?? [] : [],
        fields: done ? (a.ai as any)?.fields ?? [] : [],
        isExam: instance.isExam,
        runId: instance.runId ? String(instance.runId) : null,
        dispute: a.dispute?.at ? { comment: a.dispute.comment, at: a.dispute.at } : null,
        canDispute: done && !a.dispute?.at && a.status !== 'moderated',
        xpAwarded: a.xpAwarded,
        moderation: a.status === 'moderated' ? { comment: a.moderation?.comment, prevScore: a.moderation?.prevScore } : null,
        instanceBestScore: instance.bestScore,
        canRework: done && a.iteration === 1 && !instance.closed && !instance.isExam,
        explanations: showReference ? (a.explanations ?? {}) : {},
        reference: showReference
            ? { answer: instance.expected?.referenceAnswer ?? '', checklist: instance.expected?.checklist ?? [] }
            : null,
        achievements
    };
}

// Polled by the client every 2 seconds while status is "evaluating"
router.get('/:id', asyncHandler(async (req, res) => {
    const attempt = await Attempt.findById(req.params.id);
    if (!attempt) throw notFound('Attempt');
    if (req.user!.role === 'student' && String(attempt.userId) !== req.user!.id) throw notFound('Attempt');
    const instance = await TaskInstance.findById(attempt.instanceId);
    if (!instance) throw notFound('Task');
    // Achievements earned by this attempt, shown once as a toast on the result screen
    const achievements = attempt.status === 'evaluating' ? [] : (await UserAchievement.find({
        userId: attempt.userId,
        earnedAt: { $gte: (attempt as any).createdAt }
    }).lean()).map(x => x.code);
    let examHidden = false;
    if (instance.isExam && req.user!.role === 'student') {
        const assignment = await Assignment.findById(instance.assignmentId).lean();
        examHidden = !assignment?.resultsPublished;
    }
    res.json({ attempt: publicAttempt(attempt, instance, achievements, examHidden) });
}));

// explainResult: a plain-language explanation of an engine mismatch, available once the reference is open
router.post('/:id/explain', validateBody(z.object({ key: z.string().min(1).max(60) })), asyncHandler(async (req, res) => {
    const attempt = await Attempt.findById(req.params.id);
    if (!attempt || String(attempt.userId) !== req.user!.id) throw notFound('Attempt');
    const instance = await TaskInstance.findById(attempt.instanceId);
    if (!instance) throw notFound('Task');
    const done = !['evaluating', 'failed'].includes(attempt.status);
    if (!done || !(attempt.iteration === 2 || instance.closed)) throw new HttpError(409, 'reference_closed', 'The explanation opens together with the reference');
    if (instance.isExam && !(await Assignment.findById(instance.assignmentId).lean())?.resultsPublished) throw new HttpError(409, 'reference_closed', 'Exam results are not published yet');
    try {
        const explanation = await explainCheck(attempt, instance, req.body.key);
        if (!explanation) throw new HttpError(400, 'nothing_to_explain', 'This field matches the engine');
        res.json({ key: req.body.key, explanation });
    } catch (e) {
        if (e instanceof EvaluationDeferred) throw new HttpError(503, 'llm_unavailable', 'The AI is not available right now');
        throw e;
    }
}));

const disputeSchema = z.object({ comment: z.string().trim().min(10, 'Explain what is wrong with the score').max(2000) });

// STD-5: the student disputes the AI score - the attempt goes to the moderation queue
router.post('/:id/dispute', validateBody(disputeSchema), asyncHandler(async (req, res) => {
    const attempt = await Attempt.findById(req.params.id);
    if (!attempt || String(attempt.userId) !== req.user!.id) throw notFound('Attempt');
    if (!['auto', 'needs_review'].includes(attempt.status)) throw new HttpError(409, 'not_disputable', 'This score cannot be disputed');
    if (attempt.dispute?.at) throw new HttpError(409, 'already_disputed', 'Already disputed');
    attempt.set({
        dispute: { comment: req.body.comment, at: new Date() },
        status: 'needs_review',
        reviewReasons: [...new Set([...(attempt.reviewReasons ?? []), 'student_dispute'])]
    });
    await attempt.save();
    res.json({ ok: true });
}));

// History of the current user (STD-4)
router.get('/', asyncHandler(async (req, res) => {
    const limit = Math.min(50, Number(req.query.limit) || 20);
    const attempts = await Attempt.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(limit).lean();
    const instances = await TaskInstance.find({ _id: { $in: attempts.map(a => a.instanceId) } }).select('content.title mode taskType difficulty').lean();
    const byId = new Map(instances.map(i => [String(i._id), i]));
    const hidden = await hiddenExamInstanceIds(req.user!.id, attempts.map(a => a.instanceId));
    res.json({
        attempts: attempts.map(a => {
            const i = byId.get(String(a.instanceId));
            if (hidden.has(String(a.instanceId))) {
                return { id: String(a._id), instanceId: String(a.instanceId), title: i?.content?.title ?? '', mode: i?.mode, taskType: i?.taskType, difficulty: i?.difficulty, iteration: a.iteration, status: a.status === 'evaluating' ? 'evaluating' : 'awaiting_publication', finalScore: null, xpAwarded: 0, createdAt: (a as any).createdAt };
            }
            return {
                id: String(a._id),
                instanceId: String(a.instanceId),
                title: i?.content?.title ?? '',
                mode: i?.mode,
                taskType: i?.taskType,
                difficulty: i?.difficulty,
                iteration: a.iteration,
                status: a.status,
                finalScore: a.finalScore,
                xpAwarded: a.xpAwarded,
                createdAt: (a as any).createdAt
            };
        })
    });
}));

export default router;
