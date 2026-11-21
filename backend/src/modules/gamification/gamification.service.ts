import { Types } from 'mongoose';
import { User } from '../users/user.model';
import { DailySet, SkillRating, UserAchievement, XpEvent } from './gamification.model';
import { Attempt } from '../attempts/attempt.model';
import { TaskInstance } from '../tasks/task.model';
import { addDays, diffDays, tashkentToday } from '../legal/engines/dates';

// ---------- Levels and titles (PRD 7.2) ----------

// Level n needs 100 * n^1.5 XP in total; everyone starts at level 1
export const xpForLevel = (n: number) => Math.round(100 * Math.pow(n, 1.5));

export function levelForXp(xp: number) {
    let level = 1;
    while (xp >= xpForLevel(level + 1)) level++;
    return level;
}

const TITLES: { from: number; ru: string; uz: string }[] = [
    { from: 30, ru: 'Партнер', uz: 'Hamkor' },
    { from: 20, ru: 'Ведущий юрист', uz: 'Yetakchi yurist' },
    { from: 15, ru: 'Старший юрист', uz: 'Katta yurist' },
    { from: 10, ru: 'Юрист', uz: 'Yurist' },
    { from: 5, ru: 'Помощник юриста', uz: 'Yurist yordamchisi' },
    { from: 1, ru: 'Стажер', uz: 'Stajyor' }
];
export const titleForLevel = (level: number) => {
    const t = TITLES.find(x => level >= x.from) ?? TITLES[TITLES.length - 1];
    return { ru: t.ru, uz: t.uz };
};

// ---------- XP (PRD 7.1) ----------

const BASE_XP: Record<number, number> = { 1: 20, 2: 35, 3: 50, 4: 70, 5: 100 };
const DAILY_XP_CAP = 500;

export interface XpInput {
    difficulty: number;
    score: number;
    streak: number;
    taskType: string;
    isFirstIteration: boolean;
}

export function computeXp(i: XpInput) {
    if (i.score < 30) return 0;
    const multiplier = i.taskType === 'draft_full' || i.taskType.startsWith('sim') ? 1.5 : 1;
    let xp = (BASE_XP[i.difficulty] ?? 20) * (i.score / 100) * (1 + 0.05 * Math.min(i.streak, 10)) * multiplier;
    if (i.isFirstIteration && i.score >= 86) xp += 10;
    // Rework of the same instance gives 50% (protection from farming)
    if (!i.isFirstIteration) xp *= 0.5;
    return Math.round(xp);
}

// ---------- Streak (PRD 7.3) ----------

export function nextStreak(
    streak: { current: number; best: number; lastActiveDate: string | null; freezes: number },
    today: string
) {
    const s = { ...streak };
    if (s.lastActiveDate === today) return s;
    if (!s.lastActiveDate) {
        s.current = 1;
    } else {
        const gap = diffDays(s.lastActiveDate, today) - 1;
        if (gap <= 0) s.current += 1;
        else if (gap <= s.freezes) {
            // Missed days are covered by freezes automatically
            s.freezes -= gap;
            s.current += 1;
        } else s.current = 1;
    }
    s.lastActiveDate = today;
    s.best = Math.max(s.best, s.current);
    // One freeze for every 7 days in a row, at most 2 in stock
    if (s.current > 0 && s.current % 7 === 0) s.freezes = Math.min(2, s.freezes + 1);
    return s;
}

// Streak shown on the dashboard: drops to 0 once a day is missed beyond the freezes
export function visibleStreak(streak: { current: number; lastActiveDate: string | null; freezes: number }, today = tashkentToday()) {
    if (!streak.lastActiveDate) return 0;
    const gap = diffDays(streak.lastActiveDate, today) - 1;
    return gap <= streak.freezes ? streak.current : 0;
}

// ---------- Skill ratings (PRD 6.2) ----------

export const START_RATING: Record<string, number> = { beginner: 900, intermediate: 1150, advanced: 1400 };
export const taskRating = (difficulty: number) => 800 + 200 * (Math.min(5, Math.max(1, difficulty)) - 1);

export function eloUpdate(rating: number, difficulty: number, score: number, weight: number, attemptsCount: number) {
    const expected = 1 / (1 + Math.pow(10, (taskRating(difficulty) - rating) / 400));
    const k = attemptsCount < 10 ? 40 : 20;
    return Math.round(rating + k * weight * (score / 100 - expected));
}

// Difficulty whose rating is closest to R + 50 (PRD 6.3)
export function difficultyForRating(rating: number) {
    let best = 1;
    for (let d = 1; d <= 5; d++) {
        if (Math.abs(taskRating(d) - (rating + 50)) < Math.abs(taskRating(best) - (rating + 50))) best = d;
    }
    return best;
}

// ---------- Applying a finished attempt ----------

