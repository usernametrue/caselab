import { Router } from 'express';
import { z } from 'zod';
import mammoth from 'mammoth';
import { asyncHandler, HttpError } from '../../utils/http';
import { validateBody } from '../../middleware/validate';
import { exportPack, importPack } from '../content/content-pack';

// ADM-8: content import. Everything comes in as a draft and is published after a check.
// Templates may point to documents and scenarios of the same file by "ref" (documentRef / scenarioRef).
// Since the content pack: tracks too, "key" updates the record on a repeated import, updated records keep their status.
const router = Router();

// The pack goes through importPack (content-pack.ts): checks first, ?dryRun=1 writes nothing
router.post('/', asyncHandler(async (req, res) => {
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const report = await importPack(req.body, { id: req.user!.id, role: req.user!.role, organizationId: req.user!.organizationId }, { dryRun, teacher: false });
    const written = Object.values(report.created).some(Boolean) || Object.values(report.updated).some(Boolean);
    res.status(dryRun ? 200 : report.errors.length && !written ? 400 : 201).json(report);
}));

// Export in the same format: everything, or ?templateIds=a,b / ?trackIds=c with the documents and scenarios they use
router.get('/export', asyncHandler(async (req, res) => {
    const ids = (v: unknown) => (typeof v === 'string' ? v.split(',').map(x => x.trim()).filter(x => /^[a-f0-9]{24}$/.test(x)) : []);
    const pack = await exportPack({ templateIds: ids(req.query.templateIds), trackIds: ids(req.query.trackIds) });
    res.setHeader('Content-Disposition', `attachment; filename="caselab-content-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(pack);
}));

// DOCX: plain text for a new document of the library; the admin marks the flaws in the editor afterwards
const docxZod = z.object({
    fileName: z.string().max(300),
    // Base64 of the file; about 7 MB of DOCX at most
    contentBase64: z.string().min(10).max(10_000_000)
});

router.post('/docx', validateBody(docxZod), asyncHandler(async (req, res) => {
    const buffer = Buffer.from(req.body.contentBase64, 'base64');
    // DOCX is a zip archive: it starts with "PK"
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new HttpError(400, 'not_docx', 'The file is not a DOCX document');
    let text = '';
    try {
        text = (await mammoth.extractRawText({ buffer })).value;
    } catch {
        throw new HttpError(400, 'not_docx', 'The DOCX file could not be read');
    }
    text = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 50) throw new HttpError(400, 'docx_empty', 'The document has almost no text');
    res.json({ title: req.body.fileName.replace(/\.docx$/i, '').slice(0, 300), text: text.slice(0, 100000) });
}));

export default router;
