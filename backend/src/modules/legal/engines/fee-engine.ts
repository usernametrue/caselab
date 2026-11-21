import { formatRuDate, isIsoDate } from './dates';

// State fee engine - ЗРУ-600 annex 1 item 2 as described in PRD 8.4

export interface BrvEntry { value: number; validFrom: string }

export interface FeeRateInput {
    code: string;
    kind: 'percent' | 'fixed' | 'percent_brv_per_page';
    percent?: number;
    minBrv?: number;
    fixedBrv?: number;
    smeDiscount?: boolean;
    articleRef?: string;
}

export type FeeInstance = 'first' | 'appeal' | 'cassation' | 'revision';

export interface FeeInput {
    rate: FeeRateInput;
    filingDate: string;
    // Claim amount for first instance, disputed amount for appeal/cassation/revision (property claims)
    amount?: number;
    pages?: number;
    isSme?: boolean;
    instance?: FeeInstance;
}

export interface FeeResult {
    fee: number;
    brv: number;
    steps: string[];
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} сум`;

export function brvOn(date: string, table: BrvEntry[]): BrvEntry {
    if (!isIsoDate(date)) throw new Error(`Invalid date: ${date}`);
    const valid = table.filter(b => b.validFrom <= date).sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
    if (!valid.length) throw new Error(`No БРВ value in force on ${date}`);
    return valid[0];
}

export function computeFee(input: FeeInput, brvTable: BrvEntry[]): FeeResult {
    const { rate } = input;
    const instance = input.instance ?? 'first';
    const brv = brvOn(input.filingDate, brvTable);
    const steps: string[] = [`БРВ на ${formatRuDate(input.filingDate)} - ${fmt(brv.value)} (действует с ${formatRuDate(brv.validFrom)}).`];

    let fee: number;
    if (rate.kind === 'percent') {
        if (input.amount == null || input.amount < 0) throw new Error('Amount is required for a percent rate');
        const raw = input.amount * (rate.percent ?? 0) / 100;
        const min = (rate.minBrv ?? 0) * brv.value;
        fee = Math.max(raw, min);
        steps.push(`${rate.percent}% от ${fmt(input.amount)} = ${fmt(raw)}` + (min ? `, минимум ${rate.minBrv} БРВ = ${fmt(min)}` : '') + ` - ставка ${fmt(fee)}.`);
    } else if (rate.kind === 'fixed') {
        fee = (rate.fixedBrv ?? 0) * brv.value;
        steps.push(`Фиксированная ставка ${rate.fixedBrv} БРВ = ${fmt(fee)}.`);
    } else {
        const pages = input.pages ?? 1;
        fee = pages * (rate.percent ?? 0) / 100 * brv.value;
        steps.push(`${rate.percent}% БРВ за страницу x ${pages} стр. = ${fmt(fee)}.`);
    }

    if (instance !== 'first') {
        fee = fee * 0.5;
        steps.push(`Жалоба (${instance === 'appeal' ? 'апелляция' : instance === 'cassation' ? 'кассация' : 'ревизия'}): 50% ставки первой инстанции = ${fmt(fee)}.`);
    }

    if (input.isSme) {
        if (rate.smeDiscount) {
            fee = fee * 0.5;
            steps.push(`Субъект малого предпринимательства: 50% = ${fmt(fee)}.`);
        } else {
            steps.push('Скидка для субъекта малого предпринимательства к этой ставке не применяется.');
        }
    }

    fee = Math.round(fee);
    steps.push(`Госпошлина - ${fmt(fee)}${rate.articleRef ? ` (${rate.articleRef})` : ''}.`);
    return { fee, brv: brv.value, steps };
}

// Simplified procedure threshold (ЭПК ст. 203-2): 150 БРВ for legal entities, 100 БРВ for individual entrepreneurs.
// [проверить, к кому из сторон относится порог в ст. 203-2]
export function simplifiedProcedureLimit(filingDate: string, party: 'legal_entity' | 'entrepreneur', brvTable: BrvEntry[]) {
    const brv = brvOn(filingDate, brvTable);
    const multiplier = party === 'legal_entity' ? 150 : 100;
    return { limit: multiplier * brv.value, brv: brv.value, multiplier };
}
