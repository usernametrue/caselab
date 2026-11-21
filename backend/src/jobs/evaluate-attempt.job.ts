import { Attempt } from '../modules/attempts/attempt.model';
import { EvaluationDeferred, evaluateAttempt } from '../modules/attempts/evaluation.service';
import { env } from '../config/env';
import { logError, logInfo, logWarn } from '../logger';

// Evaluation queue on top of the attempts collection itself: an attempt with status "evaluating"
// and nextRunAt <= now is claimed atomically, so several api containers never grade it twice.
// Replaces Agenda from the PRD - same guarantees (survives restarts, retries) without a dependency.

const LOCK_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 10 * 60 * 1000; // PRD 9.5: retry after 10 minutes when the LLM is unavailable
const MAX_RETRIES = 6;

let timer: NodeJS.Timeout | null = null;
let running = 0;

async function claimNext() {
    const now = new Date();
    return Attempt.findOneAndUpdate(
        {
            status: 'evaluating',
            nextRunAt: { $lte: now },
            $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }]
        },
        { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) } },
        { sort: { nextRunAt: 1 }, new: true }
    );
}

export async function processOne(): Promise<boolean> {
    const attempt = await claimNext();
    if (!attempt) return false;
    try {
        await evaluateAttempt(attempt);
        logInfo('attempt evaluated', {}, { attemptId: String(attempt._id), score: attempt.finalScore, status: attempt.status });
    } catch (e: any) {
        const retries = attempt.retries + 1;
        const deferred = e instanceof EvaluationDeferred;
        const giveUp = retries > MAX_RETRIES;
        await Attempt.updateOne({ _id: attempt._id }, {
            $set: {
                lockedUntil: null,
                retries,
                lastError: String(e?.message ?? e).slice(0, 500),
                nextRunAt: new Date(Date.now() + (deferred ? RETRY_DELAY_MS : 60_000)),
                ...(giveUp ? { status: 'failed' } : {})
            }
        });
        if (deferred) logWarn('evaluation deferred', {}, { attemptId: String(attempt._id), reason: e.message, retries });
        else logError(e, {}, { attemptId: String(attempt._id) });
    }
    return true;
}

export function startEvaluationWorker() {
    const concurrency = Math.max(1, env().LLM_CONCURRENCY);
    const tick = async () => {
        while (running < concurrency) {
            running++;
            let got = false;
            try {
                got = await processOne();
            } catch (e) {
                logError(e as Error);
            } finally {
                running--;
            }
            if (!got) break;
        }
    };
    timer = setInterval(() => { void tick(); }, env().EVAL_POLL_MS);
    logInfo('evaluation worker started', {}, { concurrency, pollMs: env().EVAL_POLL_MS });
}

export function stopEvaluationWorker() {
    if (timer) clearInterval(timer);
    timer = null;
}

// Manual retry of a failed attempt (admin) - puts it back into the queue
export async function requeue(attemptId: string) {
    await Attempt.updateOne({ _id: attemptId }, { $set: { status: 'evaluating', nextRunAt: new Date(), lockedUntil: null, retries: 0 } });
}
