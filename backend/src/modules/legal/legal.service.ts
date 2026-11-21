import { BrvValue, CalendarDay, DeadlineRule, FeeRate, Norm } from './legal.model';
import { computeDeadline, type DeadlineContext } from './engines/deadline-engine';
import { computeFee, type FeeInstance } from './engines/fee-engine';
import { HttpError } from '../../utils/http';

export async function loadBrvTable() {
    const rows = await BrvValue.find().lean();
    return rows.map(r => ({ value: r.value, validFrom: r.validFrom }));
}

export async function feeFor(params: { rateCode: string; filingDate: string; amount?: number; isSme?: boolean; instance?: FeeInstance; pages?: number }) {
    const rate = await FeeRate.findOne({ code: params.rateCode }).lean();
    if (!rate) throw new HttpError(400, 'unknown_fee_rate', `Fee rate "${params.rateCode}" is not in the dictionary`);
    const brv = await loadBrvTable();
    if (!brv.length) throw new HttpError(400, 'no_brv', 'БРВ dictionary is empty');
    try {
        return computeFee({
            rate: rate as any,
            filingDate: params.filingDate,
            amount: params.amount,
            isSme: params.isSme,
            instance: params.instance,
            pages: params.pages
        }, brv);
    } catch (e: any) {
        throw new HttpError(400, 'fee_error', e.message);
    }
}

export async function deadlineFor(params: { ruleCode: string; eventDate: string; suspensions?: { from: string; to: string }[]; extensionDays?: number }) {
    const rule = await DeadlineRule.findOne({ code: params.ruleCode }).lean();
    if (!rule) throw new HttpError(400, 'unknown_rule', `Deadline rule "${params.ruleCode}" is not in the dictionary`);
    const calendar = await CalendarDay.find().lean();
    const ctx: DeadlineContext = {
        calendar: calendar.map(c => ({ date: c.date, type: c.type as any })),
        suspensions: params.suspensions,
        extensionDays: params.extensionDays
    };
    try {
        return { rule, ...computeDeadline(params.eventDate, rule as any, ctx) };
    } catch (e: any) {
        throw new HttpError(400, 'deadline_error', e.message);
    }
}

// "ст. 151 ЭПК", "ЭПК, ст. 151", "статья 151 ЭПК" -> { code: 'ЭПК', article: '151' }
export function parseNormRef(ref: string): { code: string; article: string } | null {
    if (!ref) return null;
    const article = ref.match(/(?:ст\.|статья|статьи|статье|modda|moddasi|m\.)\s*(\d+(?:-\d+)?)/iu)?.[1]
        ?? ref.match(/(\d+(?:-\d+)?)\s*-?\s*modda/iu)?.[1];
    // \b does not work with Cyrillic, so letter lookarounds are used
    const code = ref.match(/(?<!\p{L})(ЭПК|ГПК|ГК|ТК|КоАО|НК|IPK|FPK|FK|MK)(?!\p{L})/iu)?.[1];
    if (!article || !code) return null;
    // Uzbek abbreviations map to the codes stored in the norms dictionary
    const uzToRu: Record<string, string> = { IPK: 'ЭПК', FPK: 'ГПК', FK: 'ГК', MK: 'ТК' };
    const upper = code.toUpperCase();
    return { code: uzToRu[upper] ?? (upper === 'КОАО' ? 'КоАО' : upper), article };
}

export async function normExists(ref: string) {
    const parsed = parseNormRef(ref);
    if (!parsed) return false;
    return Boolean(await Norm.exists({ code: parsed.code, article: parsed.article }));
}
