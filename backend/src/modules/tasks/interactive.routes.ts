import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { requireAuth } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { TaskInstance, type TaskInstanceDoc } from './task.model';
import { Attempt } from '../attempts/attempt.model';
import { aiAvailable, aiGenerate } from '../ai/ai.service';
import { LlmUnavailableError } from '../ai/llm-provider';
import { escapeBlock, languageName, loadPrompt, render } from '../ai/prompts';
import { mineOfSegment } from '../review/mines-engine';
import { nodeById, publicNode, startNodeFor, type SimScenario } from '../sim/sim-engine';
import { bodyNames, searchBodies } from '../legal/bodies-import';
import type { Locale } from '../../utils/localized';

// Interactive parts of the trainers that happen before the answer is submitted:
// questions to the client (4.5), clicks on "mines" (4.7), moves in the simulation (4.6), body autocomplete.

async function ownInstance(id: string, userId: string, taskType: string) {
    const instance = /^[a-f0-9]{24}$/.test(id) ? await TaskInstance.findById(id) : null;
    if (!instance || String(instance.userId) !== userId || instance.taskType !== taskType) throw notFound('Task');
    return instance;
}

// Nothing can change once an answer is submitted for the first time (rework of "mines" may still click)
async function assertNotSubmitted(instance: TaskInstanceDoc) {
    if (instance.closed) throw new HttpError(409, 'closed', 'This task is already finished');
    if (await Attempt.exists({ instanceId: instance._id })) throw new HttpError(409, 'already_submitted', 'The answer is already submitted');
}

// ---------- Questions to the client (PRD 4.5, 10.2 clientReply) ----------

export const MAX_CLIENT_QUESTIONS = 3;

const replySchema = z.object({ answer: z.string().min(1), revealedFactKeys: z.array(z.string()).max(20) });

export const tasksInteractiveRouter = Router();
tasksInteractiveRouter.use(requireAuth);

tasksInteractiveRouter.post('/instances/:id/ask-client', validateBody(z.object({ question: z.string().trim().min(5, 'The question is too short').max(500) })), asyncHandler(async (req, res) => {
    const instance = await ownInstance(req.params.id, req.user!.id, 'route_and_apply');
    await assertNotSubmitted(instance);
    const dialog = instance.content?.clientDialog ?? [];
    if (dialog.length >= MAX_CLIENT_QUESTIONS) throw new HttpError(409, 'no_questions_left', 'The client has already answered three questions');
    if (!aiAvailable()) throw new HttpError(503, 'llm_unavailable', 'The client cannot answer right now');
    const engine = instance.expected?.engine as any;
    const facts: { key: string; text: string; onRequest: boolean }[] = engine?.facts ?? [];
    const prompt = loadPrompt('client-reply', 2);
    try {
        // Story and facts are the same for all three questions: they are read from the cache after the first one
        const r = await aiGenerate({
            task: 'clientReply',
            promptVersion: prompt.version,
            ...render(prompt, {
                story: escapeBlock(instance.content?.caseText ?? ''),
                facts: facts.map(f => `[${f.key}]${f.onRequest ? ' (по запросу)' : ''} ${f.text}`).join('\n') || '-',
                language: languageName(instance.language),
                dialog: escapeBlock(dialog.map(d => `Юрист: ${d.question}\nКлиент: ${d.answer}`).join('\n')) || '-',
                question: escapeBlock(req.body.question)
            }),
            schema: replySchema
        });
        // Revealed "on request" facts are kept for the completeness check; unknown keys from the model are dropped
        const onRequest = new Set(facts.filter(f => f.onRequest).map(f => f.key));
        const revealed = r.data.revealedFactKeys.filter(k => onRequest.has(k));
        const entry = { question: req.body.question, answer: r.data.answer, at: new Date() };
        await TaskInstance.updateOne(
            { _id: instance._id, [`content.clientDialog.${MAX_CLIENT_QUESTIONS - 1}`]: { $exists: false } },
            { $push: { 'content.clientDialog': entry }, $addToSet: { 'expected.values.revealedFacts': { $each: revealed } } }
        );
        res.json({ reply: { question: entry.question, answer: entry.answer }, left: MAX_CLIENT_QUESTIONS - dialog.length - 1 });
    } catch (e: any) {
        if (e instanceof LlmUnavailableError) throw new HttpError(503, 'llm_unavailable', 'The client cannot answer right now, try again in a minute');
        throw new HttpError(502, 'llm_failed', 'The client could not answer, try again');
    }
}));

// ---------- "Mines": a click opens a phrase (PRD 4.7) ----------

const TIMER_GRACE_MS = 30_000;

