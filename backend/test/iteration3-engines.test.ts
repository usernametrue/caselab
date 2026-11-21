import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRoute } from '../src/modules/route/route-engine';
import { scoreMines, splitPhrases } from '../src/modules/review/mines-engine';
import { scorePath, validateScenario, publicNode } from '../src/modules/sim/sim-engine';
import { containsValue } from '../src/modules/review/review-engine';
import { mapRegisterOrgs } from '../src/modules/legal/bodies-import';
import { REGISTER_ORGS } from '../src/seed/reestr-organizations';
import { weekStart } from '../src/modules/gamification/leaderboard.routes';

test('route: optimal, acceptable, skipped pre-trial step, wrong body, order', () => {
    const routes = [
        { score: 100, steps: [{ bodyCode: 'claim', pretrial: true }, { bodyCode: 'court' }] },
        { score: 70, steps: [{ bodyCode: 'inspection' }, { bodyCode: 'court' }] }
    ];
    assert.deepEqual(
        (({ score, optimal, routeIndex }) => ({ score, optimal, routeIndex }))(checkRoute(routes, ['claim', 'court'])!),
        { score: 100, optimal: true, routeIndex: 0 }
    );
    const acceptable = checkRoute(routes, ['inspection', 'court'])!;
    assert.equal(acceptable.score, 70);
    assert.equal(acceptable.optimal, false);
    const skipped = checkRoute(routes, ['court'])!;
    assert.equal(skipped.score, 70, 'optimal route minus 30 for the skipped claim');
    assert.deepEqual(skipped.missingPretrial, ['claim']);
    const reversed = checkRoute(routes, ['court', 'claim'])!;
    assert.equal(reversed.score, 85, 'order penalty 15');
    const wrong = checkRoute(routes, ['prosecutor'])!;
    assert.equal(wrong.score, 0);
    assert.deepEqual(wrong.wrongBodies, ['prosecutor']);
    assert.equal(checkRoute([], ['x']), null);
});

test('mines: phrases, found, missed, false clicks, options, clean run', () => {
    const text = 'Цена 1 000,50 сум. Поставщик вправе менять цену, без согласия покупателя; Споры - по месту поставщика.\nПрочее.';
    const segs = splitPhrases(text);
    const words = segs.map(s => text.slice(s.from, s.to));
    assert.deepEqual(words, ['Цена 1 000,50 сум.', 'Поставщик вправе менять цену,', 'без согласия покупателя;', 'Споры - по месту поставщика.', 'Прочее.']);
    // Clause numbers and abbreviations do not split a phrase
    const numbered = '1. Поставщик вправе менять цену по ст. 333 ГК. 2.1. Иное.';
    assert.deepEqual(splitPhrases(numbered).map(s => numbered.slice(s.from, s.to)), ['1. Поставщик вправе менять цену по ст. 333 ГК.', '2.1. Иное.']);
    const q1 = 'вправе менять цену';
    const q2 = 'по месту поставщика';
    const mines = [
        { id: 'm1', from: text.indexOf(q1), to: text.indexOf(q1) + q1.length, options: [{ text: 'по соглашению', correct: true }, { text: 'по решению поставщика', correct: false }, { text: 'всегда', correct: false }] },
        { id: 'm2', from: text.indexOf(q2), to: text.indexOf(q2) + q2.length, options: [] }
    ];
    const clicks = [{ segment: 1, mine: true }, { segment: 0, mine: false }, { segment: 3, mine: true }];
    const items = [{ segment: 1, replacement: '', danger: 'односторонне', optionIndex: 1 }, { segment: 3, replacement: 'по месту ответчика', danger: 'неудобно' }];
    const r = scoreMines(mines, segs, clicks, items, true);
    assert.equal(r.score, 100);
    assert.equal(r.falseClicks, 1);
    assert.deepEqual(r.optionResults, [{ mineId: 'm1', ok: false }]);
    assert.equal(r.accuracyCap, 0, 'wrong option on the only mine with options, minus a false click');
    assert.equal(r.clean, false);
    const clean = scoreMines(mines, segs, [{ segment: 1, mine: true }, { segment: 3, mine: true }], [{ ...items[0], optionIndex: 0 }, items[1]], true);
    assert.equal(clean.clean, true);
    assert.equal(clean.accuracyCap, 100);
    const half = scoreMines(mines, segs, [{ segment: 1, mine: true }], [{ segment: 1, replacement: 'x', danger: 'y' }], false);
    assert.equal(half.score, 50);
    assert.deepEqual(half.missed, ['m2']);
});

