import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';

// Hearing simulation (sim_hearing): the student speaks in his own words (text or voice), the AI plays the other
// participants by the author's script. At the end the code writes the protocol from the transcript and the AI grades the role.

export const PARTICIPANT_ROLES = ['judge', 'opponent', 'witness', 'expert', 'prosecutor', 'third_party', 'other'] as const;

const participantSchema = new Schema({
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9_]*$/ },
    // As the protocol names him: "Председательствующий судья Д. Рахимова", "Представитель истца А. Каримов"
    name: { type: String, required: true },
    role: { type: String, enum: PARTICIPANT_ROLES, default: 'other' },
    // Position, what he knows, how he behaves: only the AI sees it
    persona: { type: String, default: '' }
}, { _id: false });

const stageSchema = new Schema({
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9_]*$/ },
    title: { type: String, required: true },
    // What has to happen at this stage; the AI moves on when it is done
    goal: { type: String, default: '' },
    // What the student is expected to do here; shown to him as a hint on difficulty 1-3
    studentTask: { type: String, default: '' },
    // The words that open the stage, said by the participant below; empty = the AI opens the stage itself
    opening: { type: String, default: '' },
    openingBy: { type: String, default: '' },
    // After this many student replies the stage ends anyway
    maxTurns: { type: Number, default: 4, min: 1, max: 12 }
}, { _id: false });

const criterionSchema = new Schema({
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' }
}, { _id: false });

const hearingSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null },
    title: { type: String, required: true },
    language: { type: String, enum: ['ru', 'uz'], required: true },
    court: { type: String, default: '' },
    caseNumber: { type: String, default: '' },
    // Facts known to every participant and shown to the student before the hearing
    caseText: { type: String, default: '' },
    // Facts the AI participants know and may use; the student does not see them
    hiddenFacts: { type: String, default: '' },
    studentRole: {
        name: { type: String, required: true },
        // What the student must achieve: the court has to decide what
        goal: { type: String, default: '' }
    },
    participants: [participantSchema],
    stages: [stageSchema],
    // What the judge weighs when he decides: the author's view of a strong and a weak performance
    decisionGuide: { type: String, default: '' },
    // Extra points of the role the AI grades besides the standard criteria
    criteria: [criterionSchema],
    status: { type: String, enum: ['draft', 'review', 'published'], default: 'draft' },
    authorId: { type: Schema.Types.ObjectId, ref: 'User' },
    seedKey: { type: String, default: undefined }
}, { timestamps: true });
hearingSchema.index({ seedKey: 1 }, { unique: true, sparse: true });

export type HearingDoc = HydratedDocument<InferSchemaType<typeof hearingSchema>>;
export const Hearing = model('Hearing', hearingSchema, 'hearings');
