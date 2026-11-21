import { Router } from 'express';
import { Types } from 'mongoose';
import { asyncHandler, HttpError } from '../../utils/http';
import { LegalDocument, TaskTemplate } from '../content/content.model';
import { Track } from '../tracks/track.model';
import { pick, type Locale } from '../../utils/localized';

// "Where is it used": the records that link to a document, template, scenario or hearing. Admin only.
const router = Router();

const title = (v: any, locale: Locale) => (typeof v === 'string' ? v : pick(v ?? {}, locale) || v?.ru || v?.uz || '');

router.get('/:kind/:id', asyncHandler(async (req, res) => {
    const { kind, id } = req.params;
    if (!Types.ObjectId.isValid(id)) throw new HttpError(400, 'bad_id', 'Bad id');
    const locale: Locale = req.query.locale === 'uz' ? 'uz' : 'ru';
    const oid = new Types.ObjectId(id);
    const items: { kind: string; id: string; title: string; status: string }[] = [];
    const templates = (filter: Record<string, unknown>) => TaskTemplate.find(filter).select('title status').lean()
        .then(rows => rows.forEach(t => items.push({ kind: 'template', id: String(t._id), title: title(t.title, locale), status: t.status })));

    if (kind === 'document') {
        await templates({ $or: [{ 'review.documentId': oid }, { 'extraction.documentIds': oid }] });
        // AI copies of a court act with injected errors
        (await LegalDocument.find({ originalId: oid }).select('title status').lean())
            .forEach(d => items.push({ kind: 'document', id: String(d._id), title: d.title, status: d.status }));
    } else if (kind === 'template') {
        (await Track.find({ 'stages.templateId': oid }).select('title status').lean())
            .forEach(t => items.push({ kind: 'track', id: String(t._id), title: title(t.title, locale), status: t.status }));
    } else if (kind === 'scenario') {
        await templates({ 'sim.scenarioId': oid });
    } else if (kind === 'hearing') {
        await templates({ 'hearing.scenarioId': oid });
    } else throw new HttpError(400, 'bad_kind', 'Unknown kind');

    res.json({ items });
}));

export default router;
