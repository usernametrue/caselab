import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z, type ZodType } from 'zod';
import { env, isLlmConfigured } from '../../config/env';
import { LLM_TASKS, costUsd, modelFor, thinkingFor, type UsageLike } from './llm-tasks';
import { LlmUnavailableError, RateGate, type BatchOutcome, type GenerateJsonRequest, type GenerateJsonResult, type LlmBatchApi, type LlmProvider } from './llm-provider';

// Structured outputs need the schema with additionalProperties=false and without min/max: the SDK helper
// prepares it, once per zod object. null = the API refused this schema, the prompt then asks for JSON itself.
const formats = new WeakMap<ZodType<unknown>, Record<string, unknown> | null>();

function formatFor(schema: ZodType<unknown>) {
    if (!formats.has(schema)) {
        try {
            formats.set(schema, zodOutputFormat(schema as any).schema as Record<string, unknown>);
        } catch {
            formats.set(schema, null);
        }
    }
    return formats.get(schema) ?? null;
}

class SchemaMismatch extends Error {
    override name = 'SchemaMismatch';
}

const isUnavailable = (err: unknown) =>
    err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError
    || (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503));

const tokens = (u: UsageLike) => ({
    tokensIn: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    tokensOut: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0
});

export class ClaudeProvider implements LlmProvider {
    private client: Anthropic;
    private gate: RateGate;

