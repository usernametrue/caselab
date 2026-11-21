import { randomUUID } from 'crypto';
import { Schema, model, type InferSchemaType, type Types } from 'mongoose';
import type { ZodType } from 'zod';
import { env } from '../../config/env';
import { logError, logInfo, logWarn } from '../../logger';
import { getLlm } from './claude.provider';
import { aiGenerate, logAi } from './ai.service';
import { LlmUnavailableError, type GenerateJsonRequest, type LlmProvider } from './llm-provider';
import type { LlmTaskName } from './llm-tasks';

// Background AI work through Message Batches: half the price of a direct call, results usually within an hour.
// A job is stored first and sent with everything else queued during the poll interval, so a burst of
// requests (a pool of tasks for tomorrow) becomes one batch. Jobs survive restarts; several api containers
// claim them atomically, as the evaluation queue does.

const aiJobSchema = new Schema({
    kind: { type: String, required: true },
    status: { type: String, enum: ['queued', 'submitting', 'submitted', 'done', 'failed'], default: 'queued' },
    request: {
        task: { type: String, required: true },
        shared: { type: String, default: '' },
        system: { type: String, required: true },
        context: { type: String, default: '' },
        user: { type: String, required: true },
        maxTokens: { type: Number, default: null }
    },
    promptVersion: { type: String, default: '' },
    // Everything the handler needs to finish the work when the answer comes
    meta: { type: Schema.Types.Mixed, default: {} },
    // A short label for the admin's list of drafts in progress
    label: { type: String, default: '' },
    batchId: { type: String, default: null },
    claim: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    tries: { type: Number, default: 0 },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    submittedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date(), expires: 60 * 60 * 24 * 30 }
});
aiJobSchema.index({ status: 1, createdAt: 1 });
aiJobSchema.index({ batchId: 1 });
aiJobSchema.index({ kind: 1, 'meta.key': 1, status: 1 });

export const AiJob = model('AiJob', aiJobSchema, 'aiJobs');
export type AiJobDoc = InferSchemaType<typeof aiJobSchema> & { _id: Types.ObjectId };

export interface JobHandler<T> {
    schema: ZodType<T>;
    // Turns the AI answer into records; the return value is kept on the job (ids for the admin's links)
    onResult(meta: any, data: T, job: { id: string | null; createdBy: unknown; organizationId: unknown; model: string }): Promise<unknown>;
}

const handlers = new Map<string, JobHandler<any>>();

export function registerJobHandler<T>(kind: string, handler: JobHandler<T>) {
    handlers.set(kind, handler);
}

const MAX_TRIES = 3;
const BATCH_MAX = 5000;
const LOCK_MS = 10 * 60 * 1000;

export const batchEnabled = (llm: LlmProvider | null = getLlm()) => Boolean(llm?.batch) && env().LLM_BATCH === 'on';

export interface JobRequest {
    task: LlmTaskName;
    shared?: string;
    system: string;
    context?: string;
    user: string;
    maxTokens?: number;
}

export const publicJob = (j: any) => ({
    id: String(j._id), kind: j.kind, status: j.status, label: j.label, result: j.result, error: j.error,
    createdAt: j.createdAt, finishedAt: j.finishedAt
});

// With batches on, the job is queued and the caller answers "in progress"; without them (no key for batches,
// LLM_BATCH=off, tests) the same handler runs right away, so both paths give the same records
export async function runOrQueue(kind: string, req: JobRequest, opts: { promptVersion: string; meta: object; label?: string; createdBy?: unknown; organizationId?: unknown }) {
    const handler = handlers.get(kind);
    if (!handler) throw new Error(`No AI job handler for ${kind}`);
    const llm = getLlm();
    if (!llm) throw new LlmUnavailableError('ANTHROPIC_API_KEY is not set');
    if (batchEnabled(llm)) {
        const job = await AiJob.create({
            kind, request: req, promptVersion: opts.promptVersion, meta: opts.meta, label: opts.label ?? '',
            createdBy: opts.createdBy ?? null, organizationId: opts.organizationId ?? null
        });
        return { queued: true as const, job: publicJob(job) };
    }
    const r = await aiGenerate({ ...req, schema: handler.schema, promptVersion: opts.promptVersion, purpose: req.task });
    const result = await handler.onResult(opts.meta, r.data, { id: null, createdBy: opts.createdBy ?? null, organizationId: opts.organizationId ?? null, model: r.model });
    return { queued: false as const, result };
}

const toRequest = (j: any, schema: ZodType<unknown>): GenerateJsonRequest<unknown> => ({
    task: j.request.task, shared: j.request.shared || undefined, system: j.request.system,
    context: j.request.context || undefined, user: j.request.user, maxTokens: j.request.maxTokens ?? undefined, schema
});

// ---------- Worker ----------

