import { Schema, model, Types, InferSchemaType, HydratedDocument } from 'mongoose';
import { localizedSchema } from '../../utils/localized';

// Skill map: branch -> topic -> skill (PRD 6.1)
const skillSchema = new Schema({
    key: { type: String, required: true, unique: true },
    parentKey: { type: String, default: null },
    branch: { type: String, default: 'economic' },
    name: { type: localizedSchema, required: true }
}, { timestamps: true });
export const Skill = model('Skill', skillSchema, 'skills');

export const MODES = ['draft', 'review', 'process', 'route', 'sim'] as const;
export type Mode = typeof MODES[number];

// Task types implemented so far; the rest of PRD section 4 is added trainer by trainer
export const TASK_TYPES = [
    'draft_full', 'draft_part', 'review_contract', 'review_fix_check', 'review_court_act', 'review_admin_act', 'mines',
    'proc_next_step', 'proc_timeline', 'proc_draft', 'route_and_apply', 'sim_branching', 'extraction_compare', 'sim_hearing'
] as const;
export type TaskType = typeof TASK_TYPES[number];

export const modeOfTaskType = (taskType: string): Mode => {
    if (taskType.startsWith('draft')) return 'draft';
    // "Mines" are scored with the analysis weights (PRD 5.1)
    // The extraction of terms (4.8) too
    if (taskType.startsWith('review') || taskType === 'mines' || taskType === 'extraction_compare') return 'review';
    if (taskType.startsWith('proc')) return 'process';
    if (taskType.startsWith('route')) return 'route';
    return 'sim';
};

// A variable whose value code picks when an instance is generated: {{key}} in the case text
const variableSchema = new Schema({
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9_]*$/ },
    kind: { type: String, enum: ['money', 'date', 'choice'], required: true },
    label: { type: String, default: '' },
    // money: min/max/step in sum; date: min/max offset in days from the task's "today"
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
    step: { type: Number, default: 1 },
    // choice: one option is picked, each option is localized
    options: [{ type: localizedSchema }]
}, { _id: false });

const scaffoldSectionSchema = new Schema({
    title: { type: localizedSchema, required: true },
    hint: { type: localizedSchema, default: () => ({}) }
}, { _id: false });

const timelineEventSchema = new Schema({
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9_]*$/ },
    title: { type: localizedSchema, required: true },
    // A fixed date or a date variable of the template
    date: { type: String, default: '' },
    dateVar: { type: String, default: '' },
    text: { type: localizedSchema, default: () => ({}) }
}, { _id: false });

const timelineCheckSchema = new Schema({
    key: { type: String, required: true },
    label: { type: localizedSchema, default: () => ({}) },
    fromEventKey: { type: String, required: true },
    ruleCode: { type: String, required: true },
    // The event that had to happen by the end of the deadline; later = a violation
    toEventKey: { type: String, default: '' },
    extensionDays: { type: Number, default: 0 }
}, { _id: false });

const routeStepSchema = new Schema({
    bodyCode: { type: String, required: true },
    basis: { type: String, default: '' },
    deadline: { type: localizedSchema, default: () => ({}) },
    // Mandatory pre-trial step: claim, mediation by clause, administrative appeal
    pretrial: { type: Boolean, default: false }
}, { _id: false });

const acceptableRouteSchema = new Schema({
    // 100 - optimal, 70 - acceptable (PRD 4.5)
    score: { type: Number, enum: [100, 70], default: 100 },
    comment: { type: localizedSchema, default: () => ({}) },
    steps: [routeStepSchema]
}, { _id: false });

// Extraction of terms (4.8 extraction_compare): one row per term the student fills for every document of the package
export const EXTRACTION_KINDS = ['text', 'date', 'money', 'bool'] as const;
const extractionFieldSchema = new Schema({
    key: { type: String, required: true, match: /^[a-z][a-z0-9_]*$/ },
    label: { type: localizedSchema, required: true },
    // date: YYYY-MM-DD, money: sum in digits, bool: yes / no - compared exactly; text - by the code, then by meaning by the AI
    kind: { type: String, enum: EXTRACTION_KINDS, default: 'text' },
    // Shown on difficulty 1-2 only
    hint: { type: localizedSchema, default: () => ({}) }
}, { _id: false });
// The author's reference value of one term in one document
const extractionCellSchema = new Schema({
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    fieldKey: { type: String, required: true },
    value: { type: String, default: '' },
    // The document says nothing about this term: the right answer is "not in the document"
    absent: { type: Boolean, default: false },
    // Fragment of the document the value comes from; the student's source must overlap it
    quote: { type: String, default: '' }
}, { _id: false });

const taskTemplateSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    mode: { type: String, enum: MODES, required: true },
    taskType: { type: String, enum: TASK_TYPES, required: true },
    branch: { type: String, default: 'economic' },
    jurisdiction: { type: String, default: 'UZ' },
    skills: [{
        key: { type: String, required: true },
        weight: { type: Number, default: 1, min: 0, max: 1 }
    }],
    difficulty: { type: Number, min: 1, max: 5, required: true },
    title: { type: localizedSchema, required: true },
    // What to draft: a claim, the prayer part, a contract subject, a response...
    instructions: { type: localizedSchema, required: true },
    context: {
        role: { type: localizedSchema, default: () => ({}) },
        // The "today" date in the task world, YYYY-MM-DD; empty = the day the instance is generated
        today: { type: String, default: '' }
    },
    // Case text with {{variable}} placeholders
    caseText: { type: localizedSchema, required: true },
    variablesSchema: [variableSchema],
    // draft_part: the ready document, {{PART}} marks where the student's part goes
    lockedDocument: { type: localizedSchema, default: () => ({}) },
    // Required sections with hints, shown on difficulty 1-3 (hints only on 1-2)
    scaffold: [scaffoldSectionSchema],
    relatedNorms: [{
        code: { type: String, required: true },
        article: { type: String, required: true }
    }],
    // Required for drafting and the procedural card; the review trainers use the document markup as the reference
    referenceAnswer: { type: localizedSchema, default: () => ({}) },
    checklist: [{ type: localizedSchema }],
    // Optional rubric override: { criterionKey: { ru, uz } } describing levels 0/25/50/75/100
    rubric: { type: Schema.Types.Mixed, default: null },
    // Deterministic check of requisites extracted from the student's document (PRD 4.1)
    // "kind" instead of PRD's "type": a nested key named "type" is read by Mongoose as a type declaration
    deterministicCheck: {
        kind: {
            type: String,
            enum: ['none', 'claim_requisites'],
            default: 'none'
        },
        params: {
            // Variable keys or fixed values the engine uses
            amountVar: { type: String, default: '' },
            amount: { type: Number, default: null },
            filingDateVar: { type: String, default: '' },
            filingDate: { type: String, default: '' },
            feeRateCode: { type: String, default: 'property' },
            isSme: { type: Boolean, default: false },
            // Courts accepted as correct (alternative jurisdiction allows several)
            acceptableCourts: [{ type: String }]
        }
    },
    // Review trainers (4.2): the document and whose interests the student protects
    review: {
        documentId: { type: Schema.Types.ObjectId, ref: 'Document', default: null },
        // Party key from document.parties; flaws with badFor = this key or "both" are the student's targets
        clientSide: { type: String, default: '' },
        clientGoals: { type: localizedSchema, default: () => ({}) }
    },
    // Procedural card (4.4 proc_next_step): what the engines compute as the right answer
    process: {
        acceptableCourts: [{ type: String }],
        deadline: {
            ruleCode: { type: String, default: '' },
            eventDateVar: { type: String, default: '' },
            eventDate: { type: String, default: '' },
            extensionDays: { type: Number, default: 0 }
        },
        fee: {
            rateCode: { type: String, default: '' },
            amountVar: { type: String, default: '' },
            amount: { type: Number, default: null },
            // Empty = the task's "today"
            filingDateVar: { type: String, default: '' },
            isSme: { type: Boolean, default: false },
            instance: { type: String, enum: ['first', 'appeal', 'cassation', 'revision'], default: 'first' }
        },
        // proc_draft: the document the situation requires; from level 3 the student names it himself (PRD 4.4)
        draftDocType: { type: localizedSchema, default: () => ({}) },
        // Instructions shown from level 3 instead of the main ones, without the document type; empty = a standard text
        instructionsHidden: { type: localizedSchema, default: () => ({}) },
        // proc_timeline: the case package with dates and the deadlines the engine checks
        timeline: {
            events: [timelineEventSchema],
            checks: [timelineCheckSchema]
        }
    },
    // "Where to apply" (4.5): facts for the client's voice and the routes the author accepts
    route: {
        clientFacts: [{
            _id: false,
            key: { type: String, required: true },
            text: { type: localizedSchema, required: true },
            // Told by the client only when the student asks about it
            onRequest: { type: Boolean, default: false }
        }],
        acceptableRoutes: [acceptableRouteSchema]
    },
    // Extraction of terms (4.8): the package of documents, the terms and the author's reference table
    extraction: {
        documentIds: [{ type: Schema.Types.ObjectId, ref: 'Document' }],
        fields: [extractionFieldSchema],
        reference: [extractionCellSchema]
    },
    // Branching simulation (4.6)
    sim: {
        scenarioId: { type: Schema.Types.ObjectId, ref: 'Scenario', default: null },
        // Empty = the student picks one of the scenario roles
        role: { type: String, default: '' }
    },
    // Hearing simulation with AI participants (sim_hearing): the scenario of stages and participants
    hearing: {
        scenarioId: { type: Schema.Types.ObjectId, ref: 'Hearing', default: null }
    },
    // "Mines" (4.7): optional time limit in seconds, 0 = off
    timerSec: { type: Number, default: 0, min: 0 },
    weightsOverride: { type: Schema.Types.Mixed, default: null },
    // Let the LLM rewrite the case text around the code-picked values
    aiRewrite: { type: Boolean, default: true },
    status: { type: String, enum: ['draft', 'review', 'published'], default: 'draft' },
    source: { type: String, enum: ['manual', 'ai'], default: 'manual' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    // Content shipped with the platform (the demo track) is found again by this key when the seed runs
    seedKey: { type: String, default: undefined },
    // Key of a content pack (ADM-8): importing the same key again updates this record
    importKey: { type: String, default: undefined }
}, { timestamps: true });