const scenario = {
    startNodeId: 'n1',
    roles: [{ key: 'plaintiff', name: 'Истец' }],
    nodes: [
        { id: 'n1', stage: 'Подготовка', speaker: 'Судья', text: 'Ходатайства?', freeTextRubric: '', outcome: '', choices: [
            { id: 'a', text: 'Ходатайство об экспертизе', next: 'n2', verdict: 'correct', explanation: 'верно', normRef: 'ст. 82 ЭПК' },
            { id: 'b', text: 'Молчать', next: 'n3', verdict: 'wrong', explanation: 'упущено', normRef: '' }
        ] },
        { id: 'n2', stage: 'Прения', speaker: 'Судья', text: 'Ваша позиция?', freeTextRubric: 'Сослаться на заключение', outcome: '', choices: [
            { id: 'c', text: 'Сослаться на экспертизу', next: 'n4', verdict: 'acceptable', explanation: '', normRef: '' }
        ] },
        { id: 'n3', stage: 'Решение', speaker: 'Судья', text: 'Отказать', freeTextRubric: '', outcome: 'loss', choices: [] },
        { id: 'n4', stage: 'Решение', speaker: 'Судья', text: 'Удовлетворить', freeTextRubric: '', outcome: 'win', choices: [] }
    ]
};

test('simulation: validation, public node without verdicts, path score', () => {
    assert.deepEqual(validateScenario(scenario), []);
    const broken = { ...scenario, nodes: [...scenario.nodes.slice(0, 3), { ...scenario.nodes[3], outcome: '' }, { id: 'lost', stage: '', speaker: '', text: 'x', freeTextRubric: '', outcome: 'win', choices: [] }] };
    const problems = validateScenario(broken);
    assert.ok(problems.some(p => p.includes('needs an outcome')));
    assert.ok(problems.some(p => p.includes('cannot be reached')));
    const cyclic = { ...scenario, nodes: scenario.nodes.map(n => (n.id === 'n2' ? { ...n, choices: [{ ...n.choices[0], next: 'n1' }] } : n)) };
    assert.ok(validateScenario(cyclic).some(p => p.includes('cycle')));
    const pub = JSON.stringify(publicNode(scenario.nodes[0]));
    assert.equal(pub.includes('correct'), false);
    assert.equal(pub.includes('n2'), false);
    const r = scorePath(scenario, [{ nodeId: 'n1', choiceId: 'a' }, { nodeId: 'n2', choiceId: 'c', justification: 'эксперт подтвердил' }], 'n4');
    assert.equal(r.score, 80);
    assert.equal(r.outcome, 'win');
    assert.equal(r.steps[1].keyNode, true);
});

test('court act values: dates and sums are compared exactly', () => {
    assert.equal(containsValue('взыскать 1 650 000 сум госпошлины', 'money', '1650000'), true);
    assert.equal(containsValue('взыскать 1650000 сум', 'money', '1 650 000'), true);
    assert.equal(containsValue('от 12.03.2026 взыскать 1 600 000', 'money', '1650000'), false);
    assert.equal(containsValue('2026 1 650 000', 'money', '1650000'), true, 'a year next to the sum stays separate');
    assert.equal(containsValue('вступает в силу 15.03.2026', 'date', '2026-03-15'), true);
    assert.equal(containsValue('вступает в силу 16.03.2026', 'date', '2026-03-15'), false);
});

test('register bodies: institutions skipped, kinds guessed, duplicates merged', () => {
    const rows = mapRegisterOrgs(REGISTER_ORGS);
    assert.ok(rows.length > 150 && rows.length < REGISTER_ORGS.length);
    const byRu = (s: string) => rows.find(r => r.name.ru === s);
    assert.equal(byRu('Верховный суд Республики Узбекистан')?.kind, 'court');
    assert.equal(byRu('Генеральная прокуратура Республики Узбекистан')?.kind, 'prosecutor');
    assert.equal(byRu('Территориальные органы внутренних дел')?.kind, 'police');
    assert.equal(byRu('Бизнес омбусман')?.kind, 'ombudsman', 'found by the Uzbek name');
    assert.equal(byRu('Инспекция транспортного контроля')?.kind, 'inspection');
    assert.equal(rows.some(r => r.name.ru === 'Ташкентский государственный юридический университет'), false, 'state institutions are skipped');
    assert.equal(rows.filter(r => r.name.ru === 'Совет Министров Республики Каракалпакстан').length, 1);
    assert.equal(new Set(rows.map(r => r.code)).size, rows.length);
});

test('leaderboard week starts on Monday 00:00 in Tashkent', () => {
    assert.equal(weekStart('2026-11-21').toISOString(), '2026-11-15T19:00:00.000Z');
    assert.equal(weekStart('2026-11-16').toISOString(), '2026-11-15T19:00:00.000Z');
    assert.equal(weekStart('2026-11-15').toISOString(), '2026-11-08T19:00:00.000Z');
});
