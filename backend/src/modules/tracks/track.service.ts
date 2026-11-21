import { z } from 'zod';
import { Track, TrackRun, OUTCOME_SCORE, SETBACK_PENALTY, MAX_VISITS, type TrackRunDoc } from './track.model';
import { TaskInstance, type TaskInstanceDoc } from '../tasks/task.model';
import { Attempt, type AttemptDoc } from '../attempts/attempt.model';
import { User } from '../users/user.model';
import { UserAchievement, XpEvent } from '../gamification/gamification.model';
import { levelForXp } from '../gamification/gamification.service';
import { generateInstance, type WorldValues } from '../tasks/task.service';
import { addDays, formatRuDate, tashkentToday } from '../legal/engines/dates';
import { aiAvailable, aiGenerate } from '../ai/ai.service';
import { escapeBlock, languageName, loadPrompt, render } from '../ai/prompts';
import { pick, type Locale } from '../../utils/localized';
import { HttpError } from '../../utils/http';
import { logError } from '../../logger';

// ---------- Case world ----------

const money = (n: number, locale: Locale) => `${Math.round(n).toLocaleString('ru-RU').replace(/ | | /g, ' ')} ${locale === 'uz' ? "so'm" : 'сум'}`;

export function worldValues(snapshot: any, locale: Locale): WorldValues {
    const out: WorldValues = {};
    for (const v of snapshot.values ?? []) {
        if (v.kind === 'money') out[v.key] = { raw: Number(v.value), display: money(Number(v.value), locale) };
        else if (v.kind === 'date') out[v.key] = { raw: v.value, display: formatRuDate(v.value) };
        else out[v.key] = { raw: pick(v.text, 'ru'), display: pick(v.text, locale) };
    }
    return out;
}

// {{key}} of the case values in folder texts and the opponent's position
export const fillWorld = (text: string, values: WorldValues) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => values[k]?.display ?? m);

const stageOf = (snapshot: any, key: string) => (snapshot.stages ?? []).find((s: any) => s.key === key) ?? null;

// Problems that block publishing: unknown stages, missing templates, unreachable stages, a stage without a way out
export function validateTrack(t: { stages: any[]; firstStageKey: string }) {
    const problems: string[] = [];
    const keys = t.stages.map(s => s.key);
    if (new Set(keys).size !== keys.length) problems.push('Stage keys must be unique');
    if (!keys.includes(t.firstStageKey)) problems.push(`The first stage "${t.firstStageKey}" does not exist`);
    const target = (n: string) => n.startsWith('outcome:') ? ['outcome:win', 'outcome:partial', 'outcome:loss'].includes(n) : keys.includes(n);
    for (const s of t.stages) {
        for (const tr of s.transitions ?? []) if (!target(tr.next)) problems.push(`Stage "${s.key}": transition to unknown "${tr.next}"`);
        if (!s.defaultNext) problems.push(`Stage "${s.key}" needs a default next step or outcome`);
        else if (!target(s.defaultNext)) problems.push(`Stage "${s.key}": default next "${s.defaultNext}" is unknown`);
    }
    const reach = new Set<string>();
    const stack = [t.firstStageKey];
    while (stack.length) {
        const k = stack.pop()!;
        if (reach.has(k) || !keys.includes(k)) continue;
        reach.add(k);
        const s = t.stages.find(x => x.key === k);
        for (const n of [...(s.transitions ?? []).map((x: any) => x.next), s.defaultNext]) if (n && !n.startsWith('outcome:')) stack.push(n);
    }
    for (const k of keys) if (!reach.has(k)) problems.push(`Stage "${k}" cannot be reached`);
    return problems;
}

// ---------- Conditions (PRD 4.10: transitions by the results of the stage check) ----------

