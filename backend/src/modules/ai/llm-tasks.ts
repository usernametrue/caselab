import { env } from '../../config/env';

// Every AI function of the platform is a task: the model tier, effort, thinking and output limit live here,
// so balancing cost and quality is one table and LLM_TASK_MODELS in .env, not a search through the services.
// Haiku writes short texts in front of the student; Sonnet grades and drafts what a lawyer will publish.

type Tier = 'fast' | 'smart';
type Effort = 'low' | 'medium' | 'high';

interface TaskConfig {
    tier: Tier;
    effort: Effort;
    // Adaptive thinking; without it Haiku answers with thinking off, Sonnet without up-front thinking
    think: boolean;
    // Thinking counts toward this limit too. Up to 21 000 a request may stay non-streaming in the SDK.
    maxTokens: number;
}

export const LLM_TASKS = {
    generateInstance: { tier: 'fast', effort: 'medium', think: false, maxTokens: 3000 },
    generateClientStory: { tier: 'fast', effort: 'medium', think: false, maxTokens: 3000 },
    clientReply: { tier: 'fast', effort: 'low', think: false, maxTokens: 600 },
    // Participants of the hearing simulation answer the student live: the fast model, short replies
    hearingTurn: { tier: 'fast', effort: 'medium', think: false, maxTokens: 1500 },
    explainResult: { tier: 'fast', effort: 'low', think: false, maxTokens: 800 },
    weeklySummary: { tier: 'fast', effort: 'low', think: false, maxTokens: 1000 },
    generateCourtAct: { tier: 'fast', effort: 'medium', think: false, maxTokens: 3000 },
    generateOpponentDoc: { tier: 'smart', effort: 'low', think: false, maxTokens: 3000 },
    evaluate: { tier: 'smart', effort: 'medium', think: true, maxTokens: 16000 },
    generateFlawedDocument: { tier: 'smart', effort: 'medium', think: true, maxTokens: 20000 },
    injectActErrors: { tier: 'smart', effort: 'medium', think: true, maxTokens: 20000 },
    generateTemplate: { tier: 'smart', effort: 'medium', think: true, maxTokens: 16000 },
    generateTrack: { tier: 'smart', effort: 'medium', think: true, maxTokens: 16000 }
} satisfies Record<string, TaskConfig>;

export type LlmTaskName = keyof typeof LLM_TASKS;

// "evaluate=claude-sonnet-5-5,clientReply=claude-haiku-5-5": a model for one task without a deploy of code
function overrides(): Map<string, string> {
    const raw = env().LLM_TASK_MODELS ?? '';
    return new Map(raw.split(',').map(p => p.split('=').map(s => s.trim())).filter(p => p.length === 2 && p[0] && p[1]) as [string, string][]);
}

let overrideCache: { raw: string; map: Map<string, string> } | null = null;

export function modelFor(task: LlmTaskName): string {
    const raw = env().LLM_TASK_MODELS ?? '';
    if (!overrideCache || overrideCache.raw !== raw) overrideCache = { raw, map: overrides() };
    return overrideCache.map.get(task) ?? (LLM_TASKS[task].tier === 'fast' ? env().LLM_MODEL_FAST : env().LLM_MODEL_SMART);
}

// Thinking is switched off differently per family (Claude 5.5): Haiku accepts "disabled", Sonnet answers without
// up-front thinking with "between_tools", Opus cannot turn it off - there low effort keeps it short
export function thinkingFor(model: string, think: boolean): { type: 'adaptive' } | { type: 'disabled' } | { type: 'between_tools' } | undefined {
    if (think) return { type: 'adaptive' };
    if (model.includes('haiku')) return { type: 'disabled' };
    if (model.includes('sonnet')) return { type: 'between_tools' };
    return undefined;
}

// USD per million tokens: input, output, cache write 5m, cache write 1h, cache read
// (platform.claude.com/docs/en/about-claude/pricing, November 2026; Haiku prompts up to 100K tokens)
const PRICES: [prefix: string, price: [number, number, number, number, number]][] = [
    ['claude-haiku-5-5', [0.1, 0.5, 0.125, 0.2, 0.01]],
    ['claude-sonnet-5-5', [2, 10, 2.5, 4, 0.1]],
    ['claude-opus-5-5', [4, 20, 5, 8, 0.2]]
];

export interface UsageLike {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null;
}

// Cost of one call for the AI log; a model outside the table counts as 0 (the tokens are still logged)
export function costUsd(model: string, u: UsageLike, batch = false): number {
    const p = PRICES.find(([prefix]) => model.startsWith(prefix))?.[1];
    if (!p) return 0;
    const write = u.cache_creation_input_tokens ?? 0;
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const write5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, write - write1h);
    const usd = ((u.input_tokens ?? 0) * p[0] + (u.output_tokens ?? 0) * p[1] + write5m * p[2] + write1h * p[3] + (u.cache_read_input_tokens ?? 0) * p[4]) / 1e6;
    return Math.round((batch ? usd / 2 : usd) * 1e6) / 1e6;
}