    constructor() {
        if (!isLlmConfigured()) throw new LlmUnavailableError('ANTHROPIC_API_KEY is not set');
        // 429 and 5xx - up to 3 retries with exponential backoff (PRD 9.5)
        this.client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY!, maxRetries: 3 });
        this.gate = new RateGate(env().LLM_RPM, env().LLM_CONCURRENCY);
    }

    // One request body for a direct call and for a batch item: same prefix, same cache entries
    params(req: GenerateJsonRequest<unknown>, opts: { ttl?: '5m' | '1h'; note?: string } = {}): Anthropic.MessageCreateParamsNonStreaming {
        const model = modelFor(req.task);
        const cfg = LLM_TASKS[req.task];
        const ttl = opts.ttl ?? env().LLM_CACHE_TTL;
        const cache = ttl === '1h' ? { type: 'ephemeral' as const, ttl: '1h' as const } : { type: 'ephemeral' as const };
        const block = (text: string, cached: boolean) => ({ type: 'text' as const, text, ...(cached ? { cache_control: cache } : {}) });
        const format = formatFor(req.schema);
        // Without structured outputs the schema goes into the request: still valid JSON, a little more input
        const schemaNote = format ? '' : `\n\nОтветь только JSON-объектом по этой схеме:\n${JSON.stringify(z.toJSONSchema(req.schema))}`;
        const thinking = thinkingFor(model, cfg.think);
        const system = [...(req.shared?.trim() ? [block(req.shared, true)] : []), block(req.system, true)];
        const content = [
            ...(req.context?.trim() ? [block(req.context, true)] : []),
            block(`${req.user}${schemaNote}`, false),
            ...(opts.note ? [block(opts.note, false)] : [])
        ];
        return {
            model,
            max_tokens: req.maxTokens ?? cfg.maxTokens,
            system,
            messages: [{ role: 'user', content }],
            output_config: { effort: cfg.effort, ...(format ? { format: { type: 'json_schema', schema: format } } : {}) },
            ...(thinking ? { thinking } : {})
        };
    }

    parse<T>(message: unknown, req: GenerateJsonRequest<T>, batch = false): GenerateJsonResult<T> {
        const m = message as Anthropic.Message;
        const usage = (m.usage ?? {}) as UsageLike;
        // A cut-off or blocked answer is not retried with the same limit: the cause goes to AiLog as is
        if (m.stop_reason === 'max_tokens') {
            throw new Error(`LLM answer cut off at max_tokens=${req.maxTokens ?? LLM_TASKS[req.task].maxTokens} (task ${req.task}, model ${m.model}, output ${usage.output_tokens ?? '?'} tokens incl. thinking) - raise maxTokens in LLM_TASKS or lower its effort`);
        }
        if (m.stop_reason === 'refusal') throw new Error(`LLM refused to answer (task ${req.task}, model ${m.model})`);
        const text = (m.content ?? []).flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
        let json: unknown;
        try {
            json = JSON.parse(text);
        } catch {
            throw new SchemaMismatch('Твой прошлый ответ не был корректным JSON. Верни только JSON по схеме.');
        }
        const parsed = req.schema.safeParse(json);
        if (!parsed.success) {
            throw new SchemaMismatch(`Твой прошлый ответ не прошел проверку схемы: ${parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}. Исправь и верни JSON.`);
        }
        return { data: parsed.data, ...tokens(usage), costUsd: costUsd(m.model, usage, batch), model: m.model };
    }

    async generateJson<T>(req: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>> {
        let spent = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
        let note: string | undefined;
        // One extra attempt with the validation error when the answer does not match the schema (PRD 10.1)
        // The note goes after the cached blocks, so the retry still reads them from the cache
        for (let validationTry = 0; validationTry < 2; validationTry++) {
            const message = await this.create(req, note);
            const usage = (message.usage ?? {}) as UsageLike;
            const t = tokens(usage);
            spent = {
                tokensIn: spent.tokensIn + t.tokensIn, tokensOut: spent.tokensOut + t.tokensOut, cacheRead: spent.cacheRead + t.cacheRead,
                cacheWrite: spent.cacheWrite + t.cacheWrite, costUsd: spent.costUsd + costUsd(message.model, usage)
            };
            try {
                const r = this.parse(message, req);
                return { ...r, ...spent, costUsd: Math.round(spent.costUsd * 1e6) / 1e6 };
            } catch (e) {
                if (!(e instanceof SchemaMismatch)) throw e;
                note = e.message;
            }
        }
        throw new Error('LLM response did not match the schema after a retry');
    }

    private async create(req: GenerateJsonRequest<unknown>, note?: string): Promise<Anthropic.Message> {
        try {
            return await this.gate.run(() => this.client.messages.create(this.params(req, { note })));
        } catch (err) {
            // A schema the grammar compiler refuses: remembered, the request repeats with the schema in the prompt
            if (err instanceof Anthropic.BadRequestError && /schema/i.test(err.message) && formats.get(req.schema)) {
                formats.set(req.schema, null);
                return this.create(req, note);
            }
            if (isUnavailable(err)) throw new LlmUnavailableError(`LLM unavailable: ${(err as Error).message}`);
            throw err;
        }
    }

    readonly batch: LlmBatchApi = {
        // Batches run longer than 5 minutes: the shared prefix is cached for an hour
        submit: async items => (await this.client.messages.batches.create({
            requests: items.map(i => ({ custom_id: i.customId, params: this.params(i.req, { ttl: '1h' }) }))
        })).id,
        ended: async id => (await this.client.messages.batches.retrieve(id)).processing_status === 'ended',
        results: (id: string) => this.batchResults(id),
        parse: (message, req) => this.parse(message, req, true)
    };

    private async *batchResults(id: string): AsyncIterable<BatchOutcome> {
        for await (const r of await this.client.messages.batches.results(id)) {
            const res = r.result;
            if (res.type === 'succeeded') yield { customId: r.custom_id, ok: true, message: res.message };
            else if (res.type === 'errored') {
                // A wrong request body fails again as is; server errors are worth another batch
                const type = (res.error as any)?.error?.type ?? '';
                yield { customId: r.custom_id, ok: false, retryable: type !== 'invalid_request_error', error: `${type}: ${(res.error as any)?.error?.message ?? ''}` };
            } else yield { customId: r.custom_id, ok: false, retryable: true, error: res.type };
        }
    }
}

let instance: LlmProvider | null = null;
let override: LlmProvider | null | undefined;

// null when the key or model is not configured - callers use their fallback
export function getLlm(): LlmProvider | null {
    if (override !== undefined) return override;
    if (!isLlmConfigured()) return null;
    if (!instance) instance = new ClaudeProvider();
    return instance;
}

// Tests swap the provider; undefined restores the real one
export function setLlmForTests(p: LlmProvider | null | undefined) {
    const previous = override;
    override = p;
    return previous;
}
