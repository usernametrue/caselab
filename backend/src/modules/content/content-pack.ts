import { Types, type Model } from 'mongoose';
import { z } from 'zod';
import { HttpError } from '../../utils/http';
import { LegalDocument, Scenario, TaskTemplate, modeOfTaskType } from './content.model';
import { Track } from '../tracks/track.model';
import { validateTrack } from '../tracks/track.service';
import { validateScenario } from '../sim/sim-engine';
import { checkTemplateLinks, templateZod } from '../admin/admin.routes';
import { documentZod, withRanges } from '../admin/documents.routes';
import { scenarioZod } from '../admin/scenarios.routes';
import { trackZod } from '../tracks/track-admin.routes';
import { Body } from '../legal/legal.model';
import { localizedZod } from '../../utils/localized';

// ADM-8: content pack - documents, scenarios, templates and tracks in one JSON file.
// - "key" is kept on the record: importing the same key again updates it instead of making a copy;
//   "ref" is a reference inside the file only (older files).
// - References between records: documentRef / scenarioRef in templates, templateRef in track stages,
//   document keys in extraction.documentIds; a reference may also be the key of a record already in the database.
// - The whole file is checked first; with dryRun nothing is written and the report says what would happen.
// - Admin: new records come in as drafts, updated records keep their status. Teacher: documents and templates
//   only, everything goes to review, and only the teacher's own unpublished records can be updated.

export const PACK_FORMAT = 'caselab-content';
// Files exported before the product was renamed still import
const LEGACY_FORMATS = ['lexhackathon-content'];
export const PACK_VERSION = 1;

export const packZod = z.object({
    format: z.string().optional(),
    version: z.coerce.number().optional(),
    documents: z.array(z.record(z.string(), z.unknown())).max(300).default([]),
    scenarios: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
    templates: z.array(z.record(z.string(), z.unknown())).max(800).default([]),
    tracks: z.array(z.record(z.string(), z.unknown())).max(100).default([]),
    // Dictionary entries the routes of the pack need (courts are not in the register): added by code, never overwritten
    bodies: z.array(z.record(z.string(), z.unknown())).max(200).default([])
});

const bodyZod = z.object({
    code: z.string().regex(/^[a-z][a-z0-9_.-]{2,80}$/, 'Body code: latin lower case, digits, _ . -'),
    name: localizedZod,
    kind: z.enum(['court', 'state_body', 'prosecutor', 'police', 'inspection', 'notary', 'ombudsman', 'mediation', 'arbitration']),
    level: z.string().max(60).default(''),
    region: z.string().max(120).default(''),
    competence: localizedZod.default({ ru: '', uz: '' })
}).refine(b => b.name.ru || b.name.uz, 'Name the body');

type Kind = 'document' | 'scenario' | 'template' | 'track';
const KINDS: Kind[] = ['document', 'scenario', 'template', 'track'];
const MODELS: Record<Kind, Model<any>> = { document: LegalDocument, scenario: Scenario, template: TaskTemplate, track: Track };
// Keys made by the export for records without their own key: "<prefix>-<id>"
const PREFIX: Record<Kind, string> = { document: 'doc', scenario: 'scn', template: 'tpl', track: 'trk' };
const PLURAL: Record<Kind, 'documents' | 'scenarios' | 'templates' | 'tracks'> = { document: 'documents', scenario: 'scenarios', template: 'templates', track: 'tracks' };
const KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/;

export interface PackActor { id: string; role: string; organizationId: string }

interface Entry {
    kind: Kind;
    index: number;
    raw: Record<string, any>;
    title: string;
    // Key inside the file (key or ref) and the key kept on the record (key only)
    fileKey: string;
    persistKey: string;
    id: string;
    existing: any | null;
    payload: any;
    ok: boolean;
}

type Counts = Record<'documents' | 'scenarios' | 'templates' | 'tracks' | 'bodies', number>;
export interface PackReport {
    dryRun: boolean;
    created: Counts;
    updated: Counts;
    items: { kind: Kind; index: number; key: string; title: string; action: 'create' | 'update' }[];
    errors: { kind: Kind | 'body'; index: number; key: string; title: string; message: string }[];
    warnings: { kind: Kind; index: number; key: string; title: string; message: string }[];
}

const zeros = (): Counts => ({ documents: 0, scenarios: 0, templates: 0, tracks: 0, bodies: 0 });
const titleOf = (x: any) => String(x?.title?.ru || x?.title?.uz || x?.title || x?.key || x?.ref || '').slice(0, 200);
export const issueText = (e: any) => (e instanceof z.ZodError
    ? e.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    : Array.isArray(e?.details) ? e.details.map((d: any) => `${(d.path ?? []).join('.')}: ${d.message}`).join('; ') : String(e?.message ?? e));

