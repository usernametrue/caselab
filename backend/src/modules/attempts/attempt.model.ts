import { Schema, model, Types, InferSchemaType, HydratedDocument } from 'mongoose';
import { logWarn } from '../../logger';

export const CRITERIA = ['accuracy', 'completeness', 'reasoning', 'form', 'language'] as const;
export type Criterion = typeof CRITERIA[number];

export const ATTEMPT_STATUSES = ['evaluating', 'auto', 'needs_review', 'moderated', 'failed'] as const;

const attemptSchema = new Schema({
    instanceId: { type: Schema.Types.ObjectId, ref: 'TaskInstance', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    iteration: { type: Number, enum: [1, 2], required: true },
    answer: { type: Schema.Types.Mixed, required: true },
    durationSec: { type: Number, default: 0 },
    deterministic: {
        score: { type: Number, default: null },
        details: { type: Schema.Types.Mixed, default: null }
    },
    ai: {
        criteria: [{
            _id: false,
            key: String,
            score: Number,
            comment: String,
            quotes: [String]
        }],
        errors: [{
            _id: false,
            errorType: String,
            skillKey: String,
            quote: String,
            comment: String,
            normRef: String,
            // normRef found in the norms dictionary
            normVerified: Boolean
        }],
        feedback: String,
        improvedVersion: String,
        missing: [String],
        extracted: { type: Schema.Types.Mixed, default: null },
        // Review: feedback per student item and verdicts on extra findings; process: comments per card field
        items: { type: Schema.Types.Mixed, default: [] },
        extras: { type: Schema.Types.Mixed, default: [] },
        fields: { type: Schema.Types.Mixed, default: [] },
        confidence: Number,
        injectionSuspected: Boolean,
        model: String,
        promptVersion: String
    },
    criteriaFinal: [{ _id: false, key: String, score: Number, weight: Number, source: String }],
    finalScore: { type: Number, default: null },
    status: { type: String, enum: ATTEMPT_STATUSES, default: 'evaluating' },
    reviewReasons: [{ type: String }],
    moderation: {
        by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        at: { type: Date, default: null },
        prevScore: { type: Number, default: null },
        comment: { type: String, default: '' }
    },
    xpAwarded: { type: Number, default: 0 },
    // explainResult (PRD 10.2): plain-language explanations of engine mismatches, by check key
    explanations: { type: Schema.Types.Mixed, default: {} },
    // STD-5: the student's dispute of the AI score
    dispute: {
        comment: { type: String, default: '' },
        at: { type: Date, default: null }
    },
    // Worker bookkeeping: claim lock, retry schedule
    lockedUntil: { type: Date, default: null },
    nextRunAt: { type: Date, default: () => new Date() },
    retries: { type: Number, default: 0 },
    lastError: { type: String, default: '' }
}, { timestamps: true });

attemptSchema.index({ userId: 1, createdAt: -1 });
attemptSchema.index({ status: 1, nextRunAt: 1 });

export type AttemptDoc = HydratedDocument<InferSchemaType<typeof attemptSchema>>;
export const Attempt = model('Attempt', attemptSchema, 'attempts');

const scoringConfigSchema = new Schema({
    mode: { type: String, required: true, unique: true },
    weights: {
        accuracy: { type: Number, required: true, min: 0 },
        completeness: { type: Number, required: true, min: 0 },
        reasoning: { type: Number, required: true, min: 0 },
        form: { type: Number, required: true, min: 0 },
        language: { type: Number, required: true, min: 0 }
    }
}, { timestamps: true });
export const ScoringConfig = model('ScoringConfig', scoringConfigSchema, 'scoringConfigs');

// Log of every LLM call, kept 90 days
const aiLogSchema = new Schema({
    purpose: { type: String, required: true },
    attemptId: { type: Schema.Types.ObjectId, default: null },
    model: String,
    promptVersion: String,
    tokensIn: Number,
    tokensOut: Number,
    // Prompt cache: tokens read at 5-10% of the price and written at 125-200% (cost below already counts them)
    cacheRead: { type: Number, default: 0 },
    cacheWrite: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    batch: { type: Boolean, default: false },
    latencyMs: Number,
    error: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date(), expires: 60 * 60 * 24 * 90 }
});
// A failed call also goes to the backend log, so "docker compose logs backend" shows the real cause behind llm_failed
aiLogSchema.post('save', function (doc) {
    if (doc.error) logWarn(`LLM call failed: ${doc.purpose}`, {}, { error: doc.error, promptVersion: doc.promptVersion, latencyMs: doc.latencyMs, attemptId: doc.attemptId ? String(doc.attemptId) : undefined });
});
export const AiLog = model('AiLog', aiLogSchema, 'aiLogs');
