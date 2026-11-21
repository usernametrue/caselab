import { Body, Court } from './legal.model';
import type { RegisterOrg } from '../../seed/reestr-organizations';
import { pick, type Locale } from '../../utils/localized';

// Bodies for the "where to apply" trainer (PRD 4.5) from the open register of state functions (reestr.gov.uz).
// The register lists executive bodies, khokimiyats, law enforcement and the two top courts; state enterprises,
// institutions and non-state organizations are left out because a client does not apply to them for protection.

export const REGISTER_API = 'https://api-reestr.adliya.uz/v1/gov-function/reference/organizations';
export const REGISTER_SITE = 'https://reestr.gov.uz/';

const SKIPPED_CATEGORIES = new Set(['Davlat muassasasi', 'Milliy markaz', 'Nodavlat tashkilot']);

const LEVELS: Record<string, string> = {
    CONSTITUTIONAL: 'republican',
    REPUBLICAN_EXECUTIVE: 'republican',
    KHOKIMIYAT_AND_LOCAL_COUNCIL: 'regional',
    KARAKALPAKSTAN: 'regional',
    OTHER: 'republican'
};

// The kind is guessed from the name; the admin can correct it in the dictionary
function kindOf(org: RegisterOrg) {
    const n = `${org.name.ru} ${org.name.uz}`.toLowerCase();
    if (org.category === 'Sudlar' || /(?<!\p{L})(суд|sudi)(?!\p{L})/u.test(n)) return 'court';
    if (n.includes('инспекц') || n.includes('inspeksiya')) return 'inspection';
    if (n.includes('прокуратур') || n.includes('prokuratura')) return 'prosecutor';
    if (n.includes('внутренних дел') || n.includes('ichki ishlar')) return 'police';
    if (n.includes('омбудсман') || n.includes('ombudsman')) return 'ombudsman';
    return 'state_body';
}

function levelOf(org: RegisterOrg) {
    if (/Tuman|Hududiy/i.test(org.category)) return org.category.startsWith('Hududiy') ? 'territorial' : 'district';
    return LEVELS[org.group] ?? '';
}

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/[;\s]+$/, '').trim();

export function mapRegisterOrgs(orgs: RegisterOrg[]) {
    const seen = new Set<string>();
    const rows = [];
    for (const org of orgs) {
        if (SKIPPED_CATEGORIES.has(org.category.trim())) continue;
        const ru = clean(org.name.ru);
        const uz = clean(org.name.uz);
        if (!ru && !uz) continue;
        // The register lists some bodies twice (several function passports) - one record per name
        const dedupe = (ru || uz).toLowerCase();
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        rows.push({
            code: `reestr-${org.id}`,
            name: { ru, uz },
            nameUzCyrl: clean(org.name.oz),
            kind: kindOf(org),
            level: levelOf(org),
            reestrId: org.id,
            reestrCategory: org.category.trim(),
            source: REGISTER_SITE
        });
    }
    return rows;
}

// Inserts new register bodies and refreshes names of the imported ones; kind, level and competence edited by the admin stay
export async function upsertRegisterBodies(orgs: RegisterOrg[]) {
    let added = 0;
    let updated = 0;
    for (const row of mapRegisterOrgs(orgs)) {
        const { code, name, nameUzCyrl, reestrId, reestrCategory, source, kind, level } = row;
        const r = await Body.updateOne(
            { code },
            { $set: { name, nameUzCyrl, reestrId, reestrCategory, source }, $setOnInsert: { code, kind, level } },
            { upsert: true }
        );
        if (r.upsertedCount) added++;
        else if (r.modifiedCount) updated++;
    }
    return { added, updated };
}

// Live import from the register API (the admin button); the register answers { status, data: [...] }
export async function fetchRegisterOrgs(): Promise<RegisterOrg[]> {
    const res = await fetch(REGISTER_API, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Register answered ${res.status}`);
    const json: any = await res.json();
    if (!Array.isArray(json?.data)) throw new Error('Unexpected register response');
    return json.data
        .filter((x: any) => x?.status === 'ACTIVE' && x?.name)
        .map((x: any) => ({
            id: Number(x.id),
            name: { uz: String(x.name.uz ?? ''), oz: String(x.name.oz ?? ''), ru: String(x.name.ru ?? '') },
            category: String(x.category_response?.name ?? ''),
            group: String(x.category_response?.category_group ?? '')
        }));
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Autocomplete for route steps: bodies plus the courts dictionary (courts get the code "court-<id>")
export async function searchBodies(q: string, locale: Locale, limit = 20) {
    const rx = q.trim() ? new RegExp(escapeRegex(q.trim()), 'i') : null;
    const [bodies, courts] = await Promise.all([
        Body.find(rx ? { $or: [{ 'name.ru': rx }, { 'name.uz': rx }, { nameUzCyrl: rx }, { code: rx }] } : {}).sort({ kind: 1, 'name.ru': 1 }).limit(limit).lean(),
        Court.find(rx ? { $or: [{ 'name.ru': rx }, { 'name.uz': rx }] } : {}).sort({ level: 1 }).limit(limit).lean()
    ]);
    return [
        ...courts.map(c => ({ code: `court-${c._id}`, name: pick(c.name as any, locale), kind: 'court', level: c.level, region: c.region ?? '' })),
        ...bodies.map(b => ({ code: b.code, name: pick(b.name as any, locale), kind: b.kind, level: b.level ?? '', region: b.region ?? '' }))
    ].slice(0, limit);
}

// Names for a list of codes, used to show the student's route and the reference routes
export async function bodyNames(codes: string[], locale: Locale) {
    const courtIds = codes.filter(c => c.startsWith('court-')).map(c => c.slice(6)).filter(id => /^[a-f0-9]{24}$/.test(id));
    const [bodies, courts] = await Promise.all([
        Body.find({ code: { $in: codes } }).lean(),
        courtIds.length ? Court.find({ _id: { $in: courtIds } }).lean() : Promise.resolve([] as any[])
    ]);
    const names: Record<string, string> = {};
    for (const b of bodies) names[b.code] = pick(b.name as any, locale);
    for (const c of courts) names[`court-${c._id}`] = pick(c.name as any, locale);
    return names;
}

export async function bodyExists(code: string) {
    if (code.startsWith('court-')) {
        const id = code.slice(6);
        return /^[a-f0-9]{24}$/.test(id) && Boolean(await Court.exists({ _id: id }));
    }
    return Boolean(await Body.exists({ code }));
}
