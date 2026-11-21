import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { validateBody } from '../../middleware/validate';
import { TaskTemplate } from '../content/content.model';
import { Hearing, PARTICIPANT_ROLES } from '../hearing/hearing.model';
import { STUDENT, validateHearing } from '../hearing/hearing-engine';

// Scenarios of the hearing simulation with AI participants (sim_hearing). Admin only.
const router = Router();

const keyZod = z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'Key: latin letters, digits, _');

export const hearingZod = z.object({
    title: z.string().trim().min(3).max(300),
    language: z.enum(['ru', 'uz']),
    court: z.string().trim().max(300).default(''),
    caseNumber: z.string().trim().max(100).default(''),
    caseText: z.string().max(20000).default(''),
    hiddenFacts: z.string().max(20000).default(''),
    studentRole: z.object({ name: z.string().trim().min(2).max(200), goal: z.string().max(3000).default('') }),
    participants: z.array(z.object({
        key: keyZod.refine(k => k !== STUDENT, `"${STUDENT}" is reserved`),
        name: z.string().trim().min(2).max(200),
        role: z.enum(PARTICIPANT_ROLES).default('other'),
        persona: z.string().max(5000).default('')
    })).min(1).max(8),
    stages: z.array(z.object({
        key: keyZod,
        title: z.string().trim().min(2).max(200),
        goal: z.string().max(2000).default(''),
        studentTask: z.string().max(2000).default(''),
        opening: z.string().max(3000).default(''),
        openingBy: z.string().default(''),
        maxTurns: z.coerce.number().int().min(1).max(12).default(4)
    })).min(1).max(12),
    decisionGuide: z.string().max(5000).default(''),
    criteria: z.array(z.object({ key: z.string().trim().min(1).max(60), title: z.string().trim().min(2).max(200), description: z.string().max(2000).default('') })).max(10).default([]),
    status: z.enum(['draft', 'review', 'published']).default('draft')
});

// Problems block publishing; a draft may be saved half-done
function check(body: z.infer<typeof hearingZod>) {
    const problems = validateHearing(body as any);
    if (problems.length && body.status === 'published') {
        throw new HttpError(400, 'validation_error', 'The scenario has problems', problems.map(message => ({ path: ['stages'], message })));
    }
    return problems;
}

// Templates that play this scenario: shown in the editor as "where it is used"
const usedBy = async (id: unknown) => (await TaskTemplate.find({ 'hearing.scenarioId': id }).select('title status difficulty').lean())
    .map(t => ({ _id: t._id, title: t.title, status: t.status, difficulty: t.difficulty }));

router.get('/', asyncHandler(async (_req, res) => {
    const list = await Hearing.find().select('title language status participants stages updatedAt').sort({ updatedAt: -1 }).lean();
    res.json({
        hearings: list.map(h => ({
            _id: h._id, title: h.title, language: h.language, status: h.status,
            participantsCount: h.participants?.length ?? 0, stagesCount: h.stages?.length ?? 0, updatedAt: (h as any).updatedAt
        }))
    });
}));

router.get('/:id', asyncHandler(async (req, res) => {
    const hearing = /^[a-f0-9]{24}$/.test(req.params.id) ? await Hearing.findById(req.params.id).lean() : null;
    if (!hearing) throw notFound('Hearing');
    res.json({ hearing, problems: validateHearing(hearing as any), usedBy: await usedBy(hearing._id) });
}));

router.post('/', validateBody(hearingZod), asyncHandler(async (req, res) => {
    const problems = check(req.body);
    const hearing = await Hearing.create({ ...req.body, authorId: req.user!.id, organizationId: req.user!.organizationId });
    res.status(201).json({ hearing, problems });
}));

router.put('/:id', validateBody(hearingZod), asyncHandler(async (req, res) => {
    const problems = check(req.body);
    const hearing = /^[a-f0-9]{24}$/.test(req.params.id) ? await Hearing.findById(req.params.id) : null;
    if (!hearing) throw notFound('Hearing');
    hearing.set(req.body);
    await hearing.save();
    res.json({ hearing, problems });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
    // Scenarios used by templates go back to drafts; running hearings keep their own copy
    if (await TaskTemplate.exists({ 'hearing.scenarioId': req.params.id })) {
        await Hearing.updateOne({ _id: req.params.id }, { status: 'draft' });
        res.json({ archived: true });
        return;
    }
    const r = await Hearing.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) throw notFound('Hearing');
    res.json({ deleted: true });
}));

export default router;
