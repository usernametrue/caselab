import { Router } from 'express';
import { asyncHandler, HttpError, notFound } from '../../utils/http';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validateBody } from '../../middleware/validate';
import { LegalDocument, Scenario, Skill, TaskTemplate, modeOfTaskType } from '../content/content.model';
import { DeadlineRule, FeeRate } from '../legal/legal.model';
import { TaskInstance } from '../tasks/task.model';
import { checkTemplateLinks, templateZod } from '../admin/admin.routes';
import { documentZod, withRanges } from '../admin/documents.routes';
import { importPack } from '../content/content-pack';

// TCH-5: teachers write their own templates and documents. They save drafts and send them for review;
// an admin checks and publishes them (PRD 3.3). A published item is edited by the admin only.
const router = Router();
router.use(requireAuth, requireRole('teacher', 'admin'));

const TEACHER_STATUSES = ['draft', 'review'];

function assertStatus(status: string) {
    if (!TEACHER_STATUSES.includes(status)) throw new HttpError(400, 'validation_error', 'Teachers save drafts or send for review', [{ path: ['status'], message: 'Publication is done by an admin' }]);
}

async function own<T>(model: any, id: string, userId: string): Promise<T> {
    const item = /^[a-f0-9]{24}$/.test(id) ? await model.findOne({ _id: id, authorId: userId }) : null;
    if (!item) throw notFound('Item');
    return item;
}

// Dictionaries the template editor needs; documents and scenarios: published ones plus the teacher's own
router.get('/meta', asyncHandler(async (req, res) => {
    const visible = { $or: [{ status: 'published' }, { authorId: req.user!.id }] };
    const [skills, feeRates, deadlineRules, documents, scenarios] = await Promise.all([
        Skill.find().sort({ key: 1 }).lean(),
        FeeRate.find().lean(),
        DeadlineRule.find().lean(),
        LegalDocument.find(visible).select('type title language status parties flaws counterpartyEdits').lean(),
        Scenario.find({ status: 'published' }).select('title status roles').lean()
    ]);
    res.json({
        skills, feeRates, deadlineRules, scenarios,
        documents: documents.map(d => ({ _id: d._id, type: d.type, title: d.title, status: d.status, parties: d.parties, flawsCount: d.flaws?.length ?? 0, editsCount: d.counterpartyEdits?.length ?? 0 }))
    });
}));

// ---------- Templates ----------

router.get('/templates', asyncHandler(async (req, res) => {
    const templates = await TaskTemplate.find({ authorId: req.user!.id }).select('taskType difficulty title status updatedAt').sort({ updatedAt: -1 }).lean();
    res.json({ templates });
}));

router.get('/templates/:id', asyncHandler(async (req, res) => {
    const template = await own<any>(TaskTemplate, req.params.id, req.user!.id);
    res.json({ template });
}));

// A teacher may link only published documents or their own drafts
async function checkTeacherLinks(body: any, userId: string) {
    if (body.review?.documentId) {
        const doc = await LegalDocument.findById(body.review.documentId).select('status authorId').lean();
        if (doc && doc.status !== 'published' && String(doc.authorId) !== userId) {
            throw new HttpError(400, 'validation_error', 'Document not available', [{ path: ['review', 'documentId'], message: 'Choose a published document or your own' }]);
        }
    }
    await checkTemplateLinks(body);
}

router.post('/templates', validateBody(templateZod), asyncHandler(async (req, res) => {
    assertStatus(req.body.status);
    await checkTeacherLinks(req.body, req.user!.id);
    const template = await TaskTemplate.create({ ...req.body, mode: modeOfTaskType(req.body.taskType), authorId: req.user!.id, organizationId: req.user!.organizationId, source: 'manual' });
    res.status(201).json({ template });
}));

router.put('/templates/:id', validateBody(templateZod), asyncHandler(async (req, res) => {
    assertStatus(req.body.status);
    const template = await own<any>(TaskTemplate, req.params.id, req.user!.id);
    if (template.status === 'published') throw new HttpError(409, 'published', 'A published template is edited by an admin');
    await checkTeacherLinks(req.body, req.user!.id);
    template.set({ ...req.body, mode: modeOfTaskType(req.body.taskType) });
    await template.save();
    res.json({ template });
}));

router.delete('/templates/:id', asyncHandler(async (req, res) => {
    const template = await own<any>(TaskTemplate, req.params.id, req.user!.id);
    if (template.status === 'published' || await TaskInstance.exists({ templateId: template._id })) throw new HttpError(409, 'published', 'A template in use is removed by an admin');
    await template.deleteOne();
    res.json({ deleted: true });
}));

// ---------- Content pack (ADM-8 for teachers): documents and templates, everything goes to review ----------

router.post('/import', asyncHandler(async (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const report = await importPack(req.body, { id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId }, { dryRun, teacher: true });
    const written = Object.values(report.created).some(Boolean) || Object.values(report.updated).some(Boolean);
    res.status(dryRun ? 200 : report.errors.length && !written ? 400 : 201).json(report);
}));

// ---------- Documents ----------

router.get('/documents', asyncHandler(async (req, res) => {
    const documents = await LegalDocument.find({ authorId: req.user!.id }).select('type title language status flaws counterpartyEdits updatedAt').sort({ updatedAt: -1 }).lean();
    res.json({ documents: documents.map(d => ({ _id: d._id, type: d.type, title: d.title, language: d.language, status: d.status, flawsCount: d.flaws?.length ?? 0, editsCount: d.counterpartyEdits?.length ?? 0, updatedAt: (d as any).updatedAt })) });
}));

router.get('/documents/:id', asyncHandler(async (req, res) => {
    const document = await own<any>(LegalDocument, req.params.id, req.user!.id);
    res.json({ document });
}));

router.post('/documents', validateBody(documentZod), asyncHandler(async (req, res) => {
    assertStatus(req.body.status);
    const document = await LegalDocument.create({ ...withRanges(req.body), authorId: req.user!.id, organizationId: req.user!.organizationId });
    res.status(201).json({ document });
}));

router.put('/documents/:id', validateBody(documentZod), asyncHandler(async (req, res) => {
    assertStatus(req.body.status);
    const document = await own<any>(LegalDocument, req.params.id, req.user!.id);
    if (document.status === 'published') throw new HttpError(409, 'published', 'A published document is edited by an admin');
    document.set(withRanges(req.body));
    await document.save();
    res.json({ document });
}));

router.delete('/documents/:id', asyncHandler(async (req, res) => {
    const document = await own<any>(LegalDocument, req.params.id, req.user!.id);
    if (document.status === 'published' || await TaskTemplate.exists({ 'review.documentId': document._id })) throw new HttpError(409, 'published', 'A document in use is removed by an admin');
    await document.deleteOne();
    res.json({ deleted: true });
}));

export default router;