export interface ApplyResultInput {
    userId: Types.ObjectId | string;
    attemptId: Types.ObjectId;
    score: number;
    difficulty: number;
    taskType: string;
    iteration: number;
    skills: { key: string; weight: number }[];
    errors: { errorType?: string | null; skillKey?: string | null }[];
    // Exam attempts give no XP and do not count for the streak (PRD 7.5); skill ratings still update (PRD 6)
    isExam?: boolean;
    instanceId?: Types.ObjectId;
    mode?: string;
}

export const DAILY_BONUS_XP = 15;

// Achievement codes (PRD 7.4); case_closed comes with the case track (4.10)
export const ACHIEVEMENTS = [
    'first_case', 'sapper', 'deadline_keeper', 'fee_master', 'red_pen', 'week_streak', 'month_streak',
    'first_win', 'all_rounder', 'navigator', 'proofreader', 'case_closed'
] as const;

const ALL_MODES = ['draft', 'review', 'process', 'route', 'sim'];
const DONE = ['auto', 'needs_review', 'moderated'];

// Conditions counted over the student's finished attempts; exams count as well, they are real work
export async function earnedByWork(userId: Types.ObjectId | string) {
    const codes: string[] = [];
    const base = { userId, status: { $in: DONE } };
    const [deadlineChecks, feeOk, sapper, win, navigator, proofreader] = await Promise.all([
        Attempt.find({ ...base, 'deterministic.details.checks.key': 'deadline' }).sort({ createdAt: -1 }).limit(10).select('deterministic.details.checks').lean(),
        Attempt.countDocuments({ ...base, 'deterministic.details.checks': { $elemMatch: { key: 'fee', ok: true } } }),
        Attempt.exists({ ...base, 'deterministic.details.kind': 'mines', 'deterministic.details.clean': true }),
        Attempt.exists({ ...base, 'deterministic.details.kind': 'sim', 'deterministic.details.outcome': 'win' }),
        Attempt.countDocuments({ ...base, 'deterministic.details.kind': 'route', 'deterministic.details.optimal': true }),
        Attempt.countDocuments({
            ...base, 'deterministic.details.kind': 'court_act', 'deterministic.details.targets': { $gt: 0 },
            'deterministic.details.missed': { $size: 0 }, 'deterministic.details.valueChecks.ok': { $ne: false }
        })
    ]);
    // 10 correct deadline calculations in a row - the last ten attempts with a deadline field
    if (deadlineChecks.length === 10 && deadlineChecks.every(a => (a.deterministic?.details as any)?.checks?.find((c: any) => c.key === 'deadline')?.ok)) codes.push('deadline_keeper');
    if (feeOk >= 10) codes.push('fee_master');
    if (sapper) codes.push('sapper');
    if (win) codes.push('first_win');
    if (navigator >= 10) codes.push('navigator');
    if (proofreader >= 5) codes.push('proofreader');

    const contracts = await TaskInstance.find({ userId, taskType: 'review_contract' }).distinct('_id');
    if (contracts.length && await Attempt.countDocuments({ ...base, instanceId: { $in: contracts }, finalScore: { $gte: 86 } }) >= 5) codes.push('red_pen');
    const modes = await TaskInstance.distinct('mode', { userId, bestScore: { $gte: 71 } });
    if (ALL_MODES.every(m => modes.includes(m))) codes.push('all_rounder');
    return codes;
}