taskTemplateSchema.index({ seedKey: 1 }, { unique: true, sparse: true });
taskTemplateSchema.index({ importKey: 1 }, { unique: true, partialFilterExpression: { importKey: { $type: 'string' } } });
taskTemplateSchema.index({ mode: 1, status: 1, difficulty: 1 });
taskTemplateSchema.index({ 'skills.key': 1 });

export type TaskTemplateDoc = HydratedDocument<InferSchemaType<typeof taskTemplateSchema>>;
export const TaskTemplate = model('TaskTemplate', taskTemplateSchema, 'taskTemplates');

// Documents for the review trainers (PRD 4.2, ADM-4). Plain text; ranges are computed by the server from quotes.
const flawSchema = new Schema({
    quote: { type: String, required: true },
    from: { type: Number, required: true },
    to: { type: Number, required: true },
    type: { type: String, default: 'risk' },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    // Party key the clause is dangerous for, or "both"
    badFor: { type: String, default: 'both' },
    normRef: { type: String, default: '' },
    explanation: { type: localizedSchema, default: () => ({}) },
    fix: { type: localizedSchema, default: () => ({}) },
    // Court acts (4.3): the part of the act, and a date or sum the corrected text must contain exactly
    segmentKey: { type: String, default: '' },
    expectedValue: {
        kind: { type: String, enum: ['none', 'date', 'money'], default: 'none' },
        value: { type: String, default: '' }
    },
    // "Mines" on the simplified level: 3-4 replacement options, one or more of them safe
    options: [{ _id: false, text: { type: String, required: true }, correct: { type: Boolean, default: false } }]
});

// review_fix_check: edits already proposed by the counterparty
const counterpartyEditSchema = new Schema({
    quote: { type: String, required: true },
    from: { type: Number, required: true },
    to: { type: Number, required: true },
    replacement: { type: String, default: '' },
    // Party key the edit hurts, "none" when it is harmless for everyone
    badFor: { type: String, default: 'none' },
    explanation: { type: localizedSchema, default: () => ({}) }
});

const documentSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    type: { type: String, enum: ['contract', 'labor_contract', 'claim', 'court_act', 'admin_act'], required: true },
    title: { type: String, required: true },
    language: { type: String, enum: ['ru', 'uz'], required: true },
    script: { type: String, enum: ['cyrl', 'latn'], default: 'latn' },
    text: { type: String, required: true },
    parties: [{ _id: false, key: { type: String, required: true }, name: { type: localizedSchema, required: true } }],
    flaws: [flawSchema],
    counterpartyEdits: [counterpartyEditSchema],
    // Court acts (4.3): internal markup of the parts; a part runs from its start quote to the next part
    segments: [{
        _id: false,
        key: { type: String, required: true },
        startQuote: { type: String, required: true },
        from: { type: Number, required: true },
        to: { type: Number, required: true }
    }],
    caseNumber: { type: String, default: '' },
    actType: { type: String, enum: ['', 'decision', 'resolution', 'ruling', 'order'], default: '' },
    instance: { type: String, enum: ['', 'first', 'appeal', 'cassation', 'revision'], default: '' },
    // AI copy with injected errors keeps a link to the original act, which is the reference for corrections
    originalId: { type: Schema.Types.ObjectId, ref: 'Document', default: null },
    status: { type: String, enum: ['draft', 'review', 'published'], default: 'draft' },
    source: { type: String, enum: ['manual', 'ai'], default: 'manual' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    // Key of a content pack (ADM-8): importing the same key again updates this record
    importKey: { type: String, default: undefined }
}, { timestamps: true });
documentSchema.index({ type: 1, status: 1 });
documentSchema.index({ importKey: 1 }, { unique: true, partialFilterExpression: { importKey: { $type: 'string' } } });

export type DocumentDoc = HydratedDocument<InferSchemaType<typeof documentSchema>>;
export const LegalDocument = model('Document', documentSchema, 'documents');

// Branching scenarios for the simplified simulation (PRD 4.6 sim_branching, 9.3 scenarios)
export const SEGMENT_KEYS = ['case_number', 'court', 'act_type', 'subject', 'place_date', 'intro', 'reasoning', 'resolution_keyword', 'operative', 'judges'] as const;

const choiceSchema = new Schema({
    id: { type: String, required: true },
    text: { type: String, required: true },
    // Node the choice leads to; the hearing ends at a node without choices
    next: { type: String, default: '' },
    verdict: { type: String, enum: ['correct', 'acceptable', 'wrong'], required: true },
    explanation: { type: String, default: '' },
    normRef: { type: String, default: '' }
}, { _id: false });

const nodeSchema = new Schema({
    id: { type: String, required: true },
    stage: { type: String, default: '' },
    speaker: { type: String, default: '' },
    text: { type: String, required: true },
    choices: [choiceSchema],
    // Key node: after the choice the student writes a short justification or a remark to the court, the AI grades it
    freeTextRubric: { type: String, default: '' },
    // Final nodes: the outcome of the case for the student's side
    outcome: { type: String, enum: ['', 'win', 'partial', 'loss'], default: '' }
}, { _id: false });

const scenarioSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    title: { type: String, required: true },
    language: { type: String, enum: ['ru', 'uz'], required: true },
    // Case story shown before the hearing
    caseText: { type: String, default: '' },
    // A role may start at its own node (the plaintiff and the defendant act at different moments); empty = startNodeId
    roles: [{ _id: false, key: { type: String, required: true }, name: { type: String, required: true }, startNodeId: { type: String, default: '' } }],
    startNodeId: { type: String, required: true },
    nodes: [nodeSchema],
    status: { type: String, enum: ['draft', 'review', 'published'], default: 'draft' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    seedKey: { type: String, default: undefined },
    // Key of a content pack (ADM-8): importing the same key again updates this record
    importKey: { type: String, default: undefined }
}, { timestamps: true });
scenarioSchema.index({ seedKey: 1 }, { unique: true, sparse: true });
scenarioSchema.index({ importKey: 1 }, { unique: true, partialFilterExpression: { importKey: { $type: 'string' } } });

export type ScenarioDoc = HydratedDocument<InferSchemaType<typeof scenarioSchema>>;
export const Scenario = model('Scenario', scenarioSchema, 'scenarios');
