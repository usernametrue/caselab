// Date-only helpers on YYYY-MM-DD strings. All arithmetic runs in UTC so time zones never shift a day.

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export const parseIso = (s: string): Date => {
    if (!isIsoDate(s)) throw new Error(`Invalid date: ${s}`);
    return new Date(`${s}T00:00:00Z`);
};

export const toIso = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (s: string, n: number): string => {
    const d = parseIso(s);
    d.setUTCDate(d.getUTCDate() + n);
    return toIso(d);
};

const daysInMonth = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

// Same day number N months later; when that day does not exist - the last day of the month (31.01 + 1 month = 28/29.02)
export const addMonths = (s: string, n: number): string => {
    const d = parseIso(s);
    const day = d.getUTCDate();
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    const lastDay = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
    target.setUTCDate(Math.min(day, lastDay));
    return toIso(target);
};

export const addYears = (s: string, n: number): string => addMonths(s, n * 12);

// Whole days from a to b (b - a)
export const diffDays = (a: string, b: string): number => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);

export const weekday = (s: string): number => parseIso(s).getUTCDay();

// Calendar day in Asia/Tashkent (UTC+5, no DST) - used for streaks and "today" in tasks
export const tashkentToday = (now: Date = new Date()): string => toIso(new Date(now.getTime() + 5 * 3600 * 1000));

export const formatRuDate = (s: string): string => {
    const [y, m, d] = s.split('-');
    return `${d}.${m}.${y}`;
};
