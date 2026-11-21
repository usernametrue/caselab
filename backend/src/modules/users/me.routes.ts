import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFound } from '../../utils/http';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { Assignment, Group, START_LEVELS, User, toPublicUser } from './user.model';
import { HttpError } from '../../utils/http';
import { TaskTemplate } from '../content/content.model';
import { generateInstance, hiddenExamInstanceIds } from '../tasks/task.service';
import { dailySetFor } from '../gamification/daily.service';
import { weeklySummaryFor } from '../gamification/weekly-summary.service';
import { ACHIEVEMENTS, DAILY_BONUS_XP } from '../gamification/gamification.service';
import { toPublicInstance } from '../tasks/task.model';
import { Track, TrackRun } from '../tracks/track.model';
import { Skill } from '../content/content.model';
import { SkillRating, UserAchievement } from '../gamification/gamification.model';
import { Attempt } from '../attempts/attempt.model';
import { TaskInstance } from '../tasks/task.model';
import { isProblematic, levelForXp, titleForLevel, visibleStreak, xpForLevel } from '../gamification/gamification.service';
import { pick, type Locale } from '../../utils/localized';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    res.json({ user: toPublicUser(user) });
}));

const patchSchema = z.object({
    fullName: z.string().trim().min(3).max(120).optional(),
    locale: z.enum(['ru', 'uz']).optional(),
    course: z.coerce.number().int().min(1).max(6).optional(),
    hideFromLeaderboard: z.boolean().optional(),
    // AUTH-4 onboarding; can be set once, afterwards ratings change automatically
    startLevel: z.enum(START_LEVELS).optional()
});

router.patch('/', validateBody(patchSchema), asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    const { startLevel, ...rest } = req.body as z.infer<typeof patchSchema>;
    user.set(rest);
    if (startLevel && !user.startLevel) user.startLevel = startLevel;
    await user.save();
    res.json({ user: toPublicUser(user) });
}));

// STD-1: level, XP, streak, recent work
router.get('/dashboard', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    const level = levelForXp(user.xp);
    const current = xpForLevel(level);
    const next = xpForLevel(level + 1);

    const recent = await Attempt.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5).lean();
    const instances = await TaskInstance.find({ _id: { $in: recent.map(a => a.instanceId) } }).select('content.title mode').lean();
    const titles = new Map(instances.map(i => [String(i._id), i.content?.title ?? '']));
    const hidden = await hiddenExamInstanceIds(String(user._id), recent.map(a => a.instanceId));
    const solved = await Attempt.countDocuments({ userId: user._id, status: { $in: ['auto', 'needs_review', 'moderated'] } });
    const achievements = await UserAchievement.countDocuments({ userId: user._id });

    res.json({
        xp: user.xp,
        level,
        title: titleForLevel(level),
        levelProgress: { from: level === 1 ? 0 : current, to: next },
        streak: { current: visibleStreak({ current: user.streak?.current ?? 0, lastActiveDate: user.streak?.lastActiveDate ?? null, freezes: user.streak?.freezes ?? 0 }), best: user.streak?.best ?? 0, freezes: user.streak?.freezes ?? 0 },
        solved,
        achievements,
        recent: recent.map(a => ({
            id: String(a._id),
            instanceId: String(a.instanceId),
            title: titles.get(String(a.instanceId)) ?? '',
            status: hidden.has(String(a.instanceId)) && a.status !== 'evaluating' ? 'awaiting_publication' : a.status,
            finalScore: hidden.has(String(a.instanceId)) ? null : a.finalScore,
            iteration: a.iteration,
            createdAt: (a as any).createdAt
        }))
    });
}));

// STD-4: skill map with problem spots
router.get('/skills', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id).lean();
    if (!user) throw notFound('User');
    const locale = (user.locale as Locale) || 'ru';
    const [skills, ratings] = await Promise.all([
        Skill.find().sort({ key: 1 }).lean(),
        SkillRating.find({ userId: user._id }).lean()
    ]);
    const byKey = new Map(ratings.map(r => [r.skillKey, r]));
    res.json({
        skills: skills.map(s => {
            const r = byKey.get(s.key);
            return {
                key: s.key,
                parentKey: s.parentKey,
                name: pick(s.name as any, locale),
                rating: r?.rating ?? null,
                attemptsCount: r?.attemptsCount ?? 0,
                avgScore: r?.avgScore ?? null,
                lastAt: r?.lastAt ?? null,
                problematic: r ? isProblematic(r as any) : false
            };
        })
    });
}));

// PRD 10.2 weeklySummary: the AI report on the last 7 days, one per Tashkent week
router.get('/weekly-summary', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    const { summary, reason } = await weeklySummaryFor(user);
    res.json({
        summary: summary ? {
            weekStart: summary.weekStart, periodFrom: summary.periodFrom, periodTo: summary.periodTo,
            summary: summary.summary, strengths: summary.strengths, focus: summary.focus, stats: summary.stats
        } : null,
        reason
    });
}));

