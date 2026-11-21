import { Router } from 'express';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { Assignment, Group, User } from '../users/user.model';
import { Skill, TaskTemplate } from '../content/content.model';
import { SkillRating } from '../gamification/gamification.model';
import { Track, TrackRun } from '../tracks/track.model';
import { TaskInstance } from '../tasks/task.model';
import { Attempt, CRITERIA } from '../attempts/attempt.model';
import { weightedScore } from '../attempts/evaluation.service';
import { adjustAfterModeration, isProblematic } from '../gamification/gamification.service';
import { pick, type Locale } from '../../utils/localized';

// Teacher cabinet (PRD 3.3). Admins see everything, teachers only their own groups.
const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));

const isAdmin = (req: any) => req.user.role === 'admin';
const groupFilter = (req: any) => (isAdmin(req) ? {} : { teacherId: req.user.id });

// Students the current teacher may see (members of their groups)
async function visibleStudentIds(req: any) {
    if (isAdmin(req)) return null;
    const groups = await Group.find({ teacherId: req.user.id }).select('studentIds').lean();
    return [...new Set(groups.flatMap(g => g.studentIds.map(String)))];
}

// Readable invite code without look-alike characters
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function newInviteCode() {
    for (;;) {
        const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');
        if (!(await Group.exists({ inviteCode: code }))) return code;
    }
}

// ---------- TCH-1: groups ----------

router.get('/groups', asyncHandler(async (req, res) => {
    const groups = await Group.find(groupFilter(req)).sort({ createdAt: -1 }).lean();
    res.json({ groups: groups.map(g => ({ id: String(g._id), name: g.name, inviteCode: g.inviteCode, studentsCount: g.studentIds.length })) });
}));

router.post('/groups', validateBody(z.object({ name: z.string().trim().min(2).max(120) })), asyncHandler(async (req, res) => {
    const group = await Group.create({ organizationId: req.user!.organizationId, teacherId: req.user!.id, name: req.body.name, inviteCode: await newInviteCode(), studentIds: [] });
    res.status(201).json({ group: { id: String(group._id), name: group.name, inviteCode: group.inviteCode, studentsCount: 0 } });
}));

router.get('/groups/:id', asyncHandler(async (req, res) => {
    const group = await Group.findOne({ _id: req.params.id, ...groupFilter(req) }).lean();
    if (!group) throw notFound('Group');
    const students = await User.find({ _id: { $in: group.studentIds } }).select('fullName email course xp level').lean();
    const stats = await Attempt.aggregate([
        { $match: { userId: { $in: group.studentIds }, finalScore: { $ne: null } } },
        { $group: { _id: '$userId', attempts: { $sum: 1 }, avgScore: { $avg: '$finalScore' }, lastAt: { $max: '$createdAt' } } }
    ]);
    const byUser = new Map(stats.map(s => [String(s._id), s]));
    res.json({
        group: { id: String(group._id), name: group.name, inviteCode: group.inviteCode },
        students: students.map(s => ({
            id: String(s._id), fullName: s.fullName, email: s.email, course: s.course ?? null, xp: s.xp, level: s.level,
            attempts: byUser.get(String(s._id))?.attempts ?? 0,
            avgScore: byUser.get(String(s._id))?.avgScore != null ? Math.round(byUser.get(String(s._id))!.avgScore) : null,
            lastAt: byUser.get(String(s._id))?.lastAt ?? null
        }))
    });
}));

