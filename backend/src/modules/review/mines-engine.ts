import { hits, type Range } from './review-engine';

// "Mines" (PRD 4.7): the text is split into phrases the student clicks; a click on a phrase that holds no mine costs points.

// Phrases end at . ; ! ? : and line breaks, and at a comma followed by a space (so "0,1%" stays whole).
// A dot is not an end after clause numbering ("1.", "2.1."), before a lowercase word ("т. е.") or in "ст. 333".
// Leading and trailing spaces are not part of a phrase.
export function splitPhrases(text: string): Range[] {
    const nextVisible = (i: number) => {
        let j = i + 1;
        while (j < text.length && text[j] !== '\n' && /\s/.test(text[j])) j++;
        return text[j] ?? '';
    };
    const endsSentence = (i: number) => {
        if (text[i] !== '.') return true;
        if (/^[\d.]+$/.test(text.slice(start, i + 1).trim())) return false;
        const next = nextVisible(i);
        if (/\p{Ll}/u.test(next)) return false;
        // "ст. 333", "п. 2": a short lowercase abbreviation before a number
        const word = /(\p{L}+)\.$/u.exec(text.slice(start, i + 1))?.[1] ?? '';
        return !(/\d/.test(next) && word.length > 0 && word.length <= 4 && word === word.toLowerCase());
    };
    const out: Range[] = [];
    let start = 0;
    const push = (end: number) => {
        let a = start;
        let b = end;
        while (a < b && /\s/.test(text[a])) a++;
        while (b > a && /\s/.test(text[b - 1])) b--;
        if (b > a) out.push({ from: a, to: b });
        start = end;
    };
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '\n') push(i + 1);
        else if ('.;!?:'.includes(ch) && (i + 1 >= text.length || /\s/.test(text[i + 1])) && endsSentence(i)) push(i + 1);
        else if (ch === ',' && /\s/.test(text[i + 1] ?? '')) push(i + 1);
    }
    push(text.length);
    return out;
}

// A phrase holds a mine when it hits the mine by the review overlap rule
export const mineOfSegment = <T extends Range & { id: string }>(segment: Range, mines: T[]): T | null => mines.find(m => hits(segment, m)) ?? null;

const FALSE_CLICK_PENALTY = 15;

export interface MineItem { segment: number; replacement: string; danger: string; optionIndex?: number | null }

export function scoreMines(
    mines: (Range & { id: string; options?: { text: string; correct: boolean }[] })[],
    segments: Range[],
    clicks: { segment: number; mine: boolean }[],
    items: MineItem[],
    simplified: boolean
) {
    const foundIds = new Set<string>();
    const itemByMine = new Map<string, number>();
    items.forEach((it, index) => {
        const m = segments[it.segment] ? mineOfSegment(segments[it.segment], mines) : null;
        if (m && !itemByMine.has(m.id)) itemByMine.set(m.id, index);
    });
    for (const c of clicks) {
        const m = c.mine && segments[c.segment] ? mineOfSegment(segments[c.segment], mines) : null;
        if (m) foundIds.add(m.id);
    }
    const falseClicks = clicks.filter(c => !c.mine).length;
    // A found mine counts once the student wrote (or chose) what to put instead
    const handled = mines.filter(m => foundIds.has(m.id) && itemByMine.has(m.id));
    const optionResults = simplified
        ? handled.filter(m => (m.options ?? []).length).map(m => {
            const it = items[itemByMine.get(m.id)!];
            const opt = it.optionIndex != null ? m.options![it.optionIndex] : undefined;
            return { mineId: m.id, ok: Boolean(opt?.correct) };
        })
        : [];
    const completeness = mines.length ? Math.round(100 * handled.length / mines.length) : (falseClicks ? 70 : 100);
    const optionsOk = optionResults.length ? optionResults.filter(r => r.ok).length / optionResults.length : 1;
    const accuracyCap = Math.max(0, Math.round(100 * optionsOk) - FALSE_CLICK_PENALTY * falseClicks);
    return {
        kind: 'mines',
        score: completeness,
        total: mines.length,
        found: [...foundIds],
        handled: handled.map(m => ({ mineId: m.id, itemIndex: itemByMine.get(m.id)! })),
        missed: mines.filter(m => !foundIds.has(m.id)).map(m => m.id),
        falseClicks,
        optionResults,
        accuracyCap,
        // Sapper (PRD 7.4): every mine found without a false click
        clean: mines.length > 0 && handled.length === mines.length && falseClicks === 0
    };
}
