import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDeadline } from '../src/modules/legal/engines/deadline-engine';
import { computeFee, simplifiedProcedureLimit } from '../src/modules/legal/engines/fee-engine';
import { addMonths } from '../src/modules/legal/engines/dates';

// БРВ values from PRD 8.4
const BRV = [
    { value: 412000, validFrom: '2025-08-01' },
    { value: 440000, validFrom: '2026-09-01' }
];
const PROPERTY = { code: 'property', kind: 'percent' as const, percent: 2, minBrv: 1, smeDiscount: true };

test('fee: PRD 8.4 example - 50 000 000 sum claim, not SME, filed 10.11.2026', () => {
    const r = computeFee({ rate: PROPERTY, filingDate: '2026-11-10', amount: 50_000_000 }, BRV);
    assert.equal(r.brv, 440000);
    assert.equal(r.fee, 1_000_000);
});

test('fee: appeal on the full amount is 50% - 500 000 sum', () => {
    const r = computeFee({ rate: PROPERTY, filingDate: '2026-11-10', amount: 50_000_000, instance: 'appeal' }, BRV);
    assert.equal(r.fee, 500_000);
});

test('fee: SME first instance is 50% - 500 000 sum', () => {
    const r = computeFee({ rate: PROPERTY, filingDate: '2026-11-10', amount: 50_000_000, isSme: true }, BRV);
    assert.equal(r.fee, 500_000);
});

test('fee: minimum of 1 БРВ applies to small claims, БРВ taken on the filing date', () => {
    assert.equal(computeFee({ rate: PROPERTY, filingDate: '2026-11-10', amount: 1_000_000 }, BRV).fee, 440_000);
    assert.equal(computeFee({ rate: PROPERTY, filingDate: '2026-08-31', amount: 1_000_000 }, BRV).fee, 412_000);
});

test('fee: non-property claim is 10 БРВ', () => {
    const r = computeFee({ rate: { code: 'non_property', kind: 'fixed', fixedBrv: 10 }, filingDate: '2026-11-10' }, BRV);
    assert.equal(r.fee, 4_400_000);
});

test('simplified procedure limits on 10.11.2026 - 66 000 000 and 44 000 000 sum', () => {
    assert.equal(simplifiedProcedureLimit('2026-11-10', 'legal_entity', BRV).limit, 66_000_000);
    assert.equal(simplifiedProcedureLimit('2026-11-10', 'entrepreneur', BRV).limit, 44_000_000);
});

test('dates: 31.01 + 1 month = last day of February', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
});

test('deadline: 5 days from Monday 02.11.2026 ends Saturday, moved to Monday 09.11.2026', () => {
    const r = computeDeadline('2026-11-02', { amount: 5, unit: 'days' });
    assert.equal(r.endDate, '2026-11-09');
});

test('deadline: 1 month appeal term from 08.11.2026 lands on 08.12.2026 holiday and moves to 09.12.2026', () => {
    const r = computeDeadline('2026-11-08', { amount: 1, unit: 'months' }, {
        calendar: [{ date: '2026-12-08', type: 'holiday' }]
    });
    assert.equal(r.endDate, '2026-12-09');
});

test('deadline: working days skip weekends and holidays', () => {
    // Fri 27.02.2026 + 5 working days: Mon 2, Tue 3, Wed 4, Thu 5, Fri 6 March
    const r = computeDeadline('2026-02-27', { amount: 5, unit: 'workingDays' });
    assert.equal(r.endDate, '2026-03-06');
});

test('deadline: suspension inside the term shifts the end', () => {
    const r = computeDeadline('2026-11-02', { amount: 20, unit: 'days' }, {
        suspensions: [{ from: '2026-11-10', to: '2026-11-14' }]
    });
    // 22.11.2026 + 5 days = 27.11.2026 (Friday)
    assert.equal(r.endDate, '2026-11-27');
});

test('deadline: extension only for extendable rules', () => {
    assert.equal(computeDeadline('2026-11-02', { amount: 20, unit: 'days' }, { extensionDays: 10 }).endDate, '2026-11-23');
    assert.equal(computeDeadline('2026-11-02', { amount: 20, unit: 'days', extendable: true }, { extensionDays: 10 }).endDate, '2026-12-02');
});