// TCH-4: average score per skill, students x skills heatmap, typical errors, students at risk
router.get('/groups/:id/analytics', asyncHandler(async (req, res) => {
    const group = await Group.findOne({ _id: req.params.id, ...groupFilter(req) }).lean();
    if (!group) throw notFound('Group');
    const me = await User.findById(req.user!.id).select('locale').lean();
    const locale = (me?.locale as Locale) || 'ru';
    const [students, ratings, lastAttempts] = await Promise.all([
        User.find({ _id: { $in: group.studentIds } }).select('fullName').sort({ fullName: 1 }).lean(),
        SkillRating.find({ userId: { $in: group.studentIds } }).lean(),
        Attempt.aggregate([
            { $match: { userId: { $in: group.studentIds }, finalScore: { $ne: null } } },
            { $group: { _id: '$userId', lastAt: { $max: '$createdAt' }, attempts: { $sum: 1 }, avgScore: { $avg: '$finalScore' } } }
        ])
    ]);
    const skillKeys = [...new Set(ratings.map(r => r.skillKey))].sort();
    const skills = await Skill.find({ key: { $in: skillKeys } }).lean();
    const name = (k: string) => pick(skills.find(x => x.key === k)?.name as any, locale) || k;

    const cell = new Map(ratings.map(r => [`${r.userId}|${r.skillKey}`, r]));
    const errorTotals: Record<string, number> = {};
    for (const r of ratings) for (const [t, c] of Object.entries((r.errorStats as Record<string, number>) ?? {})) errorTotals[t] = (errorTotals[t] || 0) + Number(c);

    const week = Date.now() - 7 * 86400000;
    const atRisk = students.flatMap(st => {
        const own = ratings.filter(r => String(r.userId) === String(st._id));
        const activity = lastAttempts.find(a => String(a._id) === String(st._id));
        const reasons: string[] = [];
        const problematic = own.filter(r => isProblematic(r as any)).map(r => r.skillKey);
        if (problematic.length >= 2) reasons.push('problem_skills');
        if (activity && activity.attempts >= 3 && activity.avgScore < 56) reasons.push('low_average');
        if (!activity || new Date(activity.lastAt).getTime() < week) reasons.push('inactive');
        return reasons.length ? [{ id: String(st._id), fullName: st.fullName, reasons, problemSkills: problematic.map(name) }] : [];
    });

    res.json({
        group: { id: String(group._id), name: group.name },
        skills: skillKeys.map(k => {
            const rs = ratings.filter(r => r.skillKey === k);
            return { key: k, name: name(k), avgScore: rs.length ? Math.round(rs.reduce((a, r) => a + r.avgScore, 0) / rs.length) : null, students: rs.length };
        }),
        heatmap: students.map(st => ({
            id: String(st._id),
            fullName: st.fullName,
            cells: skillKeys.map(k => {
                const r = cell.get(`${st._id}|${k}`);
                return r ? { avgScore: r.avgScore, attempts: r.attemptsCount, problematic: isProblematic(r as any) } : null;
            })
        })),
        typicalErrors: Object.entries(errorTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([errorType, count]) => ({ errorType, count })),
        atRisk
    });
}));

router.delete('/groups/:id/students/:studentId', asyncHandler(async (req, res) => {
    const r = await Group.updateOne({ _id: req.params.id, ...groupFilter(req) }, { $pull: { studentIds: req.params.studentId } });
    if (!r.matchedCount) throw notFound('Group');
    res.json({ ok: true });
}));

// ---------- TCH-2: assignments and exams ----------

router.get('/templates', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id).lean();
    const locale = (user?.locale as Locale) || 'ru';
    const templates = await TaskTemplate.find({ status: 'published' }).select('title taskType mode difficulty').sort({ mode: 1, difficulty: 1 }).lean();
    const tracks = await Track.find({ status: 'published' }).select('title stages').lean();
    res.json({
        templates: templates.map(t => ({ id: String(t._id), title: pick(t.title as any, locale), taskType: t.taskType, mode: t.mode, difficulty: t.difficulty })),
        tracks: tracks.map(t => ({ id: String(t._id), title: pick(t.title as any, locale), stagesCount: t.stages?.length ?? 0 }))
    });
}));

const assignmentZod = z.object({
    groupId: z.string().regex(/^[a-f0-9]{24}$/),
    title: z.string().trim().min(3).max(200),
    templateIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(20).default([]),
    trackIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(5).default([]),
    kind: z.enum(['training', 'exam']).default('training'),
    dueAt: z.coerce.date()
}).refine(a => a.templateIds.length + a.trackIds.length > 0, 'Choose at least one task or case');

router.get('/assignments', asyncHandler(async (req, res) => {
    const groups = await Group.find(groupFilter(req)).select('name').lean();
    const assignments = await Assignment.find({ groupId: { $in: groups.map(g => g._id) } }).sort({ dueAt: -1 }).lean();
    const names = new Map(groups.map(g => [String(g._id), g.name]));
    res.json({
        assignments: assignments.map(a => ({
            id: String(a._id), title: a.title, kind: a.kind, dueAt: a.dueAt, resultsPublished: a.resultsPublished,
            groupId: String(a.groupId), groupName: names.get(String(a.groupId)) ?? '', templatesCount: a.templateIds.length, tracksCount: (a.trackIds ?? []).length
        }))
    });
}));

router.post('/assignments', validateBody(assignmentZod), asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof assignmentZod>;
    const group = await Group.findOne({ _id: body.groupId, ...groupFilter(req) });
    if (!group) throw notFound('Group');
    const published = await TaskTemplate.countDocuments({ _id: { $in: body.templateIds }, status: 'published' });
    if (published !== body.templateIds.length) throw new HttpError(400, 'validation_error', 'Only published templates can be assigned');
    if (await Track.countDocuments({ _id: { $in: body.trackIds }, status: 'published' }) !== body.trackIds.length) throw new HttpError(400, 'validation_error', 'Only published cases can be assigned');
    const assignment = await Assignment.create({ ...body, organizationId: req.user!.organizationId, teacherId: req.user!.id });
    res.status(201).json({ assignment: { id: String(assignment._id) } });
}));