// A record already in the database: by its pack key, or by the "<prefix>-<id>" key of an export from this server
async function findByKey(kind: Kind, key: string): Promise<any | null> {
    const byKey = await MODELS[kind].findOne({ importKey: key }).lean();
    if (byKey) return byKey;
    const m = key.match(new RegExp(`^${PREFIX[kind]}-([a-f0-9]{24})$`));
    return m ? MODELS[kind].findById(m[1]).lean() : null;
}

export async function importPack(input: unknown, actor: PackActor, opts: { dryRun: boolean; teacher: boolean }): Promise<PackReport> {
    const body = packZod.parse(input);
    if (body.format && body.format !== PACK_FORMAT && !LEGACY_FORMATS.includes(body.format)) throw new HttpError(400, 'bad_format', `Unknown file format ${body.format}`);
    const report: PackReport = { dryRun: opts.dryRun, created: zeros(), updated: zeros(), items: [], errors: [], warnings: [] };
    const fail = (e: Entry, message: string) => {
        e.ok = false;
        report.errors.push({ kind: e.kind, index: e.index, key: e.fileKey, title: e.title, message });
    };
    const warn = (e: Entry, message: string) => report.warnings.push({ kind: e.kind, index: e.index, key: e.fileKey, title: e.title, message });

    // ---- 1. Keys and targets: an existing record by key is updated, a new one gets its id now ----
    const entries: Record<Kind, Entry[]> = { document: [], scenario: [], template: [], track: [] };
    const byFileKey: Record<Kind, Map<string, Entry>> = { document: new Map(), scenario: new Map(), template: new Map(), track: new Map() };
    for (const kind of KINDS) {
        for (const [index, raw] of body[PLURAL[kind]].entries()) {
            const persistKey = typeof raw.key === 'string' ? raw.key.trim() : '';
            const fileKey = persistKey || (typeof raw.ref === 'string' ? raw.ref.trim() : '');
            const e: Entry = { kind, index, raw, title: titleOf(raw), fileKey, persistKey, id: '', existing: null, payload: null, ok: true };
            entries[kind].push(e);
            if (opts.teacher && (kind === 'scenario' || kind === 'track')) { fail(e, 'Teachers import documents and templates; scenarios and tracks are added by an admin'); continue; }
            if (fileKey && !KEY.test(fileKey)) { fail(e, 'Key: latin letters, digits, _ . : - (up to 100)'); continue; }
            if (fileKey) {
                if (byFileKey[kind].has(fileKey)) { fail(e, `Key ${fileKey} is used twice in the file`); continue; }
                byFileKey[kind].set(fileKey, e);
            }
            if (persistKey) e.existing = await findByKey(kind, persistKey);
            if (e.existing && opts.teacher && (String(e.existing.authorId) !== actor.id || e.existing.status === 'published')) {
                fail(e, 'The key belongs to a published record or to another author');
                continue;
            }
            e.id = e.existing ? String(e.existing._id) : String(new Types.ObjectId());
        }
    }

    // A reference: a record of this file (only if it passed its checks) or a record in the database
    const unresolved = new Set<string>();
    const resolve = async (kind: Kind, ref: unknown): Promise<string | null> => {
        if (typeof ref !== 'string' || !ref) return null;
        const inFile = byFileKey[kind].get(ref);
        if (inFile) return inFile.ok ? inFile.id : null;
        if (OBJECT_ID.test(ref)) return ref;
        const found = await findByKey(kind, ref);
        if (found) return String(found._id);
        unresolved.add(ref);
        return null;
    };
    const refError = (ref: unknown, kind: Kind) => {
        if (typeof ref !== 'string' || !ref) return '';
        const inFile = byFileKey[kind].get(ref);
        if (inFile && !inFile.ok) return `The ${kind} ${ref} has errors`;
        return unresolved.has(ref) ? `Reference ${ref} not found` : '';
    };
    const statusFor = (e: Entry) => (opts.teacher ? 'review' : e.existing?.status ?? 'draft');

    // ---- Dictionary bodies: new codes are added, existing ones stay as the admin edited them ----
    const newBodies: any[] = [];
    const bodyCodes = new Set<string>();
    for (const [index, raw] of body.bodies.entries()) {
        const title = String((raw as any)?.name?.ru || (raw as any)?.code || '');
        if (opts.teacher) { report.errors.push({ kind: 'body', index, key: String((raw as any)?.code ?? ''), title, message: 'Dictionaries are edited by an admin' }); continue; }
        const parsed = bodyZod.safeParse(raw);
        if (!parsed.success) { report.errors.push({ kind: 'body', index, key: String((raw as any)?.code ?? ''), title, message: issueText(parsed.error) }); continue; }
        bodyCodes.add(parsed.data.code);
        if (!(await Body.exists({ code: parsed.data.code }))) newBodies.push(parsed.data);
    }

    // ---- 2. Checks in dependency order ----
    const pending = { documents: new Map<string, any>(), scenarios: new Map<string, any>(), bodies: bodyCodes };
    for (const e of entries.document.filter(x => x.ok)) {
        try {
            e.payload = withRanges(documentZod.parse({ ...e.raw, status: statusFor(e) }));
            pending.documents.set(e.id, { ...e.payload, _id: e.id, authorId: e.existing?.authorId ?? actor.id });
        } catch (err) { fail(e, issueText(err)); }
    }
    for (const e of entries.scenario.filter(x => x.ok)) {
        try {
            e.payload = scenarioZod.parse({ ...e.raw, status: statusFor(e) });
            const problems = validateScenario(e.payload);
            if (problems.length && e.payload.status === 'published') throw new Error(problems.slice(0, 3).join('; '));
            if (problems.length) warn(e, problems.slice(0, 3).join('; '));
            pending.scenarios.set(e.id, { ...e.payload, _id: e.id });
        } catch (err) { fail(e, issueText(err)); }
    }
    for (const e of entries.template.filter(x => x.ok)) {
        try {
            const t: any = { ...e.raw, status: statusFor(e) };
            const refs: [unknown, Kind][] = [];
            const docRef = e.raw.documentRef ?? e.raw.review?.documentId;
            if (docRef) { refs.push([docRef, 'document']); t.review = { ...(t.review ?? {}), documentId: await resolve('document', docRef) }; }
            const scRef = e.raw.scenarioRef ?? e.raw.sim?.scenarioId;
            if (scRef) { refs.push([scRef, 'scenario']); t.sim = { ...(t.sim ?? {}), scenarioId: await resolve('scenario', scRef) }; }
            // Extraction package: a document id may be the "ref" of a document from the same file
            if (t.extraction && typeof t.extraction === 'object') {
                const ids: unknown[] = Array.isArray(t.extraction.documentIds) ? t.extraction.documentIds : [];
                const map = new Map<unknown, string | null>();
                for (const r of ids) { refs.push([r, 'document']); map.set(r, await resolve('document', r)); }
                t.extraction = {
                    ...t.extraction,
                    documentIds: ids.map(r => map.get(r)),
                    reference: Array.isArray(t.extraction.reference) ? t.extraction.reference.map((c: any) => ({ ...c, documentId: map.has(c?.documentId) ? map.get(c.documentId) : c?.documentId })) : t.extraction.reference
                };
            }
            const broken = refs.map(([r, k]) => refError(r, k)).filter(Boolean);
            if (broken.length) throw new Error(broken.join('; '));
            const tpl = templateZod.parse(t);
            // A teacher links published documents or their own (TCH-5)
            if (opts.teacher) {
                for (const id of [tpl.review.documentId, ...tpl.extraction.documentIds].filter(Boolean) as string[]) {
                    if (pending.documents.has(id)) continue;
                    const d: any = await LegalDocument.findById(id).select('status authorId').lean();
                    if (d && d.status !== 'published' && String(d.authorId) !== actor.id) throw new Error('Choose a published document or your own');
                }
            }
            await checkTemplateLinks(tpl, pending);
            e.payload = tpl;
        } catch (err) { fail(e, issueText(err)); }
    }
    for (const e of entries.track.filter(x => x.ok)) {
        try {
            const stages: any[] = Array.isArray(e.raw.stages) ? e.raw.stages : [];
            const broken: string[] = [];
            const resolved = [];
            for (const st of stages) {
                const ref = st?.templateRef ?? st?.templateId;
                const id = await resolve('template', ref);
                const err = refError(ref, 'template');
                if (err) broken.push(err);
                resolved.push({ ...st, templateId: id ?? '' });
            }
            if (broken.length) throw new Error(broken.join('; '));
            const track = trackZod.parse({ ...e.raw, stages: resolved, status: statusFor(e) });
            const problems = validateTrack(track as any);
            const inFile = new Set(entries.template.filter(x => x.ok).map(x => x.id));
            for (const st of track.stages) {
                if (!inFile.has(st.templateId) && !(await TaskTemplate.exists({ _id: st.templateId }))) problems.push(`Template of stage ${st.key} does not exist`);
            }
            if (problems.length && track.status === 'published') throw new Error(problems.slice(0, 3).join('; '));
            if (problems.length) warn(e, problems.slice(0, 3).join('; '));
            e.payload = track;
        } catch (err) { fail(e, issueText(err)); }
    }

    // ---- 3. Report and, unless it is a dry run, the writes ----
    for (const b of newBodies) {
        if (!opts.dryRun) await Body.updateOne({ code: b.code }, { $setOnInsert: { ...b, source: 'pack' } }, { upsert: true });
        report.created.bodies++;
    }
    for (const kind of KINDS) {
        for (const e of entries[kind].filter(x => x.ok && x.payload)) {
            const action = e.existing ? 'update' : 'create';
            if (!opts.dryRun) {
                try {
                    const extra = { ...(kind === 'template' ? { mode: modeOfTaskType(e.payload.taskType) } : {}), ...(e.persistKey ? { importKey: e.persistKey } : {}) };
                    if (e.existing) {
                        const doc = await MODELS[kind].findById(e.id);
                        doc.set({ ...e.payload, ...extra });
                        await doc.save();
                    } else {
                        await MODELS[kind].create({ ...e.payload, ...extra, _id: e.id, authorId: actor.id, organizationId: actor.organizationId, source: 'manual' });
                    }
                } catch (err) { fail(e, issueText(err)); continue; }
            }
            report[action === 'create' ? 'created' : 'updated'][PLURAL[kind]]++;
            report.items.push({ kind, index: e.index, key: e.fileKey, title: e.title, action });
        }
    }
    return report;
}