tasksInteractiveRouter.post('/instances/:id/mines/click', validateBody(z.object({ segment: z.number().int().min(0) })), asyncHandler(async (req, res) => {
    const instance = await ownInstance(req.params.id, req.user!.id, 'mines');
    if (instance.closed) throw new HttpError(409, 'closed', 'This task is already finished');
    if (await Attempt.exists({ instanceId: instance._id, status: 'evaluating' })) throw new HttpError(409, 'evaluating', 'The answer is being evaluated');
    if (instance.isExam && await Attempt.exists({ instanceId: instance._id })) throw new HttpError(409, 'already_submitted', 'The answer is already submitted');
    const m = instance.content!.mines!;
    const segment = m.segments[req.body.segment];
    if (!segment) throw new HttpError(400, 'bad_segment', 'No such phrase');
    if (m.timerSec && m.startedAt && Date.now() > m.startedAt.getTime() + m.timerSec * 1000 + TIMER_GRACE_MS) {
        throw new HttpError(409, 'time_over', 'Time is over');
    }
    const engine = instance.expected?.engine as any;
    const mine = mineOfSegment<any>(segment as any, engine?.mines ?? []);
    const already = m.clicks.find(c => c.segment === req.body.segment);
    if (!already) {
        await TaskInstance.updateOne({ _id: instance._id, 'content.mines.clicks.segment': { $ne: req.body.segment } }, { $push: { 'content.mines.clicks': { segment: req.body.segment, mine: Boolean(mine), at: new Date() } } });
    }
    // The simplified level offers replacement options instead of a free field (the correct flags stay on the server)
    const options = mine && m.simplified ? (mine.options ?? []).map((o: any) => o.text) : [];
    res.json({ segment: req.body.segment, mine: Boolean(mine), options, repeated: Boolean(already) });
}));

// ---------- Body autocomplete for the route (PRD 9.4 GET /bodies?q=) ----------

export const bodiesRouter = Router();
bodiesRouter.use(requireAuth);
bodiesRouter.get('/', asyncHandler(async (req, res) => {
    const locale: Locale = req.query.locale === 'uz' ? 'uz' : 'ru';
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    res.json({ bodies: await searchBodies(q, locale, 20) });
}));

// Names for known codes, e.g. to show the routes of a template being edited
bodiesRouter.get('/names', asyncHandler(async (req, res) => {
    const locale: Locale = req.query.locale === 'uz' ? 'uz' : 'ru';
    const codes = typeof req.query.codes === 'string' ? req.query.codes.split(',').map(c => c.trim()).filter(Boolean).slice(0, 100) : [];
    res.json({ names: codes.length ? await bodyNames(codes, locale) : {} });
}));

// ---------- Simulation moves (PRD 9.4 POST /sim/:instanceId/turn) ----------

export const simRouter = Router();
simRouter.use(requireAuth);

const simState = (instance: TaskInstanceDoc) => {
    const scenario = (instance.expected?.engine as any)?.scenario as SimScenario;
    const sim = instance.content!.sim!;
    return {
        role: sim.role,
        roleName: sim.roleName,
        roles: sim.roles,
        finished: sim.finished,
        node: sim.currentNodeId ? publicNode(nodeById(scenario, sim.currentNodeId)) : null,
        // The path so far: the student's own choices and justifications, without verdicts
        history: sim.history.map(h => {
            const node = nodeById(scenario, h.nodeId!);
            return {
                stage: node?.stage ?? '',
                speaker: node?.speaker ?? '',
                text: node?.text ?? '',
                choice: node?.choices.find(c => c.id === h.choiceId)?.text ?? '',
                justification: h.justification ?? ''
            };
        })
    };
};

simRouter.get('/:instanceId', asyncHandler(async (req, res) => {
    const instance = await ownInstance(req.params.instanceId, req.user!.id, 'sim_branching');
    res.json({ state: simState(instance) });
}));

simRouter.post('/:instanceId/role', validateBody(z.object({ role: z.string().min(1) })), asyncHandler(async (req, res) => {
    const instance = await ownInstance(req.params.instanceId, req.user!.id, 'sim_branching');
    await assertNotSubmitted(instance);
    const sim = instance.content!.sim!;
    if (sim.role) throw new HttpError(409, 'role_chosen', 'The role is already chosen');
    const scenario = (instance.expected?.engine as any).scenario as SimScenario;
    const role = scenario.roles.find(r => r.key === req.body.role);
    if (!role) throw new HttpError(400, 'bad_role', 'No such role');
    sim.role = role.key;
    sim.roleName = role.name;
    sim.currentNodeId = startNodeFor(scenario, role.key);
    instance.markModified('content.sim');
    await instance.save();
    res.json({ state: simState(instance) });
}));

const turnSchema = z.object({ choiceId: z.string().min(1), justification: z.string().trim().max(2000).default('') });

simRouter.post('/:instanceId/turn', validateBody(turnSchema), asyncHandler(async (req, res) => {
    const instance = await ownInstance(req.params.instanceId, req.user!.id, 'sim_branching');
    await assertNotSubmitted(instance);
    const sim = instance.content!.sim!;
    if (!sim.role) throw new HttpError(409, 'no_role', 'Choose a role first');
    if (sim.finished) throw new HttpError(409, 'finished', 'The hearing is over');
    const scenario = (instance.expected?.engine as any).scenario as SimScenario;
    const node = nodeById(scenario, sim.currentNodeId);
    const choice = node?.choices.find(c => c.id === req.body.choiceId);
    if (!node || !choice) throw new HttpError(400, 'bad_choice', 'No such choice at this step');
    // Key nodes need a short justification or a remark to the court in the student's own words
    if (node.freeTextRubric && req.body.justification.length < 10) throw new HttpError(400, 'justification_required', 'Explain your choice in a sentence or two');
    sim.history.push({ nodeId: node.id, choiceId: choice.id, justification: req.body.justification });
    const next = choice.next ? nodeById(scenario, choice.next) : null;
    if (!next) throw new HttpError(500, 'broken_scenario', 'The scenario has a broken link');
    sim.currentNodeId = next.id;
    sim.finished = !next.choices.length;
    instance.markModified('content.sim');
    await instance.save();
    res.json({ state: simState(instance) });
}));
