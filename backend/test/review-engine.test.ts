import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDecisions, locateQuotes, matchReview, reviewScores } from '../src/modules/review/review-engine';

const TEXT = 'Подрядчик вправе в одностороннем порядке изменить цену. Заказчик оплачивает работы в течение 5 дней. Неустойка подрядчика составляет 0,01%.';

test('locateQuotes: ranges for unique quotes, problems for missing and repeated ones', () => {
    const { ranges, problems } = locateQuotes(TEXT, ['изменить цену', 'нет такого текста', 'подрядчик']);
    assert.deepEqual(ranges[0], { from: TEXT.indexOf('изменить цену'), to: TEXT.indexOf('изменить цену') + 'изменить цену'.length });
    assert.equal(problems.find(p => p.index === 1)?.reason, 'not_found');
    // "подрядчик" (lowercase) occurs once - inside "Неустойка подрядчика"; capitalized one differs
    assert.equal(ranges[2]?.from, TEXT.indexOf('подрядчика'));
    assert.equal(locateQuotes('aa aa', ['aa']).problems[0].reason, 'not_unique');
});

const range = (q: string) => ({ from: TEXT.indexOf(q), to: TEXT.indexOf(q) + q.length });
const FLAWS = [
    { id: 'price', badFor: 'customer', ...range('в одностороннем порядке изменить цену') },
    { id: 'penalty', badFor: 'customer', ...range('0,01%') },
    // Short payment term is dangerous for the customer's counterparty only
    { id: 'term', badFor: 'contractor', ...range('в течение 5 дней') }
];

test('matchReview: found, missed, extra and against-client selections for the customer side', () => {
    const items = [
        range('одностороннем порядке'),      // hits "price"
        range('Заказчик оплачивает'),         // extra
        range('в течение 5 дней')            // favourable for the customer - fixing it hurts the client
    ];
    const m = matchReview(FLAWS, 'customer', items);
    assert.deepEqual(m.targets, ['price', 'penalty']);
    assert.deepEqual(m.found, [{ flawId: 'price', itemIndex: 0 }]);
    assert.deepEqual(m.missed, ['penalty']);
    assert.deepEqual(m.extras, [1]);
    assert.deepEqual(m.againstClient, [{ flawId: 'term', itemIndex: 2 }]);

    const s = reviewScores(m, 1);
    assert.equal(s.completeness, 75);   // (1 + 0.5) / 2
    assert.equal(s.accuracyCap, 80);    // one edit against the client
});

test('matchReview: the same document gives a different task for the other party', () => {
    const m = matchReview(FLAWS, 'contractor', [range('в течение 5 дней')]);
    assert.deepEqual(m.targets, ['term']);
    assert.deepEqual(m.found, [{ flawId: 'term', itemIndex: 0 }]);
});

test('checkDecisions: harmful edits rejected with reasons count, unreasoned decisions do not', () => {
    const edits = [{ id: 'e1', badFor: 'customer' }, { id: 'e2', badFor: 'none' }, { id: 'e3', badFor: 'customer' }];
    const r = checkDecisions(edits, 'customer', [
        { editId: 'e1', decision: 'reject', reason: 'Снимает ответственность подрядчика', counter: 'Оставить неустойку 0,5%' },
        { editId: 'e2', decision: 'accept', reason: 'Уточнение реквизитов, риска нет' },
        { editId: 'e3', decision: 'reject', reason: 'плохо' }
    ]);
    assert.deepEqual(r.results.map(x => x.ok), [true, true, false]);
    assert.equal(r.score, 67);
});