export async function applyAttemptResult(i: ApplyResultInput) {
    const user = await User.findById(i.userId);
    if (!user) return { xp: 0, achievements: [] as string[], dailyBonus: 0 };
    const today = tashkentToday();

    // Streak: a day counts when at least one task is finished with 50+
    if (i.score >= 50 && !i.isExam) {
        const s = nextStreak({
            current: user.streak?.current ?? 0,
            best: user.streak?.best ?? 0,
            lastActiveDate: user.streak?.lastActiveDate ?? null,
            freezes: user.streak?.freezes ?? 0
        }, today);
        user.set('streak', s);
    }

    // XP with the daily cap
    let xp = i.isExam ? 0 : computeXp({
        difficulty: i.difficulty,
        score: i.score,
        streak: user.streak?.current ?? 0,
        taskType: i.taskType,
        isFirstIteration: i.iteration === 1
    });
    if (xp > 0) {
        const dayStartUtc = new Date(`${today}T00:00:00+05:00`);
        const earned = await XpEvent.aggregate([
            { $match: { userId: user._id, createdAt: { $gte: dayStartUtc, $lt: new Date(`${addDays(today, 1)}T00:00:00+05:00`) } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const left = Math.max(0, DAILY_XP_CAP - (earned[0]?.total ?? 0));
        xp = Math.min(xp, left);
    }
    if (xp > 0) {
        await XpEvent.create({ userId: user._id, amount: xp, reason: 'attempt', attemptId: i.attemptId });
        user.xp += xp;
        user.level = levelForXp(user.xp);
    }
    await user.save();

    // Skill ratings
    const start = START_RATING[user.startLevel ?? 'beginner'] ?? 900;
    for (const s of i.skills) {
        const existing = await SkillRating.findOne({ userId: user._id, skillKey: s.key });
        const r = existing ?? new SkillRating({ userId: user._id, skillKey: s.key, rating: start });
        r.rating = eloUpdate(r.rating, i.difficulty, i.score, s.weight, r.attemptsCount);
        r.avgScore = Math.round(((r.avgScore * r.attemptsCount) + i.score) / (r.attemptsCount + 1));
        r.attemptsCount += 1;
        r.lastAt = new Date();
        const types = i.errors.filter(e => e.errorType && (!e.skillKey || e.skillKey === s.key)).map(e => String(e.errorType));
        const stats: Record<string, number> = { ...(r.errorStats || {}) };
        for (const t of types) stats[t] = (stats[t] || 0) + 1;
        r.errorStats = stats;
        r.recentErrors = [...types, ...(r.recentErrors || [])].slice(0, 30);
        r.markModified('errorStats');
        await r.save();
    }

    // Achievements available with the current trainers
    const achievements: string[] = [];
    const award = async (code: string) => {
        const res = await UserAchievement.updateOne({ userId: user._id, code }, { $setOnInsert: { earnedAt: new Date() } }, { upsert: true });
        if (res.upsertedCount) achievements.push(code);
    };
    await award('first_case');
    if ((user.streak?.current ?? 0) >= 7) await award('week_streak');
    if ((user.streak?.current ?? 0) >= 30) await award('month_streak');
    for (const code of await earnedByWork(user._id)) await award(code);

    let dailyBonus = 0;
    // Task of the day finished with 50+: a one-time bonus outside the daily cap (PRD 7.5)
    if (i.instanceId && !i.isExam && i.score >= 50) {
        const set = await DailySet.findOneAndUpdate(
            { userId: user._id, date: today, tasks: { $elemMatch: { instanceId: i.instanceId, done: false } } },
            { $set: { 'tasks.$.done': true, 'tasks.$.xpAwarded': DAILY_BONUS_XP } }
        );
        if (set) {
            await XpEvent.create({ userId: user._id, amount: DAILY_BONUS_XP, reason: 'daily', attemptId: i.attemptId });
            user.xp += DAILY_BONUS_XP;
            user.level = levelForXp(user.xp);
            await user.save();
            dailyBonus = DAILY_BONUS_XP;
        }
    }

    // The bonus is kept apart from the attempt XP so that moderation rescales only the attempt part
    return { xp, achievements, dailyBonus };
}

// A skill is problematic after 3+ attempts with average below 56, or one errorType 3 times among the last 10 recorded errors (PRD 6.4 counts per 10 attempts)
export function isProblematic(r: { attemptsCount: number; avgScore: number; recentErrors?: string[] }) {
    if (r.attemptsCount >= 3 && r.avgScore < 56) return true;
    const counts: Record<string, number> = {};
    for (const t of (r.recentErrors || []).slice(0, 10)) counts[t] = (counts[t] || 0) + 1;
    return Object.values(counts).some(c => c >= 3);
}

// After a teacher changes a score (PRD 5.3, 6.2): XP and skill ratings follow the corrected score.
// XP scales the original award by new/old score (the streak bonus at grading time stays as it was);
// ratings shift by the difference the Elo step would have made with K = 20.
export async function adjustAfterModeration(i: {
    userId: Types.ObjectId | string;
    attemptId: Types.ObjectId;
    oldScore: number;
    newScore: number;
    oldXp: number;
    difficulty: number;
    taskType: string;
    iteration: number;
    isExam: boolean;
    skills: { key: string; weight: number }[];
}) {
    const user = await User.findById(i.userId);
    if (!user) return { xp: i.oldXp };
    let newXp = 0;
    if (!i.isExam && i.newScore >= 30) {
        newXp = i.oldXp > 0 && i.oldScore > 0
            ? Math.round(i.oldXp * i.newScore / i.oldScore)
            : computeXp({ difficulty: i.difficulty, score: i.newScore, streak: user.streak?.current ?? 0, taskType: i.taskType, isFirstIteration: i.iteration === 1 });
    }
    const delta = newXp - i.oldXp;
    if (delta !== 0) {
        await XpEvent.create({ userId: user._id, amount: delta, reason: 'moderation', attemptId: i.attemptId });
        user.xp = Math.max(0, user.xp + delta);
        user.level = levelForXp(user.xp);
        await user.save();
    }
    for (const s of i.skills) {
        const r = await SkillRating.findOne({ userId: user._id, skillKey: s.key });
        if (!r || !r.attemptsCount) continue;
        r.rating = Math.round(r.rating + 20 * s.weight * (i.newScore - i.oldScore) / 100);
        r.avgScore = Math.round(r.avgScore + (i.newScore - i.oldScore) / r.attemptsCount);
        await r.save();
    }
    return { xp: newXp };
}
