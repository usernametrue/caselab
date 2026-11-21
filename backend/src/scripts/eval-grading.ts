import 'dotenv/config';
import fs from 'fs';
import mongoose from 'mongoose';
import { connect } from '../db';
import { Attempt, CRITERIA } from '../modules/attempts/attempt.model';
import { gradeAttempt } from '../modules/attempts/evaluation.service';
import { TaskInstance } from '../modules/tasks/task.model';
import { getLlm } from '../modules/ai/claude.provider';
import { collectIntoBatch } from '../modules/ai/batch-collector';

// Grading quality check (PRD 10.5): attempts a teacher has moderated are the reference set.
// Each one is graded again with the current prompts and compared with the teacher's score.
// Target: mean absolute difference AI vs teacher <= 10 points. Nothing is saved to the attempts.
//
// Run: npm run eval:grading -- [--limit 50] [--taskType draft_full] [--max-mae 10] [--out report.json]
// --no-batch: grade one by one at the regular price. By default the real LLM calls go out as one Message Batch:
// half the price, the report comes when the batch ends (usually within an hour).

type Row = {
    attemptId: string;
    taskType: string;
    teacher: number;
    aiBefore: number | null;
    aiNow: number | null;
    criteria: Record<string, { teacher: number; aiNow: number | null }>;
    error?: string;
};

function args() {
    const a = process.argv.slice(2);
    const get = (name: string) => {
        const i = a.indexOf(`--${name}`);
        return i >= 0 ? a[i + 1] : undefined;
    };
    return {
        limit: Math.max(1, Number(get('limit') ?? 50) || 50),
        taskType: get('taskType') ?? '',
        maxMae: Number(get('max-mae') ?? 10),
        out: get('out') ?? '',
        batch: !a.includes('--no-batch')
    };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const mae = (pairs: [number, number | null][]) => mean(pairs.filter(([, b]) => b !== null).map(([a, b]) => Math.abs(a - (b as number))));
const fmt = (n: number | null) => (n === null ? '-' : n.toFixed(1));

export async function evalGrading(opts: ReturnType<typeof args>) {
    if (!getLlm()) throw new Error('ANTHROPIC_API_KEY is not set - the eval needs the real LLM');
    let instanceFilter: unknown[] | null = null;
    if (opts.taskType) instanceFilter = (await TaskInstance.find({ taskType: opts.taskType }).select('_id').lean()).map(i => i._id);
    const attempts = await Attempt.find({
        status: 'moderated',
        'moderation.prevScore': { $ne: null },
        ...(instanceFilter ? { instanceId: { $in: instanceFilter } } : {})
    }).sort({ 'moderation.at': -1 }).limit(opts.limit);
    const types = new Map((await TaskInstance.find({ _id: { $in: attempts.map(a => a.instanceId) } }).select('taskType').lean()).map(i => [String(i._id), i.taskType]));

    const rows: Row[] = [];
    const gradeOne = async (i: number, attempt: (typeof attempts)[number]) => {
        const teacherCriteria = new Map((attempt.criteriaFinal ?? []).map(c => [c.key, c.score ?? 0]));
        // The weights the teacher's score was computed with
        const weights = Object.fromEntries((attempt.criteriaFinal ?? []).map(c => [c.key as string, c.weight ?? 0]));
        const row: Row = {
            attemptId: String(attempt._id),
            taskType: types.get(String(attempt.instanceId)) ?? '',
            teacher: attempt.finalScore ?? 0,
            aiBefore: attempt.moderation?.prevScore ?? null,
            aiNow: null,
            criteria: Object.fromEntries(CRITERIA.map(k => [k, { teacher: teacherCriteria.get(k) ?? 0, aiNow: null }]))
        };
        try {
            const g = await gradeAttempt(attempt, { weights });
            row.aiNow = g.finalScore;
            for (const c of g.criteriaFinal) row.criteria[c.key].aiNow = c.score;
        } catch (e: any) {
            row.error = String(e?.message ?? e).slice(0, 300);
        }
        rows.push(row);
        console.log(`[${i + 1}/${attempts.length}] ${row.attemptId} ${row.taskType}: teacher ${row.teacher}, AI before ${row.aiBefore ?? '-'}, AI now ${row.aiNow ?? `error (${row.error})`}`);
    };
    if (opts.batch) {
        // All gradings start together; their LLM calls are collected into one batch
        await collectIntoBatch(() => Promise.all(attempts.map((a, i) => gradeOne(i, a))), { onStatus: s => console.log(s) });
    } else {
        for (const [i, attempt] of attempts.entries()) await gradeOne(i, attempt);
    }

    const graded = rows.filter(r => r.aiNow !== null);
    const report = {
        at: new Date().toISOString(),
        attempts: rows.length,
        graded: graded.length,
        failed: rows.length - graded.length,
        maeNow: mae(graded.map(r => [r.teacher, r.aiNow])),
        maeBefore: mae(graded.map(r => [r.teacher, r.aiBefore])),
        byCriterion: Object.fromEntries(CRITERIA.map(k => [k, mae(graded.map(r => [r.criteria[k].teacher, r.criteria[k].aiNow]))])),
        byTaskType: Object.fromEntries([...new Set(graded.map(r => r.taskType))].map(t => {
            const rs = graded.filter(r => r.taskType === t);
            return [t, { attempts: rs.length, maeNow: mae(rs.map(r => [r.teacher, r.aiNow])), maeBefore: mae(rs.map(r => [r.teacher, r.aiBefore])) }];
        })),
        target: opts.maxMae,
        rows
    };
    return report;
}

if (require.main === module) {
    const opts = args();
    connect()
        .then(() => evalGrading(opts))
        .then(async report => {
            console.log('');
            console.log(`Moderated attempts: ${report.attempts}, graded again: ${report.graded}, failed: ${report.failed}`);
            console.log(`MAE AI vs teacher: now ${fmt(report.maeNow)}, at grading time ${fmt(report.maeBefore)} (target <= ${report.target})`);
            console.log('By criterion: ' + CRITERIA.map(k => `${k} ${fmt(report.byCriterion[k])}`).join(', '));
            for (const [t, v] of Object.entries(report.byTaskType)) console.log(`  ${t}: ${v.attempts} attempts, MAE now ${fmt(v.maeNow)}, before ${fmt(v.maeBefore)}`);
            if (opts.out) {
                fs.writeFileSync(opts.out, JSON.stringify(report, null, 2));
                console.log(`Report written to ${opts.out}`);
            }
            await mongoose.disconnect();
            // No reference set yet is not a failure; a MAE above the target is (exit code 1 for CI)
            const pass = report.maeNow === null || report.maeNow <= report.target;
            console.log(report.maeNow === null ? 'No moderated attempts to compare yet' : pass ? 'PASS' : 'FAIL');
            process.exit(pass ? 0 : 1);
        })
        .catch(err => {
            console.error('Eval failed:', err?.message ?? err);
            process.exit(2);
        });
}