// PRD 7.5: three tasks of the day with a bonus for each
router.get('/daily', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    const locale = (user.locale as Locale) || 'ru';
    const set = await dailySetFor(user);
    if (!set) {
        res.json({ date: null, bonusXp: DAILY_BONUS_XP, tasks: [] });
        return;
    }
    const templates = await TaskTemplate.find({ _id: { $in: set.tasks.map(t => t.templateId) } }).select('title mode taskType difficulty').lean();
    const skills = await Skill.find({ key: { $in: set.tasks.map(t => t.skillKey).filter(Boolean) } }).lean();
    res.json({
        date: set.date,
        bonusXp: DAILY_BONUS_XP,
        tasks: set.tasks.map((t, index) => {
            const tpl = templates.find(x => String(x._id) === String(t.templateId));
            return {
                index,
                kind: t.kind,
                skillKey: t.skillKey,
                skillName: t.skillKey ? pick(skills.find(s => s.key === t.skillKey)?.name as any, locale) : '',
                mode: tpl?.mode ?? t.mode,
                taskType: tpl?.taskType ?? '',
                difficulty: tpl?.difficulty ?? null,
                title: tpl ? pick(tpl.title as any, locale) : '',
                instanceId: t.instanceId ? String(t.instanceId) : null,
                done: t.done
            };
        })
    });
}));

// Opens the task of the day: the same instance for the whole day
router.post('/daily/:index/start', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    const set = await dailySetFor(user);
    const task = set?.tasks[Number(req.params.index)];
    if (!set || !task) throw notFound('Task of the day');
    if (task.instanceId) {
        const existing = await TaskInstance.findById(task.instanceId);
        if (existing) {
            res.json({ instance: toPublicInstance(existing) });
            return;
        }
    }
    const instance = await generateInstance(String(task.templateId), user);
    task.instanceId = instance._id;
    await set.save();
    res.status(201).json({ instance: toPublicInstance(instance) });
}));

// STD-6: all achievements with the earned ones marked
router.get('/achievements', asyncHandler(async (req, res) => {
    const earned = await UserAchievement.find({ userId: req.user!.id }).lean();
    res.json({
        achievements: ACHIEVEMENTS.map(code => ({ code, earnedAt: earned.find(e => e.code === code)?.earnedAt ?? null }))
    });
}));

// Joining a group by the teacher's invite code
router.post('/groups/join', validateBody(z.object({ inviteCode: z.string().trim().min(4).max(20) })), asyncHandler(async (req, res) => {
    const group = await Group.findOne({ inviteCode: req.body.inviteCode.toUpperCase() });
    if (!group) throw new HttpError(400, 'bad_invite_code', 'Invite code not found');
    await Group.updateOne({ _id: group._id }, { $addToSet: { studentIds: req.user!.id } });
    res.json({ group: { id: String(group._id), name: group.name } });
}));

// STD-1: assignments of the student's groups with the state of each task
router.get('/assignments', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id).lean();
    const locale = (user?.locale as Locale) || 'ru';
    const groups = await Group.find({ studentIds: req.user!.id }).select('name').lean();
    const assignments = await Assignment.find({ groupId: { $in: groups.map(g => g._id) } }).sort({ dueAt: 1 }).lean();
    const templateIds = [...new Set(assignments.flatMap(a => a.templateIds.map(String)))];
    const trackIds = [...new Set(assignments.flatMap(a => (a.trackIds ?? []).map(String)))];
    const [tracks, runs] = await Promise.all([
        Track.find({ _id: { $in: trackIds } }).select('title stages').lean(),
        TrackRun.find({ userId: req.user!.id, assignmentId: { $in: assignments.map(a => a._id) } }).select('assignmentId trackId status finalScore').sort({ createdAt: -1 }).lean()
    ]);
    const [templates, instances] = await Promise.all([
        TaskTemplate.find({ _id: { $in: templateIds } }).select('title taskType difficulty').lean(),
        TaskInstance.find({ userId: req.user!.id, assignmentId: { $in: assignments.map(a => a._id) } }).select('assignmentId templateId bestScore createdAt').sort({ createdAt: -1 }).lean()
    ]);
    const groupNames = new Map(groups.map(g => [String(g._id), g.name]));
    res.json({
        groups: groups.map(g => ({ id: String(g._id), name: g.name })),
        assignments: assignments.map(a => ({
            id: String(a._id), title: a.title, kind: a.kind, dueAt: a.dueAt, resultsPublished: a.resultsPublished,
            groupName: groupNames.get(String(a.groupId)) ?? '',
            overdue: a.dueAt.getTime() < Date.now(),
            tasks: a.templateIds.map(tid => {
                const t = templates.find(x => String(x._id) === String(tid));
                const inst = instances.find(i => String(i.assignmentId) === String(a._id) && String(i.templateId) === String(tid));
                return {
                    templateId: String(tid), title: t ? pick(t.title as any, locale) : '', taskType: t?.taskType, difficulty: t?.difficulty,
                    instanceId: inst ? String(inst._id) : null,
                    bestScore: a.kind === 'exam' && !a.resultsPublished ? null : inst?.bestScore ?? null
                };
            }),
            tracks: (a.trackIds ?? []).map(tid => {
                const t = tracks.find(x => String(x._id) === String(tid));
                const run = runs.find(r => String(r.assignmentId) === String(a._id) && String(r.trackId) === String(tid));
                return {
                    trackId: String(tid), title: t ? pick(t.title as any, locale) : '', stagesCount: t?.stages?.length ?? 0,
                    runId: run ? String(run._id) : null, status: run?.status ?? null,
                    finalScore: a.kind === 'exam' && !a.resultsPublished ? null : run?.finalScore ?? null
                };
            })
        }))
    });
}));

export default router;