export function conditionHolds(cond: { kind: string; param?: string | null }, attempt: { finalScore?: number | null; deterministic?: any }) {
    const d = attempt.deterministic?.details ?? attempt.deterministic ?? null;
    const score = attempt.finalScore ?? 0;
    const p = cond.param ?? '';
    const check = (key: string) => (d?.checks ?? []).find((c: any) => c.key === key);
    switch (cond.kind) {
        case 'always': return true;
        case 'score_below': return score < Number(p);
        case 'score_at_least': return score >= Number(p);
        case 'check_failed': return Boolean(check(p) && !check(p).ok);
        case 'check_ok': return Boolean(check(p)?.ok);
        case 'route_score_below': return d?.kind === 'route' && Number(d.score) < Number(p);
        case 'missed_any': {
            if (!d) return false;
            if (d.kind === 'timeline') return d.violations?.missed?.length > 0 || (d.checks ?? []).some((c: any) => !c.ok);
            return Array.isArray(d.missed) ? d.missed.length > 0 : false;
        }
        case 'sim_outcome': return d?.kind === 'sim' && d.outcome === p;
        default: return false;
    }
}

const REASON_TEXT: Record<string, Record<Locale, (p: string) => string>> = {
    always: { ru: () => '', uz: () => '' },
    score_below: { ru: p => `балл этапа ниже ${p}`, uz: p => `bosqich bali ${p} dan past` },
    score_at_least: { ru: p => `балл этапа ${p} и выше`, uz: p => `bosqich bali ${p} va undan yuqori` },
    check_failed: { ru: p => `неверно: ${CHECK_NAMES.ru[p] ?? p}`, uz: p => `noto'g'ri: ${CHECK_NAMES.uz[p] ?? p}` },
    check_ok: { ru: p => `верно: ${CHECK_NAMES.ru[p] ?? p}`, uz: p => `to'g'ri: ${CHECK_NAMES.uz[p] ?? p}` },
    route_score_below: { ru: p => `маршрут оценен ниже ${p}`, uz: p => `yo'l ${p} dan past baholandi` },
    missed_any: { ru: () => 'пропущены ошибки или нарушения', uz: () => "xato yoki buzilishlar o'tkazib yuborilgan" },
    sim_outcome: { ru: p => `исход заседания: ${OUTCOME_NAMES.ru[p] ?? p}`, uz: p => `majlis natijasi: ${OUTCOME_NAMES.uz[p] ?? p}` }
};
const OUTCOME_NAMES: Record<Locale, Record<string, string>> = {
    ru: { win: 'в пользу клиента', partial: 'частичный успех', loss: 'не в пользу клиента' },
    uz: { win: 'mijoz foydasiga', partial: 'qisman muvaffaqiyat', loss: 'mijoz foydasiga emas' }
};
const CHECK_NAMES: Record<Locale, Record<string, string>> = {
    ru: { court: 'суд', fee: 'госпошлина', deadline: 'срок', claim_amount: 'цена иска' },
    uz: { court: 'sud', fee: 'davlat boji', deadline: 'muddat', claim_amount: "da'vo summasi" }
};

// ---------- AI documents of the case: court acts and the opponent ----------

const COURT_ACT_NAMES: Record<Locale, Record<string, string>> = {
    ru: {
        accept_claim: 'Определение о принятии искового заявления и подготовке дела', return_claim: 'Определение о возвращении искового заявления',
        leave_without_motion: 'Определение об оставлении искового заявления без движения', order_issued: 'Судебный приказ', order_cancelled: 'Определение об отмене судебного приказа',
        decision_for_client: 'Решение суда', decision_partial: 'Решение суда', decision_against_client: 'Решение суда', appeal_accepted: 'Определение о принятии апелляционной жалобы'
    },
    uz: {
        accept_claim: "Da'vo arizasini qabul qilish va ishni tayyorlash to'g'risida ajrim", return_claim: "Da'vo arizasini qaytarish to'g'risida ajrim",
        leave_without_motion: "Da'vo arizasini harakatsiz qoldirish to'g'risida ajrim", order_issued: "Sud buyrug'i", order_cancelled: "Sud buyrug'ini bekor qilish to'g'risida ajrim",
        decision_for_client: 'Sudning hal qiluv qarori', decision_partial: 'Sudning hal qiluv qarori', decision_against_client: 'Sudning hal qiluv qarori', appeal_accepted: "Apellyatsiya shikoyatini qabul qilish to'g'risida ajrim"
    }
};

