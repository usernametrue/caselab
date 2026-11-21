import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { validateBody } from '../../middleware/validate';
import { Scenario, TaskTemplate } from '../content/content.model';
import { validateScenario } from '../sim/sim-engine';

// Scenario constructor for the branching simulation (PRD 4.6, 9.4 CRUD /admin/scenarios). Admin only.
const router = Router();

const idZod = z.string().trim().regex(/^[a-zA-Z0-9_-]{1,40}$/, 'Id: latin letters, digits, - and _');

export const scenarioZod = z.object({
    title: z.string().trim().min(3).max(300),
    language: z.enum(['ru', 'uz']),
    caseText: z.string().max(20000).default(''),
    roles: z.array(z.object({ key: idZod, name: z.string().trim().min(2).max(120), startNodeId: z.string().default('') })).min(1).max(4),
    startNodeId: idZod,
    nodes: z.array(z.object({
        id: idZod,
        stage: z.string().max(120).default(''),
        speaker: z.string().max(120).default(''),
        text: z.string().trim().min(3).max(5000),
        freeTextRubric: z.string().max(2000).default(''),
        outcome: z.enum(['', 'win', 'partial', 'loss']).default(''),
        choices: z.array(z.object({
            id: idZod,
            text: z.string().trim().min(2).max(1000),
            next: z.string().default(''),
            verdict: z.enum(['correct', 'acceptable', 'wrong']),
            explanation: z.string().max(3000).default(''),
            normRef: z.string().max(200).default('')
        })).max(6).default([])
    })).min(2).max(80),
    status: z.enum(['draft', 'review', 'published']).default('draft')
});

// Broken links block publishing; a draft may be saved half-done
function check(body: z.infer<typeof scenarioZod>) {
    const problems = validateScenario(body as any);
    if (problems.length && body.status === 'published') {
        throw new HttpError(400, 'validation_error', 'The scenario has problems', problems.map(message => ({ path: ['nodes'], message })));
    }
    return problems;
}

router.get('/', asyncHandler(async (_req, res) => {
    const scenarios = await Scenario.find().select('title language status roles nodes updatedAt').sort({ updatedAt: -1 }).lean();
    res.json({
        scenarios: scenarios.map(s => ({
            _id: s._id, title: s.title, language: s.language, status: s.status, roles: s.roles,
            nodesCount: s.nodes?.length ?? 0, updatedAt: (s as any).updatedAt
        }))
    });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const scenario = await Scenario.findById(req.params.id).lean();
    if (!scenario) throw notFound('Scenario');
    res.json({ scenario, problems: validateScenario(scenario as any) });
}));

router.post('/', validateBody(scenarioZod), asyncHandler(async (req, res) => {
    const problems = check(req.body);
    const scenario = await Scenario.create({ ...req.body, authorId: req.user!.id, organizationId: req.user!.organizationId });
    res.status(201).json({ scenario, problems });
}));

router.put('/:id', validateBody(scenarioZod), asyncHandler(async (req, res) => {
    const problems = check(req.body);
    const scenario = await Scenario.findById(req.params.id);
    if (!scenario) throw notFound('Scenario');
    scenario.set(req.body);
    await scenario.save();
    res.json({ scenario, problems });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    // Scenarios used by templates are archived; running simulations keep their own copy
    if (await TaskTemplate.exists({ 'sim.scenarioId': req.params.id })) {
        await Scenario.updateOne({ _id: req.params.id }, { status: 'draft' });
        res.json({ archived: true });
        return;
    }
    const r = await Scenario.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) throw notFound('Scenario');
    res.json({ deleted: true });
}));

export default router;