// Progress per student and template: best score of the attempts made for this assignment
router.get('/assignments/:id', asyncHandler(async (req, res) => {
    const assignment = await Assignment.findById(req.params.id).lean();
    if (!assignment) throw notFound('Assignment');
    const group = await Group.findOne({ _id: assignment.groupId, ...groupFilter(req) }).lean();
    if (!group) throw notFound('Assignment');
    const user = await User.findById(req.user!.id).lean();
    const locale = (user?.locale as Locale) || 'ru';
    const [templates, students, instances] = await Promise.all([
        TaskTemplate.find({ _id: { $in: assignment.templateIds } }).select('title taskType difficulty').lean(),
        User.find({ _id: { $in: group.studentIds } }).select('fullName email').lean(),
        TaskInstance.find({ assignmentId: assignment._id }).select('userId templateId bestScore').lean()
    ]);
    const attempts = await Attempt.find({ instanceId: { $in: instances.map(i => i._id) } }).select('instanceId status finalScore').lean();
    const [tracks, runs] = await Promise.all([
        Track.find({ _id: { $in: assignment.trackIds ?? [] } }).select('title stages').lean(),
        TrackRun.find({ assignmentId: assignment._id }).select('userId trackId status finalScore outcome visits').sort({ createdAt: -1 }).lean()
    ]);
    const pending = new Set(attempts.filter(a => a.status === 'needs_review' || a.status === 'evaluating').map(a => String(a.instanceId)));
    res.json({
        assignment: { id: String(assignment._id), title: assignment.title, kind: assignment.kind, dueAt: assignment.dueAt, resultsPublished: assignment.resultsPublished, groupName: group.name },
        templates: templates.map(t => ({ id: String(t._id), title: pick(t.title as any, locale), taskType: t.taskType, difficulty: t.difficulty })),
        tracks: tracks.map(t => ({ id: String(t._id), title: pick(t.title as any, locale), stagesCount: t.stages?.length ?? 0 })),
        rows: students.map(s => ({
            student: { id: String(s._id), fullName: s.fullName, email: s.email },
            cells: assignment.templateIds.map(tid => {
                const mine = instances.filter(i => String(i.userId) === String(s._id) && String(i.templateId) === String(tid));
                const best = mine.reduce<number | null>((m, i) => (i.bestScore != null && (m == null || i.bestScore > m) ? i.bestScore : m), null);
                return { templateId: String(tid), started: mine.length > 0, bestScore: best, pending: mine.some(i => pending.has(String(i._id))) };
            }),
            // The latest run of each case: the teacher sees the score before publication
            trackCells: (assignment.trackIds ?? []).map(tid => {
                const run = runs.find(r => String(r.userId) === String(s._id) && String(r.trackId) === String(tid));
                return { trackId: String(tid), runId: run ? String(run._id) : null, status: run?.status ?? null, finalScore: run?.finalScore ?? null, outcome: run?.outcome ?? null, stagesDone: run ? run.visits.filter(v => v.attemptId).length : 0 };
            })
        }))
    });
}));

// Exam results become visible to students after this call (PRD 5.3)
router.post('/assignments/:id/publish-results', asyncHandler(async (req, res) => {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) throw notFound('Assignment');
    if (!(await Group.exists({ _id: assignment.groupId, ...groupFilter(req) }))) throw notFound('Assignment');
    assignment.resultsPublished = true;
    await assignment.save();
    res.json({ ok: true });
}));

// ---------- TCH-3: moderation ----------

router.get('/moderation/queue', asyncHandler(async (req, res) => {
    const ids = await visibleStudentIds(req);
    const filter: Record<string, unknown> = { status: 'needs_review' };
    if (ids) filter.userId = { $in: ids };
    const attempts = await Attempt.find(filter).sort({ createdAt: 1 }).limit(200).lean();
    const [users, instances] = await Promise.all([
        User.find({ _id: { $in: attempts.map(a => a.userId) } }).select('fullName email').lean(),
        TaskInstance.find({ _id: { $in: attempts.map(a => a.instanceId) } }).select('content.title taskType difficulty isExam').lean()
    ]);
    const u = new Map(users.map(x => [String(x._id), x]));
    const t = new Map(instances.map(x => [String(x._id), x]));
    res.json({
        queue: attempts.map(a => ({
            id: String(a._id),
            student: u.get(String(a.userId))?.fullName ?? '',
            title: t.get(String(a.instanceId))?.content?.title ?? '',
            taskType: t.get(String(a.instanceId))?.taskType,
            isExam: t.get(String(a.instanceId))?.isExam ?? false,
            finalScore: a.finalScore,
            reviewReasons: a.reviewReasons,
            dispute: a.dispute?.at ? a.dispute.comment : null,
            createdAt: (a as any).createdAt
        }))
    });
}));

