import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';
import { localizedSchema } from '../../utils/localized';

// Case track (PRD 4.10): stages built from ordinary templates in one case world. The result of a stage
// picks the next one by conditions; the court acts and the opponent's documents go into the case folder.

export const CONDITION_KINDS = ['always', 'score_below', 'score_at_least', 'check_failed', 'check_ok', 'route_score_below', 'missed_any', 'sim_outcome'] as const;
export const COURT_ACT_KINDS = ['', 'accept_claim', 'return_claim', 'leave_without_motion', 'order_issued', 'order_cancelled', 'decision_for_client', 'decision_partial', 'decision_against_client', 'appeal_accepted'] as const;
export const OUTCOMES = ['win', 'partial', 'loss'] as const;
// Outcome score of PRD 4.10: won, partly won, lost; every setback stage visited costs time or money
export const OUTCOME_SCORE: Record<string, number> = { win: 100, partial: 60, loss: 0 };
export const SETBACK_PENALTY = 20;
export const MAX_VISITS = 20;

const transitionSchema = new Schema({
    condition: {
        kind: { type: String, enum: CONDITION_KINDS, required: true },
        // A number for score conditions, a field for checks (court, fee, deadline, claim_amount), win / partial / loss
        param: { type: String, default: '' }
    },
    // A stage key or "outcome:win" / "outcome:partial" / "outcome:loss"
    next: { type: String, required: true },
    // The court act the case gets on this transition; the text is written by the AI, the kind is decided here
    courtAct: { type: String, enum: COURT_ACT_KINDS, default: '' }
}, { _id: false });

const stageSchema = new Schema({
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9_]*$/ },
    title: { type: localizedSchema, required: true },
    templateId: { type: Schema.Types.ObjectId, ref: 'TaskTemplate', required: true },
    // Days that pass in the case before this stage starts
    daysAfter: { type: Number, default: 0, min: 0 },
    weight: { type: Number, default: 1, min: 0 },
    // Reaching this stage means lost time or money (a returned claim, a claim left without motion)
    setback: { type: Boolean, default: false },
    // Before the stage the opponent answers the student's documents (PRD 4.10, 10.2 generateOpponentDoc)
    opponentBefore: {
        enabled: { type: Boolean, default: false },
        title: { type: localizedSchema, default: () => ({}) },
        // The opponent's position and facts; also the text used when the AI is not available
        brief: { type: localizedSchema, default: () => ({}) }
    },
    transitions: [transitionSchema],
    defaultNext: { type: String, default: '' },
    defaultCourtAct: { type: String, enum: COURT_ACT_KINDS, default: '' }
}, { _id: false });

const worldValueSchema = new Schema({
    key: { type: String, required: true },
    kind: { type: String, enum: ['money', 'date', 'text'], required: true },
    value: { type: String, default: '' },
    text: { type: localizedSchema, default: () => ({}) }
}, { _id: false });

const folderDocSchema = new Schema({
    title: { type: localizedSchema, required: true },
    text: { type: localizedSchema, default: () => ({}) },
    date: { type: String, default: '' }
}, { _id: false });

const trackSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    seedKey: { type: String, default: undefined },
    title: { type: localizedSchema, required: true },
    description: { type: localizedSchema, default: () => ({}) },
    role: { type: localizedSchema, default: () => ({}) },
    // First day of the case, YYYY-MM-DD; empty = the day the run starts
    startDate: { type: String, default: '' },
    // Values shared by all stages: a template variable with the same key takes this value
    values: [worldValueSchema],
    // Documents in the case folder from the start: the contract, the correspondence
    folder: [folderDocSchema],
    stages: [stageSchema],
    firstStageKey: { type: String, required: true },
    status: { type: String, enum: ['draft', 'review', 'published'], default: 'draft' },
    source: { type: String, enum: ['manual', 'ai'], default: 'manual' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    // Key of a content pack (ADM-8): importing the same key again updates this record
    importKey: { type: String, default: undefined }
}, { timestamps: true });
trackSchema.index({ seedKey: 1 }, { unique: true, sparse: true });
trackSchema.index({ importKey: 1 }, { unique: true, partialFilterExpression: { importKey: { $type: 'string' } } });

export type TrackDoc = HydratedDocument<InferSchemaType<typeof trackSchema>>;
export const Track = model('Track', trackSchema, 'tracks');

// One student's way through a track. The track is copied at the start so later edits do not change a running case.
const runSchema = new Schema({
    trackId: { type: Schema.Types.ObjectId, ref: 'Track', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', default: null },
    isExam: { type: Boolean, default: false },
    language: { type: String, enum: ['ru', 'uz'], required: true },
    status: { type: String, enum: ['active', 'finished'], default: 'active' },
    title: { type: String, default: '' },
    role: { type: String, default: '' },
    snapshot: { type: Schema.Types.Mixed, required: true },
    values: { type: Schema.Types.Mixed, default: {} },
    currentStageKey: { type: String, default: '' },
    currentDate: { type: String, default: '' },
    visits: [{
        _id: false,
        stageKey: String,
        title: String,
        date: String,
        instanceId: { type: Schema.Types.ObjectId, ref: 'TaskInstance' },
        attemptId: { type: Schema.Types.ObjectId, ref: 'Attempt', default: null },
        score: { type: Number, default: null },
        xp: { type: Number, default: 0 },
        setback: { type: Boolean, default: false },
        // Why the case went where it went: the condition that fired and the court act
        reason: { type: String, default: '' },
        courtAct: { type: String, default: '' },
        next: { type: String, default: '' }
    }],
    folder: [{
        _id: false,
        kind: { type: String, enum: ['case', 'student', 'court', 'opponent'], required: true },
        title: String,
        text: String,
        date: String,
        stageKey: { type: String, default: '' },
        generatedByAi: { type: Boolean, default: false }
    }],
    outcome: { type: String, default: '' },
    outcomeScore: { type: Number, default: null },
    finalScore: { type: Number, default: null },
    xpBonus: { type: Number, default: 0 },
    finishedAt: { type: Date, default: null }
}, { timestamps: true });
runSchema.index({ userId: 1, trackId: 1, status: 1 });

export type TrackRunDoc = HydratedDocument<InferSchemaType<typeof runSchema>>;
export const TrackRun = model('TrackRun', runSchema, 'trackRuns');