// What the court decided, in one line: the AI writes the text but cannot change the outcome (PRD 10.2 generateCourtAct)
const COURT_ACT_GIST: Record<Locale, Record<string, string>> = {
    ru: {
        accept_claim: 'Иск принят к производству, назначена подготовка дела; ответчику предложено представить отзыв.',
        return_claim: 'Исковое заявление возвращено истцу.', leave_without_motion: 'Исковое заявление оставлено без движения, истцу дан срок устранить недостатки.',
        order_issued: 'Выдан судебный приказ о взыскании.', order_cancelled: 'Судебный приказ отменен по возражению должника.',
        decision_for_client: 'Требования клиента удовлетворены полностью.', decision_partial: 'Требования клиента удовлетворены частично.',
        decision_against_client: 'В удовлетворении требований клиента отказано.', appeal_accepted: 'Апелляционная жалоба принята к производству.'
    },
    uz: {
        accept_claim: "Da'vo ish yuritishga qabul qilindi, ishni tayyorlash belgilandi; javobgarga nizo bo'yicha fikr taqdim etish taklif qilindi.",
        return_claim: "Da'vo arizasi da'vogarga qaytarildi.", leave_without_motion: "Da'vo arizasi harakatsiz qoldirildi, da'vogarga kamchiliklarni bartaraf etish uchun muddat berildi.",
        order_issued: "Undirish to'g'risida sud buyrug'i berildi.", order_cancelled: "Sud buyrug'i qarzdorning e'tirozi bo'yicha bekor qilindi.",
        decision_for_client: "Mijozning talablari to'liq qanoatlantirildi.", decision_partial: 'Mijozning talablari qisman qanoatlantirildi.',
        decision_against_client: 'Mijozning talablarini qanoatlantirish rad etildi.', appeal_accepted: 'Apellyatsiya shikoyati ish yuritishga qabul qilindi.'
    }
};

const docSchema = z.object({ title: z.string().min(3), text: z.string().min(50) });
const lang = (l: Locale) => languageName(l);

const folderDigest = (run: TrackRunDoc, limit = 6000) =>
    escapeBlock(run.folder.map(f => `[${f.kind}] ${f.date ? formatRuDate(f.date!) + ' ' : ''}${f.title}\n${f.text}`).join('\n\n').slice(-limit));

async function courtActDoc(run: TrackRunDoc, kind: string, reason: string, date: string) {
    const locale = run.language as Locale;
    const title = COURT_ACT_NAMES[locale][kind] ?? kind;
    const gist = COURT_ACT_GIST[locale][kind] ?? '';
    if (aiAvailable()) {
        const prompt = loadPrompt('generate-court-act', 2);
        try {
            const r = await aiGenerate({
                task: 'generateCourtAct',
                promptVersion: prompt.version,
                ...render(prompt, { actName: title, decision: gist, reason: reason || '-', date: formatRuDate(date), folder: folderDigest(run), language: lang(locale) }),
                schema: docSchema
            });
            return { kind: 'court' as const, title: r.data.title, text: r.data.text, date, generatedByAi: true };
        } catch {
            // The failure is in AiLog; the fallback act below keeps the case moving
        }
    }
    // Without the AI the case still moves: a short act with the decision of the engine
    const basis = reason ? (locale === 'uz' ? `Asos: ${reason}.` : `Основание: ${reason}.`) : '';
    return { kind: 'court' as const, title, text: [title, formatRuDate(date), gist, basis].filter(Boolean).join('\n'), date, generatedByAi: false };
}

async function opponentDoc(run: TrackRunDoc, stage: any, date: string) {
    const locale = run.language as Locale;
    const title = pick(stage.opponentBefore?.title, locale) || (locale === 'uz' ? 'Javobgarning fikri' : 'Отзыв ответчика');
    const brief = fillWorld(pick(stage.opponentBefore?.brief, locale), run.values as WorldValues);
    // The student's weak spots from the evaluated stages: the opponent hits them (PRD 4.10)
    const attempts = await Attempt.find({ _id: { $in: run.visits.map(v => v.attemptId).filter(Boolean) } }).select('ai.errors ai.missing').lean();
    const weak = attempts.flatMap(a => [...(a.ai?.errors ?? []).map(e => e.comment), ...(a.ai?.missing ?? [])]).filter(Boolean).slice(0, 12);
    if (aiAvailable()) {
        const prompt = loadPrompt('generate-opponent-doc', 2);
        try {
            const r = await aiGenerate({
                task: 'generateOpponentDoc',
                promptVersion: prompt.version,
                ...render(prompt, { docTitle: title, position: brief || '-', weakSpots: weak.map((w, i) => `${i + 1}. ${w}`).join('\n') || '-', date: formatRuDate(date), folder: folderDigest(run), language: lang(locale) }),
                schema: docSchema
            });
            return { kind: 'opponent' as const, title: r.data.title, text: r.data.text, date, generatedByAi: true };
        } catch {
            // The failure is in AiLog; the author's brief stands in for the document
        }
    }
    return { kind: 'opponent' as const, title, text: brief || title, date, generatedByAi: false };
}

