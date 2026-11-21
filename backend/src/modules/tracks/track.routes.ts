import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { Track, TrackRun, type TrackRunDoc } from './track.model';
import { catchUpRun, startRun } from './track.service';
import { Assignment, Group, User } from '../users/user.model';
import { pick, type Locale } from '../../utils/localized';

// Case tracks for students (PRD 4.10, 9.4: POST /tracks/:id/start, GET /runs/:id). A stage is submitted
// through the ordinary POST /attempts of its task; the evaluation worker then moves the case on.
export const tracksRouter = Router();
tracksRouter.use(requireAuth);

async function examHidden(run: TrackRunDoc) {
    if (!run.isExam) return false;
    const a = await Assignment.findById(run.assignmentId).select('resultsPublished').lean();
    return !a?.resultsPublished;
}

export async function publicRun(run: TrackRunDoc, viewer: 'student' | 'teacher' = 'student') {
    const hidden = viewer === 'student' && await examHidden(run);
    const snapshot = run.snapshot as any;
    const last = run.visits[run.visits.length - 1];
    return {
        id: String(run._id),
        trackId: String(run.trackId),
        title: run.title,
        role: run.role,
        status: run.status,
        isExam: run.isExam,
        assignmentId: run.assignmentId ? String(run.assignmentId) : null,
        currentDate: run.currentDate,
        currentInstanceId: run.status === 'active' && last ? String(last.instanceId) : null,
        // The current stage is waiting for the student or for the evaluation
        waiting: run.status === 'active' && Boolean(last?.attemptId),
        stagesTotal: (snapshot.stages ?? []).length,
        visits: run.visits.map(v => ({
            stageKey: v.stageKey, title: v.title, date: v.date, instanceId: String(v.instanceId), evaluated: Boolean(v.attemptId),
            score: hidden ? null : v.score, setback: v.setback, reason: v.reason, courtAct: v.courtAct, next: v.next
        })),
        folder: run.folder.map(f => ({ kind: f.kind, title: f.title, text: f.text, date: f.date, stageKey: f.stageKey, generatedByAi: f.generatedByAi })),
        outcome: hidden ? null : run.outcome || null,
        outcomeScore: hidden ? null : run.outcomeScore,
        finalScore: hidden ? null : run.finalScore,
        xpBonus: run.xpBonus,
        awaitingPublication: hidden && run.status === 'finished',
        finishedAt: run.finishedAt,
        createdAt: (run as any).createdAt
    };
}

tracksRouter.get('/', asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.id).select('locale').lean();
    const locale = (user?.locale as Locale) || 'ru';
    const tracks = await Track.find({ status: 'published' }).select('title description stages').lean();
    const runs = await TrackRun.find({ userId: req.user!.id, assignmentId: null }).sort({ createdAt: -1 }).select('trackId status finalScore outcome').lean();
    res.json({
        tracks: tracks.map(t => {
            const run = runs.find(r => String(r.trackId) === String(t._id));
            return {
                id: String(t._id), title: pick(t.title as any, locale), description: pick(t.description as any, locale), stagesCount: t.stages?.length ?? 0,
                run: run ? { id: String(run._id), status: run.status, finalScore: run.finalScore, outcome: run.outcome } : null
            };
        })
    });
}));

tracksRouter.post('/:id/start', validateBody(z.object({ assignmentId: z.string().regex(/^[a-f0-9]{24}$/).optional(), restart: z.boolean().default(false) })), asyncHandler(async (req, res) => {
    let isExam = false;
    if (req.body.assignmentId) {
        const a = await Assignment.findById(req.body.assignmentId).lean();
        if (!a || !(a.trackIds ?? []).some(t => String(t) === req.params.id)) throw notFound('Assignment');
        if (!(await Group.exists({ _id: a.groupId, studentIds: req.user!.id }))) throw notFound('Assignment');
        const any = await TrackRun.findOne({ trackId: req.params.id, userId: req.user!.id, assignmentId: a._id }).sort({ createdAt: -1 });
        // An exam case is played once; a training one may be replayed after it is finished
        if (any && (a.kind === 'exam' || any.status === 'active' || !req.body.restart)) {
            res.json({ run: await publicRun(any) });
            return;
        }
        if (a.dueAt.getTime() < Date.now()) throw new HttpError(409, 'overdue', 'The assignment deadline has passed');
        isExam = a.kind === 'exam';
    } else if (!req.body.restart) {
        const finished = await TrackRun.findOne({ trackId: req.params.id, userId: req.user!.id, assignmentId: null }).sort({ createdAt: -1 });
        if (finished) {
            res.json({ run: await publicRun(finished) });
            return;
        }
    }
    const run = await startRun(req.params.id, req.user!.id, { assignmentId: req.body.assignmentId, isExam });
    res.status(201).json({ run: await publicRun(run) });
}));

export const runsRouter = Router();
runsRouter.use(requireAuth);

runsRouter.get('/', asyncHandler(async (req, res) => {
    const runs = await TrackRun.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(30);
    res.json({ runs: await Promise.all(runs.map(async r => { const p = await publicRun(r); return { ...p, folder: undefined, visits: undefined, stagesDone: r.visits.filter(v => v.attemptId).length }; })) });
}));

runsRouter.get('/:id', asyncHandler(async (req, res) => {
    let run = /^[a-f0-9]{24}$/.test(req.params.id) ? await TrackRun.findById(req.params.id) : null;
    if (!run) throw notFound('Case');
    const own = String(run.userId) === req.user!.id;
    if (!own && req.user!.role === 'student') throw notFound('Case');
    // A teacher sees the cases of the students of their groups
    if (!own && req.user!.role === 'teacher' && !(await Group.exists({ teacherId: req.user!.id, studentIds: run.userId }))) throw notFound('Case');
    if (own) run = await catchUpRun(run);
    res.json({ run: await publicRun(run, own ? 'student' : 'teacher') });
}));
