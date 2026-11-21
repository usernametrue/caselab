import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { TaskInstance } from '../tasks/task.model';
import { Attempt } from '../attempts/attempt.model';
import { finishEarly, publicHearing, studentSays, type HearingScenario, type HearingState } from './hearing-engine';

// Moves of the hearing simulation before the answer is submitted (sim_hearing)
export const hearingRouter = Router();
hearingRouter.use(requireAuth);

async function ownHearing(id: string, userId: string) {
    const instance = /^[a-f0-9]{24}$/.test(id) ? await TaskInstance.findById(id) : null;
    if (!instance || String(instance.userId) !== userId || instance.taskType !== 'sim_hearing') throw notFound('Task');
    return instance;
}

async function assertOpen(instance: Awaited<ReturnType<typeof ownHearing>>) {
    if (instance.closed) throw new HttpError(409, 'closed', 'This task is already finished');
    if (await Attempt.exists({ instanceId: instance._id })) throw new HttpError(409, 'already_submitted', 'The answer is already submitted');
}

const parts = (instance: Awaited<ReturnType<typeof ownHearing>>) => ({
    scenario: (instance.expected?.engine as any)?.scenario as HearingScenario,
    state: instance.content!.hearing as HearingState
});

async function save(instance: Awaited<ReturnType<typeof ownHearing>>, state: HearingState) {
    instance.content!.hearing = state;
    instance.markModified('content.hearing');
    await instance.save();
}

hearingRouter.get('/:instanceId', asyncHandler(async (req, res) => {
    const instance = await ownHearing(req.params.instanceId, req.user!.id);
    res.json({ state: publicHearing(parts(instance).state, instance.difficulty) });
}));

hearingRouter.post('/:instanceId/say', validateBody(z.object({
    text: z.string().trim().min(2, 'Say something').max(2000),
    voice: z.boolean().default(false)
})), asyncHandler(async (req, res) => {
    const instance = await ownHearing(req.params.instanceId, req.user!.id);
    await assertOpen(instance);
    const { scenario, state } = parts(instance);
    const next = await studentSays(scenario, state, req.body.text, req.body.voice);
    await save(instance, next);
    res.json({ state: publicHearing(next, instance.difficulty) });
}));

hearingRouter.post('/:instanceId/finish', asyncHandler(async (req, res) => {
    const instance = await ownHearing(req.params.instanceId, req.user!.id);
    await assertOpen(instance);
    const { scenario, state } = parts(instance);
    const next = finishEarly(scenario, state);
    await save(instance, next);
    res.json({ state: publicHearing(next, instance.difficulty) });
}));
