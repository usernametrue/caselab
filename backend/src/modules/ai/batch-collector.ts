import { getLlm, setLlmForTests } from './claude.provider';
import type { GenerateJsonRequest, GenerateJsonResult, LlmProvider } from './llm-provider';

// For scripts that wait for their answers (the grading eval): the LLM calls made inside run() are not sent
// one by one but collected and sent as one Message Batch at half the price; each caller awaits its own result.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Pending { req: GenerateJsonRequest<any>; resolve: (r: GenerateJsonResult<any>) => void; reject: (e: unknown) => void }

export async function collectIntoBatch<R>(run: () => Promise<R>, opts: { idleMs?: number; pollMs?: number; onStatus?: (s: string) => void } = {}): Promise<R> {
    const real = getLlm();
    if (!real?.batch) return run();
    const batchApi = real.batch;
    const idleMs = opts.idleMs ?? 2000;
    const pollMs = opts.pollMs ?? 30_000;
    let pending: Pending[] = [];
    let timer: NodeJS.Timeout | null = null;
    const flights: Promise<void>[] = [];

    const flush = async () => {
        const items = pending;
        pending = [];
        if (!items.length) return;
        try {
            const batchId = await batchApi.submit(items.map((p, i) => ({ customId: `c${i}`, req: p.req })));
            opts.onStatus?.(`batch ${batchId}: ${items.length} requests sent`);
            while (!(await batchApi.ended(batchId))) await sleep(pollMs);
            const seen = new Set<number>();
            for await (const out of batchApi.results(batchId)) {
                const i = Number(out.customId.slice(1));
                const p = items[i];
                if (!p) continue;
                seen.add(i);
                if (!out.ok) {
                    p.reject(new Error(out.error));
                    continue;
                }
                try {
                    p.resolve(batchApi.parse(out.message, p.req));
                } catch (e: any) {
                    // An answer that misses the schema gets a direct call with the full validation loop
                    if (e?.name === 'SchemaMismatch') real.generateJson(p.req).then(p.resolve, p.reject);
                    else p.reject(e);
                }
            }
            items.forEach((p, i) => { if (!seen.has(i)) p.reject(new Error('No result in the batch')); });
        } catch (e) {
            items.forEach(p => p.reject(e));
        }
    };

    const collector: LlmProvider = {
        generateJson: req => new Promise((resolve, reject) => {
            pending.push({ req, resolve, reject });
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { flights.push(flush()); }, idleMs);
        })
    };

    const previous = setLlmForTests(collector);
    try {
        return await run();
    } finally {
        if (timer) clearTimeout(timer);
        await Promise.allSettled(flights);
        setLlmForTests(previous);
    }
}
