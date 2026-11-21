import { Schema, model, Types, InferSchemaType, HydratedDocument } from 'mongoose';

// A generated task given to one student. "expected" is never sent to the client before submission.
const taskInstanceSchema = new Schema({
    templateId: { type: Schema.Types.ObjectId, ref: 'TaskTemplate', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', default: null },
    // Stage of a case track (PRD 4.10): one iteration, the result moves the case on
    runId: { type: Schema.Types.ObjectId, ref: 'TrackRun', default: null },
    stageKey: { type: String, default: '' },
    // Exam (TCH-2): one iteration, no XP, results hidden until the teacher publishes them
    isExam: { type: Boolean, default: false },
    mode: { type: String, required: true },
    taskType: { type: String, required: true },
    difficulty: { type: Number, required: true },
    language: { type: String, enum: ['ru', 'uz'], required: true },
    content: {
        title: { type: String, required: true },
        instructions: { type: String, required: true },
        role: { type: String, default: '' },
        today: { type: String, required: true },
        caseText: { type: String, required: true },
        lockedDocument: { type: String, default: '' },
        scaffold: [{ _id: false, title: String, hint: String }],
        relatedNorms: [{ _id: false, code: String, article: String }],
        // Review trainers: a snapshot of the document so later edits of the library do not change a running task
        documentTitle: { type: String, default: '' },
        documentText: { type: String, default: '' },
        clientSide: { type: String, default: '' },
        clientSideName: { type: String, default: '' },
        clientGoals: { type: String, default: '' },
        // Told to the student on difficulty 1-2 only (PRD 4.0)
        flawCount: { type: Number, default: null },
        counterpartyEdits: [{ _id: false, id: String, from: Number, to: Number, quote: String, replacement: String }],
        // proc_timeline: the case package; the deadlines to compute are named on levels 1-2 only
        timelineEvents: [{ _id: false, key: String, title: String, date: String, text: String }],
        timelineChecks: [{ _id: false, key: String, label: String, fromEventKey: String }],
        // "Where to apply": questions to the client and the answers (up to 3, PRD 4.5)
        clientDialog: [{ _id: false, question: String, answer: String, at: Date }],
        // Simulation state: the role, the current node and the path taken
        sim: {
            role: { type: String, default: '' },
            roleName: { type: String, default: '' },
            roles: [{ _id: false, key: String, name: String }],
            currentNodeId: { type: String, default: '' },
            history: [{ _id: false, nodeId: String, choiceId: String, justification: String }],
            finished: { type: Boolean, default: false }
        },
        // Hearing simulation (sim_hearing): stages, participants without personas, the transcript (HearingState)
        hearing: { type: Schema.Types.Mixed, default: null },
        // "Mines": phrases the student can click, the clicks made and the timer
        mines: {
            segments: [{ _id: false, from: Number, to: Number }],
            clicks: [{ _id: false, segment: Number, mine: Boolean, at: Date }],
            timerSec: { type: Number, default: 0 },
            startedAt: { type: Date, default: null },
            simplified: { type: Boolean, default: false }
        },
        // Extraction of terms (4.8): the package of documents and the terms to fill, { documents: [{ id, title, text }], fields: [{ key, label, kind, hint }] }
        extraction: { type: Schema.Types.Mixed, default: null },
        // true when the LLM wrote the case text, false when the template text was used as is
        generatedByAi: { type: Boolean, default: false }
    },
    expected: {
        values: { type: Schema.Types.Mixed, default: {} },
        referenceAnswer: { type: String, default: '' },
        checklist: [{ type: String }],
        engine: { type: Schema.Types.Mixed, default: null }
    },
    // Best result across iterations: max(first, 0.7 * second)
    bestScore: { type: Number, default: null },
    iterationsUsed: { type: Number, default: 0 },
    // Closed after the second iteration or when the student finishes without rework - the reference opens then
    closed: { type: Boolean, default: false }
}, { timestamps: true });

taskInstanceSchema.index({ userId: 1, createdAt: -1 });
// Demand per template and language for the pool of prepared cases
taskInstanceSchema.index({ createdAt: -1, templateId: 1 });

export type TaskInstanceDoc = HydratedDocument<InferSchemaType<typeof taskInstanceSchema>>;
export const TaskInstance = model('TaskInstance', taskInstanceSchema, 'taskInstances');

// A case rewritten in advance through a batch (half the price) for one date "today": taken once, then deleted.
// templateRev ties it to the template version it was written from.
const instanceVariantSchema = new Schema({
    templateId: { type: Schema.Types.ObjectId, ref: 'TaskTemplate', required: true },
    templateRev: { type: String, required: true },
    kind: { type: String, enum: ['instance', 'client_story'], required: true },
    locale: { type: String, enum: ['ru', 'uz'], required: true },
    today: { type: String, required: true },
    raw: { type: Schema.Types.Mixed, required: true },
    display: { type: Schema.Types.Mixed, required: true },
    caseText: { type: String, required: true },
    model: { type: String, default: '' },
    promptVersion: { type: String, default: '' },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });
instanceVariantSchema.index({ templateId: 1, kind: 1, locale: 1, today: 1, createdAt: 1 });
instanceVariantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const InstanceVariant = model('InstanceVariant', instanceVariantSchema, 'instanceVariants');

// Instance as the student sees it
export const toPublicInstance = (i: TaskInstanceDoc) => ({
    id: String(i._id),
    templateId: String(i.templateId),
    mode: i.mode,
    taskType: i.taskType,
    difficulty: i.difficulty,
    language: i.language,
    content: i.content,
    bestScore: i.bestScore,
    iterationsUsed: i.iterationsUsed,
    closed: i.closed,
    isExam: i.isExam,
    runId: i.runId ? String(i.runId) : null,
    stageKey: i.stageKey || '',
    assignmentId: i.assignmentId ? String(i.assignmentId) : null,
    createdAt: (i as any).createdAt
});
