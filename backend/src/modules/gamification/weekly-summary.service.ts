import { z } from 'zod';
import { SkillRating, WeeklySummary } from './gamification.model';
import { Attempt } from '../attempts/attempt.model';
import { Skill } from '../content/content.model';
import { TaskInstance } from '../tasks/task.model';
import { hiddenExamInstanceIds } from '../tasks/task.service';
import { aiAvailable } from '../ai/ai.service';
import { AiJob, registerJobHandler, runOrQueue } from '../ai/batch';
import { languageName, loadPrompt, render } from '../ai/prompts';
import { addDays, tashkentToday, weekday } from '../legal/engines/dates';
import { pick, type Locale } from '../../utils/localized';
import type { UserDoc } from '../users/user.model';

const outZod = z.object({
    summary: z.string().min(20),
    strengths: z.array(z.string()).max(3),
    focus: z.array(z.string()).max(3)
});

const DONE = ['auto', 'needs_review', 'moderated'];

// Monday of the Tashkent week
export const weekStartOf = (day: string) => addDays(day, -((weekday(day) + 6) % 7));

// Aggregates of the last 7 days; null when the student did not train (no LLM call then)
export async function weeklyStats(user: UserDoc, today = tashkentToday()) {
    const periodFrom = addDays(today, -6);
    // Tashkent midnight of the first day, UTC+5
    const since = new Date(Date.parse(`${periodFrom}T00:00:00Z`) - 5 * 3600 * 1000);
    const attempts = await Attempt.find({ userId: user._id, status: { $in: DONE }, createdAt: { $gte: since } }).select('instanceId finalScore ai.errors').lean();
    // Exam results the teacher has not published stay out of the summary
    const hidden = await hiddenExamInstanceIds(String(user._id), attempts.map(a => a.instanceId));
    const visible = attempts.filter(a => !hidden.has(String(a.instanceId)));
    if (!visible.length) return null;

    const locale = (user.locale as Locale) || 'ru';
    const instances = await TaskInstance.find({ _id: { $in: visible.map(a => a.instanceId) } }).select('taskType').lean();
    const typeOf = new Map(instances.map(i => [String(i._id), i.taskType]));
    const [skills, ratings] = await Promise.all([Skill.find().select('key name').lean(), SkillRating.find({ userId: user._id }).lean()]);
    const skillName = new Map(skills.map(s => [s.key, pick(s.name as any, locale)]));

    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
    const byType = new Map<string, number[]>();
    for (const a of visible) {
        const t = typeOf.get(String(a.instanceId)) ?? 'other';
        byType.set(t, [...(byType.get(t) ?? []), a.finalScore ?? 0]);
    }
    const errors = new Map<string, { errorType: string; skill: string; count: number }>();
    for (const a of visible) {
        for (const e of a.ai?.errors ?? []) {
            const k = `${e.errorType}|${e.skillKey ?? ''}`;
            const cur = errors.get(k) ?? { errorType: e.errorType ?? '', skill: skillName.get(e.skillKey ?? '') ?? e.skillKey ?? '', count: 0 };
            cur.count++;
            errors.set(k, cur);
        }
    }
    return {
        periodFrom,
        periodTo: today,
        attempts: visible.length,
        avgScore: avg(visible.map(a => a.finalScore ?? 0)),
        byTaskType: [...byType.entries()].map(([taskType, scores]) => ({ taskType, attempts: scores.length, avgScore: avg(scores) })),
        topErrors: [...errors.values()].sort((a, b) => b.count - a.count).slice(0, 8),
        skills: ratings.filter(r => r.attemptsCount > 0).sort((a, b) => a.rating - b.rating).slice(0, 10)
            .map(r => ({ skill: skillName.get(r.skillKey) ?? r.skillKey, rating: Math.round(r.rating), avgScore: Math.round(r.avgScore ?? 0), attempts: r.attemptsCount }))
    };
}

interface SummaryMeta {
    key: string;
    userId: string;
    weekStart: string;
    locale: Locale;
    stats: NonNullable<Awaited<ReturnType<typeof weeklyStats>>>;
}

async function saveSummary(meta: SummaryMeta, out: z.infer<typeof outZod>, promptVersion: string, model: string) {
    try {
        const created = await WeeklySummary.create({
            userId: meta.userId, weekStart: meta.weekStart, periodFrom: meta.stats.periodFrom, periodTo: meta.stats.periodTo, locale: meta.locale,
            summary: out.summary, strengths: out.strengths, focus: out.focus, stats: meta.stats, model, promptVersion
        });
        return created.toObject();
    } catch (e: any) {
        // Two parallel first visits of the week: the other request saved its summary
        if (e?.code === 11000) return WeeklySummary.findOne({ userId: meta.userId, weekStart: meta.weekStart }).lean();
        throw e;
    }
}

const PROMPT = () => loadPrompt('weekly-summary', 2);
registerJobHandler('weekly_summary', { schema: outZod, onResult: async (meta: SummaryMeta, out, job) => saveSummary(meta, out, PROMPT().version, job.model) });

// The summary of the current week: the stored one, or a new one when the student trained and the LLM is configured
// Written only for students who open it, through a batch: the first visit says "being prepared"
export async function weeklySummaryFor(user: UserDoc) {
    const today = tashkentToday();
    const weekStart = weekStartOf(today);
    const existing = await WeeklySummary.findOne({ userId: user._id, weekStart }).lean();
    if (existing) return { summary: existing, reason: null };
    const key = `${user._id}:${weekStart}`;
    if (await AiJob.exists({ kind: 'weekly_summary', 'meta.key': key, status: { $in: ['queued', 'submitting', 'submitted'] } })) return { summary: null, reason: 'queued' as const };
    const stats = await weeklyStats(user, today);
    if (!stats) return { summary: null, reason: 'no_activity' as const };
    if (!aiAvailable()) return { summary: null, reason: 'llm_not_configured' as const };

    const locale = (user.locale as Locale) || 'ru';
    const prompt = PROMPT();
    const meta: SummaryMeta = { key, userId: String(user._id), weekStart, locale, stats };
    try {
        const r = await runOrQueue('weekly_summary', { task: 'weeklySummary', ...render(prompt, { stats: JSON.stringify(stats), language: languageName(locale) }) }, { promptVersion: prompt.version, meta });
        if (r.queued) return { summary: null, reason: 'queued' as const };
        return { summary: r.result as any, reason: null };
    } catch {
        return { summary: null, reason: 'llm_failed' as const };
    }
}