async function submitQueued(llm: LlmProvider) {
    const now = new Date();
    // A container that died between claim and submit leaves "submitting": the jobs go back to the queue
    await AiJob.updateMany({ status: 'submitting', lockedUntil: { $lt: now } }, { $set: { status: 'queued', claim: null } });
    const ids = (await AiJob.find({ status: 'queued' }).sort({ createdAt: 1 }).limit(BATCH_MAX).select('_id').lean()).map(j => j._id);
    if (!ids.length) return;
    const claim = randomUUID();
    await AiJob.updateMany({ _id: { $in: ids }, status: 'queued' }, { $set: { status: 'submitting', claim, lockedUntil: new Date(now.getTime() + LOCK_MS) } });
    const jobs = await AiJob.find({ claim, status: 'submitting' }).lean();
    const orphans = jobs.filter(j => !handlers.has(j.kind)).map(j => j._id);
    if (orphans.length) await AiJob.updateMany({ _id: { $in: orphans } }, { $set: { status: 'failed', error: 'No handler for this kind', finishedAt: now } });
    const items = jobs.filter(j => handlers.has(j.kind)).map(j => ({ customId: String(j._id), req: toRequest(j, handlers.get(j.kind)!.schema) }));
    if (!items.length) return;
    try {
        const batchId = await llm.batch!.submit(items);
        await AiJob.updateMany({ claim }, { $set: { status: 'submitted', batchId, submittedAt: new Date(), lockedUntil: null } });
        logInfo('AI batch submitted', {}, { batchId, jobs: items.length });
    } catch (e: any) {
        await AiJob.updateMany({ claim }, { $set: { status: 'queued', claim: null, lockedUntil: null, error: String(e?.message ?? e).slice(0, 500) }, $inc: { tries: 1 } });
        await AiJob.updateMany({ claim: null, status: 'queued', tries: { $gte: MAX_TRIES } }, { $set: { status: 'failed', finishedAt: new Date() } });
        logWarn('AI batch submit failed', {}, { error: String(e?.message ?? e), jobs: items.length });
    }
}

async function finishJob(llm: LlmProvider, job: any, message: unknown) {
    const h = handlers.get(job.kind)!;
    const req = toRequest(job, h.schema);
    let r;
    try {
        r = llm.batch!.parse(message, req);
    } catch (e: any) {
        if (e?.name !== 'SchemaMismatch') throw e;
        // A rare answer that misses the schema gets one direct call with the full validation loop
        r = await aiGenerate({ ...req, promptVersion: job.promptVersion, purpose: `${job.request.task}:retry` });
    }
    logAi({
        purpose: job.request.task, model: r.model, promptVersion: job.promptVersion, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
        cacheRead: r.cacheRead, cacheWrite: r.cacheWrite, costUsd: r.costUsd, batch: true,
        latencyMs: Date.now() - new Date(job.submittedAt ?? job.createdAt).getTime()
    });
    const result = await h.onResult(job.meta, r.data, { id: String(job._id), createdBy: job.createdBy, organizationId: job.organizationId, model: r.model });
    await AiJob.updateOne({ _id: job._id }, { $set: { status: 'done', result: result ?? null, error: null, finishedAt: new Date() } });
}

async function collectEnded(llm: LlmProvider) {
    const batchIds = (await AiJob.distinct('batchId', { status: 'submitted' })).filter(Boolean) as string[];
    for (const batchId of batchIds) {
        let ended = false;
        try {
            ended = await llm.batch!.ended(batchId);
        } catch (e: any) {
            logWarn('AI batch status failed', {}, { batchId, error: String(e?.message ?? e) });
            continue;
        }
        if (!ended) continue;
        const jobs = new Map((await AiJob.find({ batchId, status: 'submitted' }).lean()).map(j => [String(j._id), j]));
        for await (const out of llm.batch!.results(batchId)) {
            const job = jobs.get(out.customId);
            if (!job) continue;
            jobs.delete(out.customId);
            try {
                if (!out.ok) throw Object.assign(new Error(out.error), { retryable: out.retryable });
                // A cut-off answer or a failing handler would fail the same way in the next batch
                await finishJob(llm, job, out.message).catch(e => { throw Object.assign(e, { retryable: false }); });
            } catch (e: any) {
                const tries = job.tries + 1;
                const retry = e?.retryable !== false && tries < MAX_TRIES;
                await AiJob.updateOne({ _id: job._id }, {
                    $set: retry
                        ? { status: 'queued', batchId: null, claim: null, tries, error: String(e?.message ?? e).slice(0, 500) }
                        : { status: 'failed', tries, error: String(e?.message ?? e).slice(0, 500), finishedAt: new Date() }
                });
                logAi({ purpose: job.request?.task, promptVersion: job.promptVersion, batch: true, error: String(e?.message ?? e) });
            }
        }
        // Jobs the results did not mention go to the next batch
        if (jobs.size) await AiJob.updateMany({ _id: { $in: [...jobs.keys()] } }, { $set: { status: 'queued', batchId: null, claim: null }, $inc: { tries: 1 } });
    }
}

let timer: NodeJS.Timeout | null = null;
let busy = false;

// One tick: results of finished batches first, then everything queued goes out as one new batch
export async function batchTick() {
    const llm = getLlm();
    if (!batchEnabled(llm) || busy) return;
    busy = true;
    try {
        await collectEnded(llm!);
        await submitQueued(llm!);
    } catch (e) {
        logError(e as Error);
    } finally {
        busy = false;
    }
}

export function startAiBatchWorker() {
    if (!batchEnabled()) return;
    timer = setInterval(() => { void batchTick(); }, env().LLM_BATCH_POLL_MS);
    logInfo('AI batch worker started', {}, { pollMs: env().LLM_BATCH_POLL_MS });
}

export function stopAiBatchWorker() {
    if (timer) clearInterval(timer);
    timer = null;
}