// ---------- Export: the same format, references by key ----------

const strip = (o: any) => {
    const { _id, __v, createdAt, updatedAt, authorId, organizationId, seedKey, importKey, source, mode, originalId, ...rest } = o;
    return rest;
};
const keyOf = (kind: Kind, o: any) => o.importKey || `${PREFIX[kind]}-${String(o._id)}`;
const noIds = (arr: any[] | undefined, drop: string[] = ['_id', 'from', 'to']) => (arr ?? []).map(x => Object.fromEntries(Object.entries(x).filter(([k]) => !drop.includes(k))));

export async function exportPack(filter: { templateIds?: string[]; trackIds?: string[] } = {}) {
    const everything = !filter.templateIds?.length && !filter.trackIds?.length;
    const tracks = everything ? await Track.find().lean() : filter.trackIds?.length ? await Track.find({ _id: { $in: filter.trackIds } }).lean() : [];
    const templateIds = new Set<string>([...(filter.templateIds ?? []), ...tracks.flatMap(t => (t.stages ?? []).map(s => String(s.templateId)))]);
    const templates = everything ? await TaskTemplate.find().lean() : await TaskTemplate.find({ _id: { $in: [...templateIds] } }).lean();
    const docIds = new Set<string>(templates.flatMap(t => [t.review?.documentId, ...(t.extraction?.documentIds ?? [])].filter(Boolean).map(String)));
    const scenarioIds = new Set<string>(templates.map(t => t.sim?.scenarioId).filter(Boolean).map(String));
    const documents = everything ? await LegalDocument.find().lean() : await LegalDocument.find({ _id: { $in: [...docIds] } }).lean();
    const scenarios = everything ? await Scenario.find().lean() : await Scenario.find({ _id: { $in: [...scenarioIds] } }).lean();
    const docKey = new Map(documents.map(d => [String(d._id), keyOf('document', d)]));
    const scKey = new Map(scenarios.map(s => [String(s._id), keyOf('scenario', s)]));
    const tplKey = new Map(templates.map(t => [String(t._id), keyOf('template', t)]));
    return {
        format: PACK_FORMAT,
        version: PACK_VERSION,
        exportedAt: new Date().toISOString(),
        documents: documents.map(d => ({
            key: keyOf('document', d), ...strip(d),
            flaws: noIds(d.flaws as any), counterpartyEdits: noIds(d.counterpartyEdits as any), segments: noIds(d.segments as any, ['from', 'to'])
        })),
        scenarios: scenarios.map(s => ({ key: keyOf('scenario', s), ...strip(s) })),
        templates: templates.map(t => {
            const { review, sim, extraction, ...rest } = strip(t);
            return {
                key: keyOf('template', t), ...rest,
                ...(review?.documentId ? { documentRef: docKey.get(String(review.documentId)) ?? String(review.documentId) } : {}),
                review: { clientSide: review?.clientSide ?? '', clientGoals: review?.clientGoals ?? { ru: '', uz: '' } },
                ...(sim?.scenarioId ? { scenarioRef: scKey.get(String(sim.scenarioId)) ?? String(sim.scenarioId) } : {}),
                sim: { role: sim?.role ?? '' },
                extraction: {
                    documentIds: (extraction?.documentIds ?? []).map((id: any) => docKey.get(String(id)) ?? String(id)),
                    fields: extraction?.fields ?? [],
                    reference: (extraction?.reference ?? []).map((c: any) => ({ ...c, documentId: docKey.get(String(c.documentId)) ?? String(c.documentId) }))
                }
            };
        }),
        tracks: tracks.map(t => ({
            key: keyOf('track', t), ...strip(t),
            stages: (t.stages ?? []).map((s: any) => {
                const { templateId, ...st } = s;
                return { ...st, templateRef: tplKey.get(String(templateId)) ?? String(templateId) };
            })
        }))
    };
}