// The student's work goes into the folder and on through the case
function studentDoc(instance: TaskInstanceDoc, attempt: AttemptDoc, date: string) {
    const a = attempt.answer as any;
    const title = instance.content?.title ?? '';
    let text = '';
    if (typeof a?.text === 'string') text = a.text;
    else if (typeof a?.document === 'string') text = a.document;
    else if (typeof a?.action === 'string') text = [a.action, a.court && `Суд: ${a.court}`, a.deadline && `Срок: ${formatRuDate(a.deadline)}`, a.fee != null && `Пошлина: ${a.fee}`].filter(Boolean).join('\n');
    else if (Array.isArray(a?.items)) text = a.items.map((it: any) => `«${it.quote ?? ''}» - ${it.comment ?? it.danger ?? ''}${it.replacement ? ` → ${it.replacement}` : ''}`).join('\n');
    return text.trim() ? { kind: 'student' as const, title, text: text.slice(0, 20000), date, generatedByAi: false } : null;
}

// ---------- Run lifecycle ----------

export async function startRun(trackId: string, userId: string, opts: { assignmentId?: string; isExam?: boolean } = {}) {
    const existing = await TrackRun.findOne({ trackId, userId, assignmentId: opts.assignmentId ?? null, status: 'active' });
    if (existing) return existing;
    const track = await Track.findById(trackId);
    const user = await User.findById(userId);
    if (!track || !user) throw new HttpError(404, 'not_found', 'Track not found');
    if (track.status !== 'published' && user.role === 'student') throw new HttpError(404, 'not_found', 'Track not found');
    const locale = (user.locale as Locale) || 'ru';
    const snapshot = track.toObject();
    const start = track.startDate || tashkentToday();
    const values = worldValues(snapshot, locale);
    const run = await TrackRun.create({
        trackId: track._id, userId: user._id, assignmentId: opts.assignmentId ?? null, isExam: Boolean(opts.isExam), language: locale,
        title: pick(track.title as any, locale), role: fillWorld(pick(track.role as any, locale), values), snapshot,
        values, currentDate: start,
        folder: (track.folder ?? []).map(f => ({ kind: 'case', title: fillWorld(pick(f.title as any, locale), values), text: fillWorld(pick(f.text as any, locale), values), date: f.date || start }))
    });
    await enterStage(run, track.firstStageKey, start, '');
    return run;
}

async function enterStage(run: TrackRunDoc, stageKey: string, date: string, reason: string) {
    const snapshot = run.snapshot as any;
    const stage = stageOf(snapshot, stageKey);
    if (!stage) throw new Error(`Stage ${stageKey} not found`);
    const user = await User.findById(run.userId);
    if (!user) throw new Error('User not found');
    if (stage.opponentBefore?.enabled) run.folder.push({ ...(await opponentDoc(run, stage, date)), stageKey });
    const instance = await generateInstance(String(stage.templateId), user, {
        assignmentId: run.assignmentId ? String(run.assignmentId) : undefined,
        isExam: run.isExam,
        locale: run.language as Locale,
        world: { today: date, values: run.values as WorldValues, runId: String(run._id), stageKey }
    });
    run.visits.push({ stageKey, title: pick(stage.title, run.language as Locale), date, instanceId: instance._id, setback: Boolean(stage.setback), reason });
    run.currentStageKey = stageKey;
    run.currentDate = date;
    await run.save();
    return instance;
}

