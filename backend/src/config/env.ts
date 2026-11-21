import { z } from 'zod';

// All runtime configuration comes from environment variables (see .env.sample)
const schema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.coerce.number().default(3000),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().default(7),
    CORS_ORIGIN: z.string().default('http://localhost:3001'),
    // Claude (Anthropic API) - the key stays on the server only
    ANTHROPIC_API_KEY: z.string().optional(),
    // Short texts in front of the student / grading and drafts for the lawyer (src/modules/ai/llm-tasks.ts)
    LLM_MODEL_FAST: z.string().default('claude-haiku-5-5'),
    LLM_MODEL_SMART: z.string().default('claude-sonnet-5-5'),
    // A model for single tasks: "evaluate=claude-opus-5-5,clientReply=claude-haiku-5-5"
    LLM_TASK_MODELS: z.string().optional(),
    LLM_RPM: z.coerce.number().default(50),
    LLM_CONCURRENCY: z.coerce.number().default(4),
    // Prompt cache lifetime for direct calls: 5m is cheaper to write, 1h pays off with calls 5-60 minutes apart
    LLM_CACHE_TTL: z.enum(['5m', '1h']).default('5m'),
    // Background work through Message Batches (half the price): pool of tasks, weekly summaries, admin drafts
    LLM_BATCH: z.enum(['on', 'off']).default('on'),
    LLM_BATCH_POLL_MS: z.coerce.number().default(60_000),
    // Rewritten cases prepared a day ahead per template and language: at most this many, by recent demand
    LLM_POOL_SIZE: z.coerce.number().int().min(0).default(10),
    // Evaluation worker
    EVAL_POLL_MS: z.coerce.number().default(2000),
    // First admin account, created by the seed script
    ADMIN_EMAIL: z.string().optional(),
    ADMIN_PASSWORD: z.string().optional(),
    ADMIN_FULL_NAME: z.string().default('Administrator'),
    ORGANIZATION_NAME: z.string().default('CaseLab')
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
    if (!cached) {
        const parsed = schema.safeParse(process.env);
        if (!parsed.success) {
            const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
            throw new Error(`Invalid environment configuration - ${issues}`);
        }
        cached = parsed.data;
    }
    return cached;
}

export const isLlmConfigured = () => Boolean(env().ANTHROPIC_API_KEY);
