import { randomInt } from 'crypto';
import { DailySet, SkillRating } from './gamification.model';
import { TaskTemplate } from '../content/content.model';
import { selectTemplate } from '../tasks/task.service';
import { tashkentToday } from '../legal/engines/dates';
import type { UserDoc } from '../users/user.model';

// Three tasks of the day (PRD 7.5): 1 on the weakest skill, 1 repetition, 1 from a random mode.
// Made at the first request of the Tashkent day and fixed until the next day.
export async function dailySetFor(user: UserDoc) {
    const date = tashkentToday();
    const existing = await DailySet.findOne({ userId: user._id, date });
    if (existing) return existing;

    const published = await TaskTemplate.find({ status: 'published' }).select('mode skills').lean();
    if (!published.length) return null;
    const skillsWithTasks = new Set(published.flatMap(t => t.skills.map(s => s.key)));
    const ratings = (await SkillRating.find({ userId: user._id }).lean()).filter(r => skillsWithTasks.has(r.skillKey));

    const tasks: { kind: 'weak' | 'repeat' | 'random'; skillKey: string; mode: string; templateId: any }[] = [];
    const used = new Set<string>();
    const add = async (kind: 'weak' | 'repeat' | 'random', filter: { skillKey?: string; mode?: string }) => {
        // Two tries so that the three tasks are different templates when the library allows it
        for (let i = 0; i < 2; i++) {
            const t = await selectTemplate(user, filter);
            if (t && !used.has(String(t._id))) {
                used.add(String(t._id));
                tasks.push({ kind, skillKey: filter.skillKey ?? '', mode: filter.mode ?? t.mode, templateId: t._id });
                return;
            }
        }
    };

    const weakest = [...ratings].sort((a, b) => a.rating - b.rating)[0];
    await add('weak', weakest ? { skillKey: weakest.skillKey } : {});
    // Repetition: the trained skill left alone for the longest time
    const stale = [...ratings].filter(r => r.skillKey !== weakest?.skillKey).sort((a, b) => (a.lastAt?.getTime() ?? 0) - (b.lastAt?.getTime() ?? 0))[0];
    await add('repeat', stale ? { skillKey: stale.skillKey } : {});
    const modes = [...new Set(published.map(t => t.mode))];
    await add('random', { mode: modes[randomInt(0, modes.length)] });

    try {
        return await DailySet.create({ userId: user._id, date, tasks });
    } catch (e: any) {
        // Two parallel first requests of the day: the other one created the set
        if (e?.code === 11000) return DailySet.findOne({ userId: user._id, date });
        throw e;
    }
}
