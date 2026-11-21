import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { Assignment, Group, User } from '../users/user.model';
import { TaskTemplate } from '../content/content.model';
import { TaskInstance, toPublicInstance } from './task.model';
import { Attempt } from '../attempts/attempt.model';
import { generateInstance, selectTemplate } from './task.service';
import { Norm } from '../legal/legal.model';
import { pick, type Locale } from '../../utils/localized';

const router = Router();
router.use(requireAuth);

// Modes with the number of published templates - the student catalog (STD-2)
router.get('/catalog', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id).lean();
    const locale = (user?.locale as Locale) || 'ru';
    const rows = await TaskTemplate.aggregate([
        { $match: { status: 'published' } },
        { $group: { _id: '$mode', count: { $sum: 1 } } }
    ]);
    const templates = await TaskTemplate.find({ status: 'published' })
        .select('mode taskType difficulty title skills')
        .sort({ difficulty: 1 })
        .lean();
    res.json({
        modes: rows.map(r => ({ mode: r._id, count: r.count })),
        templates: templates.map(t => ({
            id: String(t._id),
            mode: t.mode,
            taskType: t.taskType,
            difficulty: t.difficulty,
            title: pick(t.title as any, locale),
            skills: t.skills.map(s => s.key)
        }))
    });
}));

const nextSchema = z.object({ mode: z.string().optional(), skillKey: z.string().optional() });

// Picks a template by the adaptive rules and generates an instance
router.post('/next', requireRole('student', 'teacher', 'admin'), validateBody(nextSchema), asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    const template = await selectTemplate(user, req.body);
    if (!template) throw new HttpError(404, 'no_templates', 'No published tasks for this mode yet');
    const instance = await generateInstance(String(template._id), user);
    res.status(201).json({ instance: toPublicInstance(instance) });
}));

router.post('/from-template/:templateId', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    const instance = await generateInstance(req.params.templateId, user);
    res.status(201).json({ instance: toPublicInstance(instance) });
}));

// A task of an assignment: an exam keeps one instance per template, a training one reuses the open instance
router.post('/from-assignment/:assignmentId/:templateId', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw notFound('User');
    const assignment = await Assignment.findById(req.params.assignmentId);
    if (!assignment || !assignment.templateIds.some(t => String(t) === req.params.templateId)) throw notFound('Assignment');
    if (!(await Group.exists({ _id: assignment.groupId, studentIds: user._id }))) throw notFound('Assignment');
    const existing = await TaskInstance.findOne({ userId: user._id, assignmentId: assignment._id, templateId: req.params.templateId }).sort({ createdAt: -1 });
    if (existing && (assignment.kind === 'exam' || !existing.closed)) {
        res.json({ instance: toPublicInstance(existing) });
        return;
    }
    if (assignment.dueAt.getTime() < Date.now()) throw new HttpError(409, 'overdue', 'The assignment deadline has passed');
    const instance = await generateInstance(req.params.templateId, user, { assignmentId: String(assignment._id), isExam: assignment.kind === 'exam' });
    res.status(201).json({ instance: toPublicInstance(instance) });
}));

// The instance without "expected"; related norms resolved to their texts from the dictionary
router.get('/instances/:id', asyncHandler(async (req, res) => {
    const instance = await TaskInstance.findById(req.params.id);
    if (!instance) throw notFound('Task');
    const isOwner = String(instance.userId) === req.user!.id;
    if (!isOwner && req.user!.role === 'student') throw notFound('Task');

    const locale = instance.language as Locale;
    const refs = instance.content?.relatedNorms ?? [];
    const norms = refs.length
        ? await Norm.find({ $or: refs.map(r => ({ code: r.code, article: r.article })) }).lean()
        : [];
    const relatedNorms = refs.map(r => {
        const n = norms.find(x => x.code === r.code && x.article === r.article);
        return {
            code: r.code,
            article: r.article,
            title: n ? pick(n.title as any, locale) : '',
            text: n ? pick(n.text as any, locale) : '',
            inDictionary: Boolean(n)
        };
    });

    const attempts = await Attempt.find({ instanceId: instance._id }).sort({ iteration: 1 }).select('iteration status finalScore createdAt').lean();
    res.json({
        instance: { ...toPublicInstance(instance), relatedNorms },
        attempts: attempts.map(a => ({ id: String(a._id), iteration: a.iteration, status: a.status, finalScore: a.finalScore }))
    });
}));

export default router;
