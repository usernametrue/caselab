// Deterministic part of the review trainers (PRD 4.2, 5.2): ranges and decisions are compared by code.

export interface Range { from: number; to: number }

// Ranges of quotes in a text. A quote must occur exactly once, otherwise the markup is ambiguous.
export function locateQuotes(text: string, quotes: string[]) {
    const ranges: (Range | null)[] = [];
    const problems: { index: number; quote: string; reason: 'not_found' | 'not_unique' | 'empty' }[] = [];
    quotes.forEach((quote, index) => {
        if (!quote || !quote.trim()) {
            ranges.push(null);
            problems.push({ index, quote, reason: 'empty' });
            return;
        }
        const first = text.indexOf(quote);
        if (first < 0) {
            ranges.push(null);
            problems.push({ index, quote, reason: 'not_found' });
            return;
        }
        if (text.indexOf(quote, first + 1) >= 0) {
            ranges.push(null);
            problems.push({ index, quote, reason: 'not_unique' });
            return;
        }
        ranges.push({ from: first, to: first + quote.length });
    });
    return { ranges, problems };
}

export const overlap = (a: Range, b: Range) => Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));

// A selection hits a flaw when it covers 30% of the flaw or half of the selection lies inside it
export function hits(item: Range, flaw: Range) {
    const o = overlap(item, flaw);
    if (o <= 0) return false;
    return o / (flaw.to - flaw.from) >= 0.3 || o / (item.to - item.from) >= 0.5;
}

export interface FlawInput extends Range { id: string; badFor: string }
export interface ItemInput extends Range { }

export const isTarget = (badFor: string, clientSide: string) => badFor === 'both' || badFor === clientSide;

export interface ReviewMatch {
    targets: string[];
    found: { flawId: string; itemIndex: number }[];
    missed: string[];
    // Selections that hit no flaw - the AI decides whether each one is a justified extra finding
    extras: number[];
    // Selections that "fix" a clause which is favourable for the client (dangerous only for the other side)
    againstClient: { flawId: string; itemIndex: number }[];
}

export function matchReview(flaws: FlawInput[], clientSide: string, items: ItemInput[]): ReviewMatch {
    const targets = flaws.filter(f => isTarget(f.badFor, clientSide));
    const others = flaws.filter(f => !isTarget(f.badFor, clientSide));
    const usedItems = new Set<number>();
    const found: ReviewMatch['found'] = [];

    // Each flaw takes the selection with the largest overlap among those still free
    for (const f of targets) {
        let best = -1;
        let bestOverlap = 0;
        items.forEach((it, i) => {
            if (usedItems.has(i) || !hits(it, f)) return;
            const o = overlap(it, f);
            if (o > bestOverlap) { best = i; bestOverlap = o; }
        });
        if (best >= 0) {
            usedItems.add(best);
            found.push({ flawId: f.id, itemIndex: best });
        }
    }

    const againstClient: ReviewMatch['againstClient'] = [];
    const extras: number[] = [];
    items.forEach((it, i) => {
        if (usedItems.has(i)) return;
        // A second selection on an already found flaw is neither an extra nor an error
        if (targets.some(f => hits(it, f))) return;
        const other = others.find(f => hits(it, f));
        if (other) againstClient.push({ flawId: other.id, itemIndex: i });
        else extras.push(i);
    });

    const foundIds = new Set(found.map(x => x.flawId));
    return {
        targets: targets.map(f => f.id),
        found,
        missed: targets.filter(f => !foundIds.has(f.id)).map(f => f.id),
        extras,
        againstClient
    };
}

// Completeness from the markup: found share plus half credit for extras the AI judged justified,
// accuracy penalty: 10 points per unjustified extra, 20 per edit against the client
export function reviewScores(m: ReviewMatch, justifiedExtras: number) {
    const total = m.targets.length;
    const unjustified = Math.max(0, m.extras.length - justifiedExtras);
    const completeness = total
        ? Math.min(100, Math.round(100 * (m.found.length + 0.5 * justifiedExtras) / total))
        : (unjustified ? 70 : 100);
    const accuracyCap = Math.max(0, 100 - 10 * unjustified - 20 * m.againstClient.length);
    return { completeness, accuracyCap, unjustified };
}

// ---------- review_fix_check ----------

export interface EditInput { id: string; badFor: string }
export interface DecisionInput { editId: string; decision: 'accept' | 'reject'; reason: string; counter?: string }

// A harmful edit must be rejected, a harmless one accepted; a decision without a reason does not count (PRD 4.2)
export function checkDecisions(edits: EditInput[], clientSide: string, decisions: DecisionInput[]) {
    const results = edits.map(e => {
        const d = decisions.find(x => x.editId === e.id);
        const harmful = isTarget(e.badFor, clientSide);
        const expected: 'accept' | 'reject' = harmful ? 'reject' : 'accept';
        const reasoned = Boolean(d && d.reason && d.reason.trim().length >= 10);
        return {
            editId: e.id,
            expected,
            decision: d?.decision ?? null,
            reasoned,
            ok: Boolean(d && d.decision === expected && reasoned),
            needsCounter: harmful,
            hasCounter: Boolean(d?.counter && d.counter.trim().length >= 5)
        };
    });
    const score = edits.length ? Math.round(100 * results.filter(r => r.ok).length / edits.length) : 100;
    return { score, results };
}

// ---------- review_court_act: dates and sums in the correction must match exactly (PRD 4.3) ----------

const digits = (s: string) => s.replace(/[\s\u00a0]/g, '');

// Dates as YYYY-MM-DD or DD.MM.YYYY, money as digits with any spaces; both are compared after normalization
export function containsValue(text: string, kind: string, value: string) {
    if (!value) return true;
    if (kind === 'money') {
        const want = digits(value).replace(/[^\d,.]/g, '');
        // Groups of three digits may be split by single spaces; other numbers next to the sum stay separate
        const found = (text.match(/\d{1,3}(?:[\s\u00a0]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) ?? []).map(m => digits(m));
        return found.includes(want);
    }
    if (kind === 'date') {
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.split('.').reverse().join('-');
        const [y, m, d] = iso.split('-');
        return text.includes(iso) || text.includes(`${d}.${m}.${y}`);
    }
    return true;
}
