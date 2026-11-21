import { Schema, model } from 'mongoose';
import { localizedSchema } from '../../utils/localized';

// Reference data used by the deterministic engines (PRD section 8). Edited in the admin panel.

// Base calculation value (БРВ), the value in force on a given date is the latest validFrom <= date
const brvValueSchema = new Schema({
    value: { type: Number, required: true, min: 1 },
    validFrom: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    source: { type: String, default: '' }
}, { timestamps: true });
export const BrvValue = model('BrvValue', brvValueSchema, 'brvValues');

// State fee rates (ЗРУ-600, annex 1, item 2)
const feeRateSchema = new Schema({
    code: { type: String, required: true, unique: true },
    name: { type: localizedSchema, default: () => ({}) },
    // percent - share of the claim amount; fixedBrv - fixed amount in БРВ; minBrv - lower bound in БРВ
    kind: { type: String, enum: ['percent', 'fixed', 'percent_brv_per_page'], required: true },
    percent: { type: Number, default: 0 },
    minBrv: { type: Number, default: 0 },
    fixedBrv: { type: Number, default: 0 },
    // 50% for small business entities (ЗРУ-600 sub-items "а"-"г" and "е")
    smeDiscount: { type: Boolean, default: false },
    articleRef: { type: String, default: '' },
    note: { type: String, default: '' }
}, { timestamps: true });
export const FeeRate = model('FeeRate', feeRateSchema, 'feeRates');

// Non-working days beyond regular weekends: holidays and Cabinet of Ministers transfers.
// type "working" marks a weekend day that was made a working day by a transfer.
const calendarDaySchema = new Schema({
    date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    type: { type: String, enum: ['holiday', 'transfer_off', 'working'], required: true },
    name: { type: localizedSchema, default: () => ({}) }
}, { timestamps: true });
export const CalendarDay = model('CalendarDay', calendarDaySchema, 'calendarDays');

const courtSchema = new Schema({
    name: { type: localizedSchema, required: true },
    level: { type: String, enum: ['district', 'regional', 'supreme'], required: true },
    region: { type: String, default: '' }
}, { timestamps: true });
export const Court = model('Court', courtSchema, 'courts');

// Procedural deadline rules (ЭПК ст. 119-124 and the stage table 8.2)
const deadlineRuleSchema = new Schema({
    code: { type: String, required: true, unique: true },
    name: { type: localizedSchema, default: () => ({}) },
    trigger: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: ['days', 'workingDays', 'months', 'years'], required: true },
    extendable: { type: Boolean, default: false },
    articleRef: { type: String, default: '' },
    procedure: { type: String, enum: ['claim', 'simplified', 'order', 'general'], default: 'claim' },
    note: { type: String, default: '' }
}, { timestamps: true });
export const DeadlineRule = model('DeadlineRule', deadlineRuleSchema, 'deadlineRules');

// Article texts for the task side panel and for verifying normRef in AI feedback
const normSchema = new Schema({
    code: { type: String, required: true },
    article: { type: String, required: true },
    title: { type: localizedSchema, default: () => ({}) },
    text: { type: localizedSchema, default: () => ({}) },
    validFrom: { type: String, default: null }
}, { timestamps: true });
normSchema.index({ code: 1, article: 1 }, { unique: true });
export const Norm = model('Norm', normSchema, 'norms');

// Bodies for the "where to apply" trainer (4.5)
const bodySchema = new Schema({
    code: { type: String, required: true, unique: true },
    name: { type: localizedSchema, required: true },
    kind: {
        type: String,
        enum: ['court', 'state_body', 'prosecutor', 'police', 'inspection', 'notary', 'ombudsman', 'mediation', 'arbitration'],
        required: true,
        index: true
    },
    level: { type: String, default: '' },
    region: { type: String, default: '' },
    competence: { type: localizedSchema, default: () => ({}) },
    // Uzbek name in Cyrillic script - searched by the autocomplete too
    nameUzCyrl: { type: String, default: '' },
    // Records imported from the open register of state functions (reestr.gov.uz)
    reestrId: { type: Number, default: null },
    reestrCategory: { type: String, default: '' },
    source: { type: String, default: '' }
}, { timestamps: true });
export const Body = model('Body', bodySchema, 'bodies');
