import { Schema, model, Types } from 'mongoose';

const skillRatingSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    skillKey: { type: String, required: true },
    rating: { type: Number, required: true },
    attemptsCount: { type: Number, default: 0 },
    avgScore: { type: Number, default: 0 },
    lastAt: { type: Date, default: null },
    errorStats: { type: Schema.Types.Mixed, default: {} },
    // Last 10 error types, for the "same errorType 3 times in 10 attempts" rule (PRD 6.4)
    recentErrors: [{ type: String }]
}, { timestamps: true });
skillRatingSchema.index({ userId: 1, skillKey: 1 }, { unique: true });
export const SkillRating = model('SkillRating', skillRatingSchema, 'skillRatings');

const xpEventSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    reason: { type: String, required: true },
    attemptId: { type: Schema.Types.ObjectId, default: null },
    createdAt: { type: Date, default: () => new Date() }
});
xpEventSchema.index({ userId: 1, createdAt: -1 });
export const XpEvent = model('XpEvent', xpEventSchema, 'xpEvents');

const userAchievementSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code: { type: String, required: true },
    earnedAt: { type: Date, default: () => new Date() }
});
userAchievementSchema.index({ userId: 1, code: 1 }, { unique: true });
export const UserAchievement = model('UserAchievement', userAchievementSchema, 'userAchievements');

// Three tasks of the day (PRD 7.5): the weakest skill, a repetition, a random mode; made at the first visit of the day
const dailySetSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Calendar day in Asia/Tashkent, YYYY-MM-DD
    date: { type: String, required: true },
    tasks: [{
        _id: false,
        kind: { type: String, enum: ['weak', 'repeat', 'random'], required: true },
        skillKey: { type: String, default: '' },
        mode: { type: String, default: '' },
        templateId: { type: Schema.Types.ObjectId, ref: 'TaskTemplate', required: true },
        instanceId: { type: Schema.Types.ObjectId, ref: 'TaskInstance', default: null },
        done: { type: Boolean, default: false },
        xpAwarded: { type: Number, default: 0 }
    }]
}, { timestamps: true });
dailySetSchema.index({ userId: 1, date: 1 }, { unique: true });
export const DailySet = model('DailySet', dailySetSchema, 'dailySets');

// Weekly AI summary for the student (PRD 10.2 weeklySummary): made at the first visit of the Tashkent week
// after some training, covers the last 7 days and is kept until the next week
const weeklySummarySchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Monday of the Tashkent week, YYYY-MM-DD
    weekStart: { type: String, required: true },
    periodFrom: { type: String, required: true },
    periodTo: { type: String, required: true },
    locale: { type: String, enum: ['ru', 'uz'], default: 'ru' },
    summary: { type: String, required: true },
    strengths: [{ type: String }],
    focus: [{ type: String }],
    // Aggregates the text was written from, shown next to it
    stats: { type: Schema.Types.Mixed, default: {} },
    model: { type: String, default: '' },
    promptVersion: { type: String, default: '' }
}, { timestamps: true });
weeklySummarySchema.index({ userId: 1, weekStart: 1 }, { unique: true });
export const WeeklySummary = model('WeeklySummary', weeklySummarySchema, 'weeklySummaries');
