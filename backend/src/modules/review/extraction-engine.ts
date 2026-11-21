// Deterministic part of the extraction of terms (PRD 4.8 extraction_compare): the student's table is compared
// with the author's reference cell by cell. Dates, sums and yes/no are compared exactly; text terms the code
// cannot match go to the AI, which judges the meaning only.
import { overlap, type Range } from './review-engine';

export type ExtractionKind = 'text' | 'date' | 'money' | 'bool';

export interface RefCell {
    documentId: string;
    fieldKey: string;
    kind: ExtractionKind;
    value: string;
    absent: boolean;
    quote: string;
    // Range of the reference quote in the document, null when the author gave no quote
    range: Range | null;
}

export interface StudentCell {
    documentId: string;
    fieldKey: string;
    value: string;
    absent: boolean;
    quote: string;
    from: number | null;
    to: number | null;
}

export type CellStatus = 'correct' | 'partial' | 'wrong' | 'empty';
export type AiVerdict = 'match' | 'partial' | 'mismatch';

const normalizeText = (s: string) => s.toLowerCase().replace(/[«»"'`ʻʼ’.,;:()]/g, ' ').replace(/\s+/g, ' ').trim();

// One canonical form per kind, so "1 500 000 сум" and "1500000" are the same sum
export function normalizeValue(kind: ExtractionKind, v: string): string {
    const s = (v ?? '').trim();
    if (!s) return '';
    if (kind === 'money') return s.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '');
    if (kind === 'bool') return /^(yes|да|ha|true|1)$/i.test(s) ? 'yes' : /^(no|нет|yo'q|yoq|false|0)$/i.test(s) ? 'no' : s.toLowerCase();
    if (kind === 'date') return s;
    return normalizeText(s);
}

export function validValue(kind: ExtractionKind, v: string): boolean {
    if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (kind === 'money') return /^\d[\d\s]*$/.test(v.trim());
    if (kind === 'bool') return v === 'yes' || v === 'no';
    return v.trim().length > 0;
}

// Text terms the code accepts without the AI: equal, or one contains the other and the shorter is not trivial
function textMatches(a: string, b: string) {
    if (!a || !b) return false;
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 4 && short.length / long.length >= 0.5 && long.includes(short);
}

export const cellKey = (documentId: string, fieldKey: string) => `${documentId}|${fieldKey}`;

// First pass by code: what is decided, and which text cells the AI must judge
export function compareCells(reference: RefCell[], answer: StudentCell[]) {
    const byKey = new Map(answer.map(c => [cellKey(c.documentId, c.fieldKey), c]));
    return reference.map((ref, index) => {
        const st = byKey.get(cellKey(ref.documentId, ref.fieldKey));
        const value = st ? normalizeValue(ref.kind, st.value) : '';
        const answered = Boolean(st && (st.absent || value));
        // The source must lie in the reference fragment; without a reference quote any real fragment counts
        const studentRange = st && st.from != null && st.to != null && st.to > st.from ? { from: st.from, to: st.to } : null;
        const sourceOk = Boolean(studentRange && (!ref.range || overlap(studentRange, ref.range) > 0));
        let status: CellStatus | 'ai';
        if (!answered) status = 'empty';
        else if (ref.absent || st!.absent) status = ref.absent && st!.absent ? 'correct' : 'wrong';
        else if (ref.kind === 'text') status = textMatches(normalizeValue('text', ref.value), value) ? 'correct' : 'ai';
        else status = normalizeValue(ref.kind, ref.value) === value ? 'correct' : 'wrong';
        return {
            index, documentId: ref.documentId, fieldKey: ref.fieldKey, kind: ref.kind, status,
            actual: st ? (st.absent ? null : st.value) : null, actualAbsent: Boolean(st?.absent),
            // "Not in the document" needs no source
            sourceOk: ref.absent && st?.absent ? true : sourceOk,
            needsSource: !(ref.absent && st?.absent)
        };
    });
}

// Final pass after the AI verdicts on text cells
export function scoreExtraction(cells: ReturnType<typeof compareCells>, verdicts: Map<number, AiVerdict>) {
    const final = cells.map(c => {
        if (c.status !== 'ai') return { ...c, status: c.status as CellStatus };
        const v = verdicts.get(c.index);
        return { ...c, status: (v === 'match' ? 'correct' : v === 'partial' ? 'partial' : 'wrong') as CellStatus };
    });
    const total = final.length || 1;
    const correct = final.filter(c => c.status === 'correct').length;
    const partial = final.filter(c => c.status === 'partial').length;
    const answered = final.filter(c => c.status !== 'empty');
    const needSource = answered.filter(c => c.needsSource);
    const withSource = needSource.filter(c => c.sourceOk).length;
    return {
        kind: 'extraction',
        score: Math.round(100 * (correct + 0.5 * partial) / total),
        total: final.length,
        correct,
        partial,
        wrong: final.filter(c => c.status === 'wrong').length,
        empty: final.filter(c => c.status === 'empty').length,
        // A value without its source in the document gives 0 for reasoning on that cell (PRD 4.0)
        reasoningCap: needSource.length ? Math.round(100 * withSource / needSource.length) : (answered.length ? 100 : 0),
        completenessCap: Math.round(100 * answered.length / total),
        cells: final
    };
}
