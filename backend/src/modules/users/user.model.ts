import { Schema, model, Types, InferSchemaType, HydratedDocument } from 'mongoose';

export const ROLES = ['student', 'teacher', 'admin'] as const;
export type Role = typeof ROLES[number];

export const START_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type StartLevel = typeof START_LEVELS[number];

const organizationSchema = new Schema({
    name: { type: String, required: true },
    jurisdiction: { type: String, default: 'UZ' },
    settings: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

export const Organization = model('Organization', organizationSchema);

const userSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    role: { type: String, enum: ROLES, default: 'student', required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true, trim: true },
    locale: { type: String, enum: ['ru', 'uz'], default: 'ru' },
    course: { type: Number, min: 1, max: 6 },
    // Chosen at onboarding (AUTH-4); null until the student picks it
    startLevel: { type: String, enum: [...START_LEVELS, null], default: null },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    streak: {
        current: { type: Number, default: 0 },
        best: { type: Number, default: 0 },
        // Calendar day in Asia/Tashkent, YYYY-MM-DD
        lastActiveDate: { type: String, default: null },
        freezes: { type: Number, default: 0 }
    },
    // PRD 7.5: the student may hide from the overall leaderboard
    hideFromLeaderboard: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false },
    // Incremented on logout and password change - invalidates refresh tokens
    tokenVersion: { type: Number, default: 0 }
}, { timestamps: true });

export type UserDoc = HydratedDocument<InferSchemaType<typeof userSchema>>;
export const User = model('User', userSchema);

// Public projection - never exposes passwordHash or tokenVersion
export const toPublicUser = (u: UserDoc) => ({
    id: String(u._id),
    role: u.role,
    email: u.email,
    fullName: u.fullName,
    locale: u.locale,
    course: u.course ?? null,
    startLevel: u.startLevel ?? null,
    xp: u.xp,
    level: u.level,
    streak: u.streak,
    hideFromLeaderboard: Boolean(u.hideFromLeaderboard),
    isBlocked: u.isBlocked,
    mustChangePassword: u.mustChangePassword,
    createdAt: (u as any).createdAt
});

const groupSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    inviteCode: { type: String, required: true, unique: true, uppercase: true },
    studentIds: [{ type: Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

export const Group = model('Group', groupSchema);

// Assignment of templates to a group (TCH-2). Exam: one iteration, results hidden until published.
const assignmentSchema = new Schema({
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    templateIds: [{ type: Schema.Types.ObjectId, ref: 'TaskTemplate' }],
    // Case tracks of the assignment (PRD 4.10: a case for a week or an exam)
    trackIds: [{ type: Schema.Types.ObjectId, ref: 'Track' }],
    kind: { type: String, enum: ['training', 'exam'], default: 'training' },
    dueAt: { type: Date, required: true },
    resultsPublished: { type: Boolean, default: false }
}, { timestamps: true });

export const Assignment = model('Assignment', assignmentSchema, 'assignments');
