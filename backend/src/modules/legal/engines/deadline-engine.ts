import { addDays, addMonths, addYears, diffDays, formatRuDate, isIsoDate, weekday } from './dates';

// Deadline engine - ЭПК РУз ст. 119-124 as described in PRD 8.3

export type DeadlineUnit = 'days' | 'workingDays' | 'months' | 'years';

export interface DeadlineRuleInput {
    code?: string;
    amount: number;
    unit: DeadlineUnit;
    extendable?: boolean;
    articleRef?: string;
}

export interface CalendarEntry {
    date: string;
    type: 'holiday' | 'transfer_off' | 'working';
}

export interface DeadlineContext {
    calendar?: CalendarEntry[];
    // Weekday numbers treated as days off, 0 = Sunday. Courts: Saturday and Sunday [проверить режим]
    weekendDays?: number[];
    suspensions?: { from: string; to: string }[];
    // Extension in days, only for extendable rules
    extensionDays?: number;
}

export interface DeadlineResult {
    endDate: string;
    steps: string[];
}

export const DEFAULT_WEEKEND = [0, 6];

export function makeIsWorkingDay(ctx: DeadlineContext) {
    const weekend = ctx.weekendDays ?? DEFAULT_WEEKEND;
    const off = new Set<string>();
    const working = new Set<string>();
    for (const c of ctx.calendar ?? []) {
        if (c.type === 'working') working.add(c.date);
        else off.add(c.date);
    }
    return (date: string) => {
        if (working.has(date)) return true;
        if (off.has(date)) return false;
        return !weekend.includes(weekday(date));
    };
}

export function computeDeadline(eventDate: string, rule: DeadlineRuleInput, ctx: DeadlineContext = {}): DeadlineResult {
    if (!isIsoDate(eventDate)) throw new Error(`Invalid event date: ${eventDate}`);
    if (!Number.isInteger(rule.amount) || rule.amount < 0) throw new Error('Rule amount must be a non-negative integer');

    const isWorking = makeIsWorkingDay(ctx);
    const steps: string[] = [];
    const ref = rule.articleRef ? ` (${rule.articleRef})` : '';
    steps.push(`Событие ${formatRuDate(eventDate)}, течение срока начинается на следующий день${ref}.`);

    let end: string;
    switch (rule.unit) {
        case 'days':
            end = addDays(eventDate, rule.amount);
            steps.push(`${rule.amount} календарных дн.: ${formatRuDate(eventDate)} + ${rule.amount} = ${formatRuDate(end)}.`);
            break;
        case 'workingDays': {
            let cursor = eventDate;
            let counted = 0;
            while (counted < rule.amount) {
                cursor = addDays(cursor, 1);
                if (isWorking(cursor)) counted++;
            }
            end = cursor;
            steps.push(`${rule.amount} рабочих дн. без выходных и праздников - последний день ${formatRuDate(end)}.`);
            break;
        }
        case 'months':
            end = addMonths(eventDate, rule.amount);
            steps.push(`${rule.amount} мес.: то же число через ${rule.amount} мес. (если числа нет - последний день месяца) = ${formatRuDate(end)}.`);
            break;
        case 'years':
            end = addYears(eventDate, rule.amount);
            steps.push(`${rule.amount} г.: те же месяц и число = ${formatRuDate(end)}.`);
            break;
        default:
            throw new Error(`Unknown unit: ${(rule as any).unit}`);
    }

    // Suspension shifts the end by the number of suspended days that fall inside the running term
    for (const s of ctx.suspensions ?? []) {
        if (!isIsoDate(s.from) || !isIsoDate(s.to) || s.to < s.from) continue;
        const from = s.from > eventDate ? s.from : addDays(eventDate, 1);
        const to = s.to < end ? s.to : end;
        if (to < from) continue;
        const days = diffDays(from, to) + 1;
        end = addDays(end, days);
        steps.push(`Приостановление ${formatRuDate(s.from)}-${formatRuDate(s.to)}: +${days} дн., окончание ${formatRuDate(end)}.`);
    }

    if (ctx.extensionDays && ctx.extensionDays > 0) {
        if (rule.extendable) {
            end = addDays(end, ctx.extensionDays);
            steps.push(`Продление на ${ctx.extensionDays} дн.: ${formatRuDate(end)}.`);
        } else {
            steps.push('Продление не применяется: срок не продлевается.');
        }
    }

    if (!isWorking(end)) {
        let moved = end;
        while (!isWorking(moved)) moved = addDays(moved, 1);
        steps.push(`${formatRuDate(end)} - нерабочий день, окончание переносится на ${formatRuDate(moved)}.`);
        end = moved;
    }

    steps.push(`Последний день срока - ${formatRuDate(end)} до 24:00 (действие в суде - до окончания рабочего дня).`);
    return { endDate: end, steps };
}
