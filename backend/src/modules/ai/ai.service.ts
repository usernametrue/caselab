import { AiLog } from '../attempts/attempt.model';
import { logWarn } from '../../logger';
import { getLlm } from './claude.provider';
import { LlmUnavailableError, type GenerateJsonRequest, type GenerateJsonResult } from './llm-provider';

export interface AiCall<T> extends GenerateJsonRequest<T> {
    promptVersion: string;
    // AiLog purpose; the task name by default
    purpose?: string;
    attemptId?: unknown;
}

export const aiAvailable = () => getLlm() !== null;

// The log is written after the answer: the student does not wait for it
export function logAi(row: Record<string, unknown>) {
    void AiLog.create(row).catch(e => logWarn('AiLog write failed', {}, { error: String(e?.message ?? e) }));
}

// Every direct call goes through here: one AiLog row with tokens, cache use and cost, or the error text
export async function aiGenerate<T>(call: AiCall<T>): Promise<GenerateJsonResult<T>> {
    const llm = getLlm();
    if (!llm) throw new LlmUnavailableError('ANTHROPIC_API_KEY is not set');
    const { promptVersion, purpose = call.task, attemptId = null, ...req } = call;
    const started = Date.now();
    try {
        const r = await llm.generateJson(req);
        logAi({
            purpose, attemptId, model: r.model, promptVersion, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
            cacheRead: r.cacheRead, cacheWrite: r.cacheWrite, costUsd: r.costUsd, latencyMs: Date.now() - started
        });
        return r;
    } catch (e: any) {
        logAi({ purpose, attemptId, promptVersion, latencyMs: Date.now() - started, error: String(e?.message ?? e) });
        throw e;
    }
}
