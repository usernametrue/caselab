import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connect } from '../db';
import { env } from '../config/env';
import { Organization, User } from '../modules/users/user.model';
import { Skill, modeOfTaskType } from '../modules/content/content.model';
import { ScoringConfig } from '../modules/attempts/attempt.model';
import { Body, BrvValue, CalendarDay, DeadlineRule, FeeRate } from '../modules/legal/legal.model';
import { mapRegisterOrgs } from '../modules/legal/bodies-import';
import { REGISTER_ORGS } from './reestr-organizations';
import { Scenario, TaskTemplate } from '../modules/content/content.model';
import { Track } from '../modules/tracks/track.model';
import { DEMO_SCENARIO, DEMO_TEMPLATES, DEMO_TRACK } from './demo-track';
import { DEMO_HEARING, DEMO_HEARING_TEMPLATE } from './demo-hearing';
import { Hearing } from '../modules/hearing/hearing.model';
import { BCRYPT_COST } from '../modules/auth/auth.routes';
import { BRV, DEADLINE_RULES, FEE_RATES, SCORING, SKILLS, SKILL_TOPICS, holidaysFor } from './reference-data';

// Idempotent: inserts what is missing and never overwrites records edited in the admin panel.
// Run: npm run seed (production image) or npm run seed:dev

async function upsertMissing(model: mongoose.Model<any>, key: string, rows: Record<string, any>[]) {
    let inserted = 0;
    for (const row of rows) {
        const r = await model.updateOne({ [key]: row[key] }, { $setOnInsert: row }, { upsert: true });
        inserted += r.upsertedCount;
    }
    console.log(`${model.modelName}: ${inserted} added, ${rows.length - inserted} already present`);
}

export async function seed() {
    const config = env();

    let org = await Organization.findOne().sort({ createdAt: 1 });
    if (!org) {
        org = await Organization.create({ name: config.ORGANIZATION_NAME, jurisdiction: 'UZ' });
        console.log(`Organization "${org.name}" created`);
    }

    if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
        const email = config.ADMIN_EMAIL.toLowerCase();
        if (!(await User.exists({ email }))) {
            if (config.ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_PASSWORD must have at least 8 characters');
            await User.create({
                organizationId: org._id,
                role: 'admin',
                email,
                fullName: config.ADMIN_FULL_NAME,
                passwordHash: await bcrypt.hash(config.ADMIN_PASSWORD, BCRYPT_COST),
                mustChangePassword: true
            });
            console.log(`Admin ${email} created - the password must be changed at the first login`);
        } else {
            console.log(`Admin ${email} already exists`);
        }
    } else {
        console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set - no admin account created');
    }

    await upsertMissing(Skill, 'key', [
        ...SKILL_TOPICS.map(t => ({ key: t.key, parentKey: null, branch: 'economic', name: { ru: t.ru, uz: t.uz } })),
        ...SKILLS.map(s => ({ key: s.key, parentKey: s.key.split('.')[0], branch: 'economic', name: { ru: s.ru, uz: s.uz } }))
    ]);
    await upsertMissing(ScoringConfig, 'mode', SCORING);
    await upsertMissing(BrvValue, 'validFrom', BRV);
    await upsertMissing(FeeRate, 'code', FEE_RATES);
    await upsertMissing(DeadlineRule, 'code', DEADLINE_RULES);
    // Bodies from the register snapshot (reestr.gov.uz); a fresh import runs from the admin panel
    await upsertMissing(Body, 'code', mapRegisterOrgs(REGISTER_ORGS));
    await seedDemoTrack();
    await seedDemoHearing();
}

// The demo hearing with AI participants: inserted once, published, never overwritten afterwards
export async function seedDemoHearing() {
    if (await TaskTemplate.exists({ seedKey: DEMO_HEARING_TEMPLATE.seedKey })) {
        console.log('Demo hearing already present');
        return;
    }
    const hearing = await Hearing.findOneAndUpdate({ seedKey: DEMO_HEARING.seedKey }, { $setOnInsert: DEMO_HEARING }, { upsert: true, new: true });
    await TaskTemplate.create({ ...DEMO_HEARING_TEMPLATE, mode: modeOfTaskType(DEMO_HEARING_TEMPLATE.taskType), hearing: { scenarioId: hearing!._id } });
    console.log('Demo hearing added and published');
}

// The demo case track: inserted once with status "review", never overwritten afterwards
export async function seedDemoTrack() {
    if (await Track.exists({ seedKey: DEMO_TRACK.seedKey })) {
        console.log('Demo track already present');
        return;
    }
    const scenario = await Scenario.findOneAndUpdate({ seedKey: DEMO_SCENARIO.seedKey }, { $setOnInsert: DEMO_SCENARIO }, { upsert: true, new: true });
    const ids: Record<string, string> = {};
    for (const t of DEMO_TEMPLATES) {
        const row: any = { ...t, mode: modeOfTaskType(t.taskType) };
        if (t.taskType === 'sim_branching') row.sim = { ...(t as any).sim, scenarioId: scenario!._id };
        const saved = await TaskTemplate.findOneAndUpdate({ seedKey: t.seedKey }, { $setOnInsert: row }, { upsert: true, new: true });
        ids[`@template:${t.seedKey}`] = String(saved!._id);
    }
    await Track.create({ ...DEMO_TRACK, stages: DEMO_TRACK.stages.map(st => ({ ...st, templateId: ids[st.templateId] })) });
    console.log('Demo track added with status "review" - publish it in the admin panel');
    const year = new Date().getUTCFullYear();
    await upsertMissing(CalendarDay, 'date', holidaysFor([year, year + 1]));
}

if (require.main === module) {
    connect()
        .then(seed)
        .then(() => mongoose.disconnect())
        .then(() => process.exit(0))
        .catch(err => {
            console.error('Seed failed:', err);
            process.exit(1);
        });
}