// Called by the evaluation worker once a stage attempt is graded; safe to call twice
export async function advanceRun(instance: TaskInstanceDoc, attempt: AttemptDoc) {
    const run = await TrackRun.findById(instance.runId);
    if (!run || run.status !== 'active') return;
    const visit = run.visits.find(v => String(v.instanceId) === String(instance._id));
    if (!visit || visit.attemptId) return;
    const locale = run.language as Locale;
    const snapshot = run.snapshot as any;
    const stage = stageOf(snapshot, visit.stageKey!);
    visit.attemptId = attempt._id;
    visit.score = attempt.finalScore ?? 0;
    visit.xp = attempt.xpAwarded ?? 0;
    const doc = studentDoc(instance, attempt, visit.date!);
    if (doc) run.folder.push({ ...doc, stageKey: visit.stageKey! });

    // The first transition whose condition holds decides; otherwise the default way
    const fired = (stage?.transitions ?? []).find((t: any) => conditionHolds(t.condition, attempt));
    const next: string = fired?.next ?? stage?.defaultNext ?? 'outcome:loss';
    const courtAct: string = fired ? fired.courtAct : stage?.defaultCourtAct ?? '';
    const reason = fired ? (REASON_TEXT[fired.condition.kind]?.[locale]?.(fired.condition.param ?? '') ?? '') : '';
    visit.next = next;
    visit.courtAct = courtAct;
    visit.reason = reason;

    const nextStage = next.startsWith('outcome:') ? null : stageOf(snapshot, next);
    const date = addDays(run.currentDate!, nextStage?.daysAfter ?? 1);
    if (courtAct) run.folder.push({ ...(await courtActDoc(run, courtAct, reason, date)), stageKey: visit.stageKey! });

    if (!nextStage || run.visits.length >= MAX_VISITS) {
        await finishRun(run, nextStage ? 'loss' : next.slice('outcome:'.length));
        return;
    }
    await enterStage(run, next, date, reason);
}

// PRD 4.10: final score = 70% of the weighted stage scores + 30% of the outcome; completing the track doubles the stage XP
export async function finishRun(run: TrackRunDoc, outcome: string) {
    const snapshot = run.snapshot as any;
    const done = run.visits.filter(v => v.score != null);
    const weightOf = (k: string) => stageOf(snapshot, k)?.weight ?? 1;
    const wSum = done.reduce((a, v) => a + weightOf(v.stageKey!), 0);
    const stagesScore = wSum ? done.reduce((a, v) => a + weightOf(v.stageKey!) * (v.score ?? 0), 0) / wSum : 0;
    const setbacks = run.visits.filter(v => v.setback).length;
    const outcomeScore = Math.max(0, (OUTCOME_SCORE[outcome] ?? 0) - SETBACK_PENALTY * setbacks);
    run.status = 'finished';
    run.outcome = outcome;
    run.outcomeScore = outcomeScore;
    run.finalScore = Math.round(0.7 * stagesScore + 0.3 * outcomeScore);
    run.finishedAt = new Date();
    run.currentStageKey = '';
    if (!run.isExam) {
        const bonus = done.reduce((a, v) => a + (v.xp ?? 0), 0);
        if (bonus > 0) {
            await XpEvent.create({ userId: run.userId, amount: bonus, reason: 'track' });
            const user = await User.findById(run.userId);
            if (user) {
                user.xp += bonus;
                user.level = levelForXp(user.xp);
                await user.save();
            }
            run.xpBonus = bonus;
        }
    }
    if (outcome === 'win') await UserAchievement.updateOne({ userId: run.userId, code: 'case_closed' }, { $setOnInsert: { earnedAt: new Date() } }, { upsert: true });
    await run.save();
}

// Recovery: if the worker graded the stage but could not move the case, the next read moves it
export async function catchUpRun(run: TrackRunDoc) {
    if (run.status !== 'active') return run;
    const last = run.visits[run.visits.length - 1];
    if (!last || last.attemptId) return run;
    const attempt = await Attempt.findOne({ instanceId: last.instanceId, status: { $in: ['auto', 'needs_review', 'moderated'] } }).sort({ iteration: 1 });
    const instance = attempt ? await TaskInstance.findById(last.instanceId) : null;
    if (attempt && instance) {
        try {
            await advanceRun(instance, attempt);
        } catch (e: any) {
            logError(e, {}, { runId: String(run._id) });
        }
        return (await TrackRun.findById(run._id))!;
    }
    return run;
}
