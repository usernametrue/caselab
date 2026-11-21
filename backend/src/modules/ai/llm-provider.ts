import type { ZodType } from 'zod';
import type { LlmTaskName } from './llm-tasks';

// Provider abstraction (PRD 10.1) - services never call a vendor SDK directly

// The prompt goes in parts from the most stable to the least: the provider puts cache breakpoints after
// "shared", "system" and "context", so repeated calls pay for those tokens at the cache-read price
export interface GenerateJsonRequest<T> {
    // Model, effort, thinking and output limit come from LLM_TASKS
    task: LlmTaskName;
    // Instructions common to several prompts (the grading rules) - one cache entry for all of them
    shared?: string;
    // Instructions of this prompt, the same on every call
    system: string;
    // Material repeated between calls: rubric, document, client facts
    context?: string;
    // What changes on every call: values, the student's answer
    user: string;
    schema: ZodType<T>;
    maxTokens?: number;
}

export interface GenerateJsonResult<T> {
    data: T;
    // All input tokens, cached ones included
    tokensIn: number;
    tokensOut: number;
    cacheRead: number;
    cacheWrite: number;
    costUsd: number;
    model: string;
}

export type BatchOutcome =
    | { customId: string; ok: true; message: unknown }
    | { customId: string; ok: false; retryable: boolean; error: string };

// Message Batches: half the price, results within 24 hours (usually within an hour)
export interface LlmBatchApi {
    submit(items: { customId: string; req: GenerateJsonRequest<unknown> }[]): Promise<string>;
    ended(batchId: string): Promise<boolean>;
    results(batchId: string): AsyncIterable<BatchOutcome>;
    // Validates a batch answer exactly like a direct call; throws when it does not match the schema
    parse<T>(message: unknown, req: GenerateJsonRequest<T>): GenerateJsonResult<T>;
}

export interface LlmProvider {
    generateJson<T>(req: GenerateJsonRequest<T>): Promise<GenerateJsonResult<T>>;
    batch?: LlmBatchApi;
}

export class LlmUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'LlmUnavailableError';
    }
}

// Request pacing shared by all calls of the process: at most `rpm` starts per minute and `concurrency` in flight
export class RateGate {
    private queue: (() => void)[] = [];
    private active = 0;
    private starts: number[] = [];

    constructor(private rpm: number, private concurrency: number) {}

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.active--;
            this.pump();
        }
    }

    private acquire() {
        return new Promise<void>(resolve => {
            this.queue.push(resolve);
            this.pump();
        });
    }

    private pump() {
        const now = Date.now();
        this.starts = this.starts.filter(t => now - t < 60_000);
        while (this.queue.length && this.active < this.concurrency && this.starts.length < this.rpm) {
            this.active++;
            this.starts.push(Date.now());
            this.queue.shift()!();
        }
        if (this.queue.length && this.starts.length >= this.rpm) {
            const wait = 60_000 - (now - this.starts[0]) + 10;
            setTimeout(() => this.pump(), wait);
        }
    }
}
