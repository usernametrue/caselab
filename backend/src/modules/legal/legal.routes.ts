import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { deadlineFor, feeFor } from './legal.service';
import { CalendarDay, Court, Norm } from './legal.model';
import { pick } from '../../utils/localized';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Calculators for checking content (teacher, admin) - PRD 9.4
export const legalRouter = Router();
legalRouter.use(requireAuth, requireRole('teacher', 'admin'));

const feeSchema = z.object({
    rateCode: z.string(),
    filingDate: isoDate,
    amount: z.coerce.number().min(0).optional(),
    isSme: z.boolean().optional(),
    instance: z.enum(['first', 'appeal', 'cassation', 'revision']).optional(),
    pages: z.coerce.number().int().min(1).optional()
});
legalRouter.post('/fee', validateBody(feeSchema), asyncHandler(async (req, res) => {
    res.json(await feeFor(req.body));
}));

const deadlineSchema = z.object({
    ruleCode: z.string(),
    eventDate: isoDate,
    suspensions: z.array(z.object({ from: isoDate, to: isoDate })).optional(),
    extensionDays: z.coerce.number().int().min(0).optional()
});
legalRouter.post('/deadline', validateBody(deadlineSchema), asyncHandler(async (req, res) => {
    res.json(await deadlineFor(req.body));
}));

// Article texts for the task panel
export const normsRouter = Router();
normsRouter.use(requireAuth);
normsRouter.get('/', asyncHandler(async (req, res) => {
    const filter: Record<string, string> = {};
    if (typeof req.query.code === 'string') filter.code = req.query.code;
    if (typeof req.query.article === 'string') filter.article = req.query.article;
    const norms = await Norm.find(filter).sort({ code: 1, article: 1 }).limit(100).lean();
    res.json({ norms });
}));

// Court names for the autocomplete in the procedural card (like electronic filing)
export const courtsRouter = Router();
courtsRouter.use(requireAuth);
courtsRouter.get('/', asyncHandler(async (req, res) => {
    const locale = req.query.locale === 'uz' ? 'uz' : 'ru';
    const courts = await Court.find().sort({ level: 1 }).limit(500).lean();
    res.json({ courts: courts.map(c => ({ name: pick(c.name as any, locale), level: c.level, region: c.region })) });
}));

// Non-working days for the calendar tool in the task panel (PRD 4.0)
export const calendarRouter = Router();
calendarRouter.use(requireAuth);
calendarRouter.get('/', asyncHandler(async (req, res) => {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const days = await CalendarDay.find({ date: { $gte: `${year - 1}-01-01`, $lte: `${year + 1}-12-31` } }).sort({ date: 1 }).lean();
    res.json({ weekendDays: [0, 6], days: days.map(d => ({ date: d.date, type: d.type, name: d.name })) });
}));
