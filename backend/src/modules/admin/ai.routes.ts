import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/http';
import { AiLog } from '../attempts/attempt.model';
import { AiJob, batchEnabled, publicJob } from '../ai/batch';
import { aiAvailable, aiGenerate } from '../ai/ai.service';
import { env } from '../../config/env';

// AI drafts in progress and the cost of the AI per task. Admin only (mounted under the admin router).
const router = Router();

const KINDS = ['generate_document', 'inject_errors', 'generate_template', 'generate_track'];

// Is the AI on and what went wrong lately: the key presence (never the key), models, the last errors from AiLog
router.get('/status', asyncHandler(async (_req, res) => {
    const [lastErrors, lastOk] = await Promise.all([
        AiLog.find({ error: { $ne: null } }).sort({ createdAt: -1 }).limit(10).select('purpose model error createdAt latencyMs').lean(),
        AiLog.findOne({ error: null }).sort({ createdAt: -1 }).select('purpose model createdAt').lean()
    ]);
    res.json({
        configured: aiAvailable(),
        models: { fast: env().LLM_MODEL_FAST, smart: env().LLM_MODEL_SMART, overrides: env().LLM_TASK_MODELS ?? '' },
        batch: batchEnabled(),
        poolSize: env().LLM_POOL_SIZE,
        lastOk: lastOk ? { purpose: lastOk.purpose, model: lastOk.model, at: lastOk.createdAt } : null,
        lastErrors: lastErrors.map(e => ({ purpose: e.purpose, model: e.model ?? '', error: e.error, at: e.createdAt, latencyMs: e.latencyMs ?? null }))
    });
}));

// One tiny live call to the fast model: shows the real API answer (wrong key, region, model name, limits)
router.post('/ping', asyncHandler(async (_req, res) => {
    if (!aiAvailable()) {
        res.json({ ok: false, error: 'ANTHROPIC_API_KEY is not set in the backend environment' });
        return;
    }
    const started = Date.now();
    try {
        const r = await aiGenerate({
            task: 'clientReply', promptVersion: 'ping.v1', purpose: 'ping',
            system: 'Ты проверка связи. Верни JSON {"ok": true}.', user: 'ping', schema: z.object({ ok: z.boolean() })
        });
        res.json({ ok: true, model: r.model, latencyMs: Date.now() - started });
    } catch (e: any) {
        res.json({ ok: false, error: String(e?.message ?? e), status: e?.status ?? null, latencyMs: Date.now() - started });
    }
}));

// Drafts the admin asked for that wait for their batch, or failed, plus recently finished ones with links
router.get('/jobs', asyncHandler(async (req, res) => {
    const asked = typeof req.query.kind === 'string' ? req.query.kind.split(',').filter(k => KINDS.includes(k)) : [];
    const kind = asked.length ? asked : KINDS;
    const since = new Date(Date.now() - 7 * 86_400_000);
    const jobs = await AiJob.find({ kind: { $in: kind }, organizationId: req.user!.organizationId, createdAt: { $gte: since } })
        .select('-request -meta').sort({ createdAt: -1 }).limit(30).lean();
    res.json({ jobs: jobs.map(publicJob) });
}));

// Calls, tokens, cache share and cost per task over N days: where the money goes and whether the cache works
router.get('/usage', asyncHandler(async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    const rows = await AiLog.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - days * 86_400_000) } } },
        {
            $group: {
                _id: '$purpose',
                calls: { $sum: 1 },
                errors: { $sum: { $cond: [{ $ifNull: ['$error', false] }, 1, 0] } },
                batch: { $sum: { $cond: ['$batch', 1, 0] } },
                tokensIn: { $sum: { $ifNull: ['$tokensIn', 0] } },
                tokensOut: { $sum: { $ifNull: ['$tokensOut', 0] } },
                cacheRead: { $sum: { $ifNull: ['$cacheRead', 0] } },
                costUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
                latencyMs: { $avg: { $cond: ['$batch', null, '$latencyMs'] } }
            }
        },
        { $sort: { costUsd: -1 } }
    ]);
    const items = rows.map(r => ({
        purpose: r._id, calls: r.calls, errors: r.errors, batch: r.batch, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
        cacheShare: r.tokensIn ? Math.round((100 * r.cacheRead) / r.tokensIn) : 0,
        costUsd: Math.round(r.costUsd * 10000) / 10000, avgLatencyMs: r.latencyMs ? Math.round(r.latencyMs) : null
    }));
    res.json({ days, items, totalUsd: Math.round(items.reduce((s, i) => s + i.costUsd, 0) * 10000) / 10000 });
}));

export default router;