async function loadForModeration(req: any) {
    const attempt = await Attempt.findById(req.params.attemptId);
    if (!attempt) throw notFound('Attempt');
    const ids = await visibleStudentIds(req);
    if (ids && !ids.includes(String(attempt.userId))) throw notFound('Attempt');
    const instance = await TaskInstance.findById(attempt.instanceId);
    if (!instance) throw notFound('Task');
    return { attempt, instance };
}

// Everything the teacher needs to judge: the task, the answer, AI scores, the engine result and the reference
router.get('/moderation/:attemptId', asyncHandler(async (req, res) => {
    const { attempt, instance } = await loadForModeration(req);
    const student = await User.findById(attempt.userId).select('fullName email').lean();
    res.json({
        attempt: {
            id: String(attempt._id), iteration: attempt.iteration, status: attempt.status, answer: attempt.answer,
            finalScore: attempt.finalScore, criteria: attempt.criteriaFinal, ai: attempt.ai, deterministic: attempt.deterministic?.details ?? null,
            reviewReasons: attempt.reviewReasons, dispute: attempt.dispute?.at ? attempt.dispute : null, moderation: attempt.moderation,
            xpAwarded: attempt.xpAwarded, createdAt: (attempt as any).createdAt
        },
        student: student ? { fullName: student.fullName, email: student.email } : null,
        instance: { id: String(instance._id), taskType: instance.taskType, mode: instance.mode, difficulty: instance.difficulty, isExam: instance.isExam, content: instance.content },
        reference: { answer: instance.expected?.referenceAnswer ?? '', checklist: instance.expected?.checklist ?? [], engine: instance.expected?.engine ?? null }
    });
}));

const moderateZod = z.object({
    criteria: z.array(z.object({ key: z.enum(CRITERIA), score: z.coerce.number().min(0).max(100) })).length(5),
    comment: z.string().trim().max(3000).default('')
});

router.post('/moderation/:attemptId', validateBody(moderateZod), asyncHandler(async (req, res) => {
    const { attempt, instance } = await loadForModeration(req);
    if (!['auto', 'needs_review', 'moderated'].includes(attempt.status)) throw new HttpError(409, 'not_evaluated', 'The attempt is not evaluated yet');
    const body = req.body as z.infer<typeof moderateZod>;
    const weights = Object.fromEntries((attempt.criteriaFinal ?? []).map(c => [c.key, c.weight ?? 0]));
    const criteriaFinal = CRITERIA.map(key => ({
        key,
        score: Math.round(body.criteria.find(c => c.key === key)!.score),
        weight: weights[key] ?? 0,
        source: 'teacher'
    }));
    const newScore = weightedScore(criteriaFinal, weights);
    const oldScore = attempt.finalScore ?? 0;
    const template = await TaskTemplate.findById(instance.templateId).select('skills').lean();

    // The original AI score stays in moderation.prevScore - these pairs are the reference set for prompt quality (PRD 5.3)
    const r = await adjustAfterModeration({
        userId: attempt.userId, attemptId: attempt._id, oldScore, newScore, oldXp: attempt.xpAwarded,
        difficulty: instance.difficulty, taskType: instance.taskType, iteration: attempt.iteration, isExam: instance.isExam,
        skills: (template?.skills ?? []).map(s => ({ key: s.key, weight: s.weight ?? 1 }))
    });
    attempt.set({
        criteriaFinal,
        finalScore: newScore,
        status: 'moderated',
        xpAwarded: r.xp,
        moderation: {
            by: req.user!.id,
            at: new Date(),
            prevScore: attempt.moderation?.prevScore ?? oldScore,
            comment: body.comment
        }
    });
    await attempt.save();

    // Instance best result follows the corrected scores
    const all = await Attempt.find({ instanceId: instance._id, finalScore: { $ne: null } }).lean();
    instance.bestScore = all.reduce((m, a) => Math.max(m, a.iteration === 2 ? Math.round((a.finalScore ?? 0) * 0.7) : (a.finalScore ?? 0)), 0);
    await instance.save();
    res.json({ ok: true, finalScore: newScore });
}));

export default router;
