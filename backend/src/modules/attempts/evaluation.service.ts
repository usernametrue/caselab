import { z } from 'zod';
import { Attempt, CRITERIA, ScoringConfig, type AttemptDoc, type Criterion } from './attempt.model';
import { TaskInstance, type TaskInstanceDoc } from '../tasks/task.model';
import { TaskTemplate, type TaskTemplateDoc } from '../content/content.model';
import { aiAvailable, aiGenerate } from '../ai/ai.service';
import { LlmUnavailableError } from '../ai/llm-provider';
import { escapeBlock, languageName, loadPrompt, render } from '../ai/prompts';
import { normExists } from '../legal/legal.service';
import { applyAttemptResult } from '../gamification/gamification.service';
import { checkDecisions, containsValue, matchReview, reviewScores } from '../review/review-engine';
import { scoreMines } from '../review/mines-engine';
import { compareCells, scoreExtraction, type AiVerdict } from '../review/extraction-engine';
import { checkRoute } from '../route/route-engine';
import { scorePath } from '../sim/sim-engine';
import { buildProtocol, STUDENT, type HearingScenario, type HearingState } from '../hearing/hearing-engine';
import { bodyNames } from '../legal/bodies-import';
import { advanceRun } from '../tracks/track.service';
import { logError } from '../../logger';
import { pick } from '../../utils/localized';

// ---------- Defaults (PRD 5.1) ----------

export const DEFAULT_WEIGHTS: Record<string, Record<Criterion, number>> = {
    draft: { accuracy: 30, completeness: 25, reasoning: 20, form: 15, language: 10 },
    review: { accuracy: 30, completeness: 30, reasoning: 25, form: 5, language: 10 },
    process: { accuracy: 45, completeness: 15, reasoning: 25, form: 10, language: 5 },
    route: { accuracy: 30, completeness: 20, reasoning: 20, form: 20, language: 10 },
    sim: { accuracy: 25, completeness: 15, reasoning: 30, form: 15, language: 15 }
};

export const ERROR_TYPES = [
    'wrong_norm', 'missing_requisite', 'deadline_calc', 'wrong_fee', 'wrong_court', 'wrong_amount',
    'missing_fact', 'wrong_prayer', 'logic_gap', 'ambiguous_wording', 'form_violation', 'missing_attachment', 'inconsistent_with_document',
    'missed_risk', 'false_risk', 'against_client', 'weak_fix', 'wrong_decision', 'wrong_action', 'missing_consequences',
    'wrong_body', 'missed_pretrial', 'wrong_qualification', 'missed_question', 'missed_act_error', 'wrong_correction', 'weak_argument',
    'wrong_document_type', 'missed_violation', 'false_violation',
    'wrong_extraction', 'missed_term', 'invented_term', 'missing_source'
] as const;

// Default rubrics (levels 0/25/50/75/100); a template may override them
const RUBRICS: Record<string, Record<Criterion, string>> = {
    draft: {
        accuracy: '0 - нормы применены неверно или не применены; 25 - грубые ошибки в нормах, суде, суммах; 50 - основное верно, есть существенные ошибки; 75 - мелкие неточности; 100 - нормы, суд, суммы и требования верны',
        completeness: '0 - документ не составлен; 25 - отсутствует большая часть обязательных элементов чек-листа; 50 - половина элементов; 75 - не хватает одного-двух второстепенных элементов; 100 - все элементы чек-листа на месте',
        reasoning: '0 - нет обоснования; 25 - позиция заявлена без ссылок на нормы и доказательства; 50 - ссылки есть, логика с пробелами; 75 - позиция обоснована, есть слабые места; 100 - каждое требование связано с фактами, доказательствами и нормой',
        form: '0 - не соответствует виду документа; 25 - структура нарушена; 50 - структура есть, не хватает реквизитов формы; 75 - мелкие нарушения формы; 100 - форма и реквизиты соответствуют требованиям',
        language: '0 - текст непригоден; 25 - много неоднозначных и бытовых формулировок; 50 - стиль неровный; 75 - отдельные неточные формулировки; 100 - точный однозначный юридический язык'
    },
    review: {
        accuracy: '0 - риски определены неверно; 25 - большая часть комментариев ошибочна или правки вредят клиенту; 50 - риски названы, но нормы и последствия указаны с ошибками; 75 - мелкие неточности в нормах или квалификации риска; 100 - каждый риск верно квалифицирован для клиента, нормы точны',
        completeness: '0 - ничего не найдено; 25 - найдено меньше трети значимых рисков; 50 - половина; 75 - пропущены второстепенные риски; 100 - найдены все значимые для клиента риски',
        reasoning: '0 - нет комментариев; 25 - комментарий без объяснения риска; 50 - риск объяснен без нормы или без последствий для клиента; 75 - объяснение с нормой, есть пробелы; 100 - в чем риск, для кого, какая норма и чем грозит',
        form: '0 - правки невозможно применить; 50 - правки разрознены, не привязаны к пунктам; 100 - каждая правка привязана к фрагменту и готова к внесению в документ',
        language: '0 - новые редакции непригодны; 25 - неоднозначные бытовые формулировки; 50 - неровно; 75 - отдельные неточности; 100 - новые редакции однозначны и защищают клиента'
    },
    process: {
        accuracy: '0 - действие, суд и расчеты неверны; 25 - верно одно поле из нескольких; 50 - действие верно, расчеты с ошибками; 75 - мелкая неточность; 100 - действие, суд, срок и пошлина верны',
        completeness: '0 - карточка не заполнена; 50 - заполнена половина полей; 75 - нет последствий пропуска срока или основания подсудности; 100 - все поля заполнены',
        reasoning: '0 - нет обоснований; 25 - числа без расчета; 50 - расчет есть, без норм; 75 - расчет и нормы с пробелами; 100 - каждый вывод опирается на статью ЭПК и расчет по шагам',
        form: '0 - неверный вид документа; 50 - вид документа назван неточно; 100 - верный вид процессуального документа и порядок подачи',
        language: '0 - непонятно; 50 - бытовые формулировки; 100 - точная процессуальная терминология'
    },
    route: {
        accuracy: '0 - ситуация квалифицирована неверно, органы некомпетентны; 25 - верна отрасль, неверны права и орган; 50 - квалификация в целом верна, ошибки в основаниях и сроках; 75 - мелкие неточности; 100 - квалификация, органы, основания и сроки верны',
        completeness: '0 - нет квалификации и маршрута; 25 - не выяснены ключевые факты, пропущены шаги; 50 - часть фактов уточнена, маршрут неполон; 75 - не хватает второстепенного; 100 - ключевые факты уточнены у клиента, маршрут и обращение полные',
        reasoning: '0 - нет обоснования; 25 - органы названы без оснований; 50 - основания есть, логика с пробелами; 75 - обоснованно, есть слабые места; 100 - каждый шаг маршрута опирается на норму и факты',
        form: '0 - обращение не составлено или адресовано не тому органу; 25 - вид обращения неверен; 50 - вид верен, не хватает реквизитов, приложений, пошлины; 75 - мелкие нарушения формы; 100 - обращение соответствует первому органу маршрута и требованиям к форме',
        language: '0 - текст непригоден; 50 - бытовые формулировки; 75 - отдельные неточности; 100 - ясный юридический язык, понятный адресату'
    },
    sim: {
        accuracy: '0 - процессуальные действия неверны; 25 - большинство решений ошибочны; 50 - половина решений верна; 75 - мелкие ошибки; 100 - все процессуальные решения верны',
        completeness: '0 - процесс не пройден; 50 - пропущены важные процессуальные возможности; 100 - использованы все возможности защиты позиции',
        reasoning: '0 - нет обоснований; 25 - обоснования без норм; 50 - нормы есть, логика с пробелами; 75 - убедительно, есть слабые места; 100 - каждое обоснование опирается на норму ЭПК и обстоятельства дела',
        form: '0 - реплики не соответствуют стадии заседания; 50 - порядок обращения к суду нарушен; 100 - реплики уместны для стадии и соответствуют процессуальному этикету',
        language: '0 - непонятно; 50 - бытовые формулировки; 100 - точная процессуальная речь'
    }
};

// Task types whose work differs from the mode's default rubric
const RUBRICS_BY_TYPE: Record<string, Record<Criterion, string>> = {
    proc_draft: RUBRICS.draft,
    sim_hearing: {
        accuracy: '0 - правовая позиция неверна или не заявлена; 25 - грубые ошибки в нормах и процессуальных правах; 50 - позиция в целом верна, нормы с ошибками; 75 - мелкие неточности; 100 - позиция и ссылки на ЭПК и ГК точны',
        completeness: '0 - студент почти не участвовал; 25 - цели большинства стадий не достигнуты; 50 - часть процессуальных возможностей упущена; 75 - упущено второстепенное; 100 - заявлены все нужные ходатайства, возражения и доводы, цель роли достигнута',
        reasoning: '0 - нет аргументов; 25 - утверждения без опоры на факты и нормы; 50 - аргументы есть, ответы на возражения слабые; 75 - убедительно, есть пробелы; 100 - каждый довод связан с фактами, доказательствами и нормой, возражения оппонента отражены',
        form: '0 - реплики не соответствуют заседанию; 25 - постоянные нарушения порядка и обращения к суду; 50 - этикет неровный, реплики не по стадии; 75 - отдельные нарушения; 100 - обращение к суду, порядок выступлений и уместность реплик соблюдены',
        language: '0 - речь непонятна; 50 - бытовая речь; 75 - отдельные неточности; 100 - ясная, уверенная процессуальная речь'
    },
    extraction_compare: {
        accuracy: '0 - условия извлечены неверно; 25 - верна меньшая часть ячеек; 50 - половина; 75 - мелкие неточности в отдельных условиях; 100 - каждое условие передано точно, отсутствующие условия отмечены верно',
        completeness: '0 - таблица не заполнена; 25 - заполнено меньше трети; 50 - половина; 75 - пропущены отдельные ячейки; 100 - заполнены все условия всех документов',
        reasoning: '0 - нет источников; 25 - источники у отдельных ячеек; 50 - у половины; 75 - у большинства, есть неточные фрагменты; 100 - у каждого значения есть точный фрагмент документа',
        form: '0 - значения нельзя использовать в отчете; 50 - форматы дат и сумм неровные, значения перемешаны с комментариями; 100 - даты, суммы и да/нет в едином формате, таблица готова к отчету',
        language: '0 - формулировки искажают условия; 50 - пересказ с потерей деталей; 100 - условия переданы точным юридическим языком'
    },
    review_admin_act: {
        accuracy: '0 - нарушения определены неверно; 25 - большая часть выводов ошибочна; 50 - нарушения названы, нормы и последствия с ошибками; 75 - мелкие неточности; 100 - каждое нарушение квалифицировано верно, нормы точны',
        completeness: '0 - ничего не найдено; 25 - найдено меньше трети нарушений; 50 - половина; 75 - пропущены второстепенные; 100 - найдены все нарушения, значимые для заявителя',
        reasoning: '0 - нет комментариев; 25 - нарушение без объяснения; 50 - без нормы или без последствий; 75 - с нормой, есть пробелы; 100 - что нарушено, какой нормой и чего добиваться (отмена, изменение акта)',
        form: '0 - замечания невозможно использовать; 50 - замечания не привязаны к пунктам акта; 100 - каждое замечание привязано к фрагменту и готово для жалобы',
        language: '0 - непригодно; 50 - бытовые формулировки; 100 - точный язык административного права'
    },
    proc_timeline: {
        accuracy: '0 - сроки и нарушения определены неверно; 25 - верен один срок из нескольких; 50 - половина сроков верна; 75 - мелкая неточность; 100 - все сроки и нарушения определены верно',
        completeness: '0 - хронология не построена; 50 - учтена половина процессуальных сроков; 100 - учтены все сроки и нарушения сторон и суда',
        reasoning: '0 - нет обоснований; 25 - даты без расчета; 50 - расчет без норм; 75 - расчет и нормы с пробелами; 100 - каждый срок рассчитан по шагам со ссылкой на статью ЭПК',
        form: '0 - хронология не читается; 50 - события перепутаны; 100 - хронология последовательна, нарушения привязаны к событиям',
        language: '0 - непонятно; 50 - бытовые формулировки; 100 - точная процессуальная терминология'
    },
    review_court_act: {
        accuracy: '0 - ошибки акта определены неверно; 25 - большая часть исправлений ошибочна; 50 - ошибки названы, нормы и исправления с ошибками; 75 - мелкие неточности; 100 - каждое нарушение квалифицировано верно, исправления точны, даты и суммы совпадают',
        completeness: '0 - ничего не найдено; 25 - найдено меньше трети ошибок; 50 - половина; 75 - пропущены второстепенные; 100 - найдены все ошибки акта',
        reasoning: '0 - нет комментариев; 25 - не указано, что нарушено; 50 - нарушение названо без нормы; 75 - с нормой, есть пробелы; 100 - что нарушено, в какой части акта и какой нормой ЭПК',
        form: '0 - исправления невозможно внести в акт; 50 - исправления не привязаны к частям акта; 100 - каждое исправление готово к внесению',
        language: '0 - исправленный текст непригоден; 50 - неровно; 100 - исправления в стиле судебного акта и в графике оригинала'
    },
    mines: {
        accuracy: '0 - опасность формулировок не понята; 25 - большинство замен не устраняет опасность; 50 - половина замен верна; 75 - мелкие неточности; 100 - каждая замена устраняет опасность',
        completeness: '0 - мины не найдены; 25 - найдено меньше трети; 50 - половина; 75 - пропущены второстепенные; 100 - найдены все мины',
        reasoning: '0 - опасность не объяснена; 50 - объяснение без последствий; 100 - одной фразой точно сказано, чем грозит формулировка',
        form: '0 - замены невозможно вставить в текст; 100 - каждая замена встает на место исходной фразы',
        language: '0 - замены непригодны; 50 - неоднозначные формулировки; 100 - замены однозначны'
    }
};

// ---------- Shared output pieces ----------

const criteriaZod = z.array(z.object({
    key: z.enum(CRITERIA),
    score: z.number().min(0).max(100),
    comment: z.string(),
    quotes: z.array(z.string()).max(5)
})).length(5);

const errorsZod = z.array(z.object({
    errorType: z.enum(ERROR_TYPES),
    skillKey: z.string(),
    quote: z.string(),
    comment: z.string(),
    normRef: z.string()
})).max(15);

const commonZod = {
    criteria: criteriaZod,
    errors: errorsZod,
    missing: z.array(z.string()).max(15),
    feedback: z.string(),
    improvedVersion: z.string(),
    confidence: z.number().min(0).max(1),
    injectionSuspected: z.boolean()
};

const draftSchema = z.object({
    ...commonZod,
    extracted: z.object({
        court: z.string().nullable(),
        plaintiff: z.string().nullable(),
        defendant: z.string().nullable(),
        claimAmount: z.number().nullable(),
        fee: z.number().nullable(),
        attachments: z.array(z.string())
    })
});

const reviewSchema = z.object({
    ...commonZod,
    items: z.array(z.object({ index: z.number().int().min(0), verdict: z.enum(['strong', 'partial', 'weak']), comment: z.string() })).max(60),
    extras: z.array(z.object({ index: z.number().int().min(0), justified: z.boolean(), comment: z.string() })).max(60)
});

const timelineSchema = z.object({
    ...commonZod,
    items: z.array(z.object({ index: z.number().int().min(0), verdict: z.enum(['strong', 'partial', 'weak']), comment: z.string() })).max(40)
});

const routeSchema = z.object({
    ...commonZod,
    steps: z.array(z.object({ index: z.number().int().min(0), comment: z.string() })).max(10),
    fields: z.array(z.object({ field: z.enum(['qualification', 'route', 'document', 'questions']), comment: z.string() })).max(4)
});

const simSchema = z.object({
    ...commonZod,
    items: z.array(z.object({ index: z.number().int().min(0), verdict: z.enum(['strong', 'partial', 'weak']), comment: z.string() })).max(40)
});

const hearingEvalSchema = z.object({
    ...commonZod,
    items: z.array(z.object({ index: z.number().int().min(0), verdict: z.enum(['strong', 'partial', 'weak']), comment: z.string() })).max(40),
    outcome: z.enum(['win', 'partial', 'loss']),
    outcomeReason: z.string()
});

const extractionSchema = z.object({
    ...commonZod,
    cells: z.array(z.object({ index: z.number().int().min(0), verdict: z.enum(['match', 'partial', 'mismatch']), comment: z.string() })).max(75)
});

const processSchema = z.object({
    ...commonZod,
    fields: z.array(z.object({ field: z.enum(['action', 'court', 'deadline', 'fee', 'consequences']), comment: z.string() })).max(5)
});

const normalize = (s: string) => s.toLowerCase().replace(/[«»"'`ʻʼ’]/g, '').replace(/\s+/g, ' ').trim();
const courtMatches = (actual: string | null | undefined, acceptable: string[]) => {
    const a = actual ? normalize(actual) : '';
    return Boolean(a) && acceptable.some(c => a.includes(normalize(c)) || normalize(c).includes(a));
};

// Code-side comparison of the extracted requisites with the engine results (PRD 4.1, 5.2)
export function deterministicCheck(engine: any, extracted: z.infer<typeof draftSchema>['extracted']) {
    if (!engine || engine.kind !== 'claim_requisites') return null;
    const checks: { key: string; ok: boolean; expected: unknown; actual: unknown; explanation?: string[] }[] = [];
    if (engine.amount != null) {
        checks.push({ key: 'claim_amount', ok: extracted.claimAmount === engine.amount, expected: engine.amount, actual: extracted.claimAmount });
    }
    if (engine.fee != null) {
        checks.push({ key: 'fee', ok: extracted.fee === engine.fee, expected: engine.fee, actual: extracted.fee, explanation: engine.feeSteps });
    }
    if (engine.acceptableCourts?.length) {
        checks.push({ key: 'court', ok: courtMatches(extracted.court, engine.acceptableCourts), expected: engine.acceptableCourts, actual: extracted.court });
    }
    if (!checks.length) return null;
    const score = Math.round(100 * checks.filter(c => c.ok).length / checks.length);
    return { score, checks };
}

// Procedural card: court, last day and fee compared exactly with the engines (PRD 4.4)
export function processCheck(engine: any, answer: any) {
    const checks: { key: string; ok: boolean; expected: unknown; actual: unknown; explanation?: string[]; justified?: boolean }[] = [];
    const justified = (s: unknown) => typeof s === 'string' && s.trim().length >= 15;
    if (engine?.courts?.length) {
        checks.push({ key: 'court', ok: courtMatches(answer.court, engine.courts), expected: engine.courts, actual: answer.court || null, justified: justified(answer.courtBasis) });
    }
    if (engine?.deadline?.endDate) {
        checks.push({ key: 'deadline', ok: answer.deadline === engine.deadline.endDate, expected: engine.deadline.endDate, actual: answer.deadline || null, explanation: engine.deadline.steps, justified: justified(answer.deadlineCalc) });
    }
    if (engine?.fee && engine.fee.fee != null) {
        checks.push({ key: 'fee', ok: Number(answer.fee) === engine.fee.fee, expected: engine.fee.fee, actual: answer.fee ?? null, explanation: engine.fee.steps, justified: justified(answer.feeCalc) });
    }
    if (!checks.length) return null;
    const score = Math.round(100 * checks.filter(c => c.ok).length / checks.length);
    // A correct number without a calculation gives 0 for reasoning on that field (PRD 4.0)
    const reasoningCap = Math.round(100 * checks.filter(c => c.justified).length / checks.length);
    return { score, checks, reasoningCap };
}

export function weightedScore(criteria: { key: string; score: number }[], weights: Record<string, number>) {
    let sum = 0;
    let total = 0;
    for (const c of criteria) {
        const w = weights[c.key] ?? 0;
        sum += w * c.score;
        total += w;
    }
    return total ? Math.round(sum / total) : 0;
}

export const scoreLabel = (score: number) => (score >= 86 ? 'excellent' : score >= 71 ? 'good' : score >= 56 ? 'satisfactory' : 'repeat');

export class EvaluationDeferred extends Error {}

// ---------- Per-type evaluators ----------

interface EvalContext {
    attempt: AttemptDoc;
    instance: TaskInstanceDoc;
    template: TaskTemplateDoc;
    lang: string;
    rubric: string;
}

interface EvalResult {
    out: z.infer<typeof draftSchema> | z.infer<typeof reviewSchema> | z.infer<typeof processSchema> | z.infer<typeof routeSchema> | z.infer<typeof simSchema> | z.infer<typeof timelineSchema>;
    model: string;
    promptVersion: string;
    deterministic: any;
    // Upper bounds the code puts on AI scores per criterion
    caps: Partial<Record<Criterion, number>>;
    reviewReasons: string[];
}

// The grading rules every evaluate-* prompt shares go first, so all graders read them from one cache entry
let sharedRules: string | null = null;
const gradingRules = () => (sharedRules ??= loadPrompt('_grading-common', 2).system.replace('{{errorTypes}}', ERROR_TYPES.join(', ')));

async function callLlm<T>(ctx: EvalContext, name: string, schema: z.ZodType<T>, vars: Record<string, string>) {
    if (!aiAvailable()) throw new EvaluationDeferred('LLM is not configured (ANTHROPIC_API_KEY)');
    const prompt = loadPrompt(name, 2);
    try {
        const res = await aiGenerate({
            task: 'evaluate',
            purpose: `evaluate:${name}`,
            attemptId: ctx.attempt._id,
            promptVersion: prompt.version,
            shared: gradingRules(),
            ...render(prompt, { rubric: ctx.rubric, skillKeys: ctx.template.skills.map(s => s.key).join(', '), language: ctx.lang, ...vars }),
            schema
        });
        return { data: res.data, model: res.model, promptVersion: prompt.version };
    } catch (e: any) {
        if (e instanceof LlmUnavailableError) throw new EvaluationDeferred(e.message);
        throw e;
    }
}

const taskBlock = (i: TaskInstanceDoc) => {
    const c = i.content!;
    return `${c.title}\n${c.instructions}\nРоль студента: ${c.role || '-'}\nСегодня в мире задания: ${c.today}`;
};

async function evaluateDraft(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine ?? null;
    const content = instance.content!;
    // proc_draft: the expected document type; from level 3 choosing it is part of the "form" criterion
    const v = instance.expected?.values as any;
    const docTypeLine = v?.docType ? `\nНужный вид документа: ${v.docType}${v.docTypeHidden ? ' (студент определяет вид документа сам; неверный вид документа - ошибка wrong_document_type и низкий балл form)' : ''}` : '';
    const res = await callLlm(ctx, 'evaluate-draft', draftSchema, {
        task: taskBlock(instance) + docTypeLine,
        caseText: escapeBlock(content.caseText),
        lockedDocument: content.lockedDocument ? escapeBlock(content.lockedDocument) : '-',
        referenceAnswer: instance.expected?.referenceAnswer || '-',
        checklist: (instance.expected?.checklist ?? []).map((c, i) => `${i + 1}. ${c}`).join('\n') || '-',
        engineResult: engine ? JSON.stringify({ claimAmount: engine.amount, fee: engine.fee, feeCalculation: engine.feeSteps, acceptableCourts: engine.acceptableCourts }) : '-',
        studentAnswer: escapeBlock(String((attempt.answer as any)?.text ?? ''))
    });
    const det = deterministicCheck(engine, res.data.extracted);
    const aiAccuracy = res.data.criteria.find(c => c.key === 'accuracy')?.score ?? 0;
    return {
        out: res.data,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: det,
        caps: det ? { accuracy: det.score } : {},
        reviewReasons: det && aiAccuracy > 70 && det.checks.some(c => !c.ok) ? ['engine_mismatch'] : []
    };
}

async function evaluateReviewContract(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine as any;
    const items: any[] = (attempt.answer as any)?.items ?? [];
    const match = matchReview(engine.flaws, engine.clientSide, items);
    const flawById = new Map(engine.flaws.map((f: any) => [f.id, f]));

    const res = await callLlm(ctx, 'evaluate-review', reviewSchema, {
        task: taskBlock(instance),
        clientGoals: instance.content?.clientGoals || '-',
        documentText: escapeBlock(instance.content?.documentText ?? ''),
        referenceMarkup: engine.flaws.map((f: any) => `[${f.id}] badFor=${f.badFor}; "${f.quote}"; ${f.type}; ${f.normRef}; ${f.explanation}; fix: ${f.fix}`).join('\n'),
        engineResult: JSON.stringify({
            targets: match.targets.length,
            found: match.found.map(x => ({ item: x.itemIndex, flaw: x.flawId })),
            missed: match.missed,
            extra: match.extras,
            againstClient: match.againstClient.map(x => ({ item: x.itemIndex, flaw: x.flawId }))
        }),
        studentWork: escapeBlock(items.map((it, i) => `#${i}: "${it.quote}"\nКомментарий: ${it.comment}\nНовая редакция: ${it.replacement || '(оставить без правки)'}`).join('\n\n') || '(нет правок)'),
        clientSide: instance.content?.clientSideName || engine.clientSide,
        modeDescription: instance.taskType === 'review_admin_act'
            ? 'Задание - проверить административный акт (решение органа) на законность в интересах клиента: выделить нарушения, указать норму и написать, чего добиваться (отмена или изменение акта). Новая редакция - как должно быть по закону.'
            : 'Задание - проверить документ и внести правки как при редлайне: выделить опасные фрагменты, объяснить риск и предложить новую редакцию.'
    });

    // Only extras flagged by the engine can be justified
    const justified = res.data.extras.filter(x => x.justified && match.extras.includes(x.index)).length;
    const scores = reviewScores(match, justified);
    const reasons: string[] = [];
    if (justified > 0) reasons.push('markup_candidate');
    return {
        out: res.data,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: {
            score: scores.completeness,
            kind: 'review',
            targets: match.targets.length,
            found: match.found,
            missed: match.missed.map(id => ({ flawId: id, severity: (flawById.get(id) as any)?.severity })),
            extras: match.extras,
            justifiedExtras: res.data.extras.filter(x => x.justified && match.extras.includes(x.index)).map(x => x.index),
            againstClient: match.againstClient,
            accuracyCap: scores.accuracyCap
        },
        caps: { completeness: scores.completeness, accuracy: scores.accuracyCap },
        reviewReasons: reasons
    };
}

async function evaluateFixCheck(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine as any;
    const decisions: any[] = (attempt.answer as any)?.decisions ?? [];
    const check = checkDecisions(engine.edits, engine.clientSide, decisions);
    const res = await callLlm(ctx, 'evaluate-review', reviewSchema, {
        task: taskBlock(instance),
        clientGoals: instance.content?.clientGoals || '-',
        documentText: escapeBlock(instance.content?.documentText ?? ''),
        referenceMarkup: engine.edits.map((e: any) => `[${e.id}] "${e.quote}" -> "${e.replacement}"; вредит: ${e.badFor}; ${e.explanation}`).join('\n'),
        engineResult: JSON.stringify(check.results),
        studentWork: escapeBlock(engine.edits.map((e: any, i: number) => {
            const d = decisions.find(x => x.editId === e.id);
            return `#${i} [${e.id}] правка "${e.quote}" -> "${e.replacement}"\nРешение: ${d?.decision ?? 'нет'}\nОбоснование: ${d?.reason ?? ''}\nКонтрпредложение: ${d?.counter || '-'}`;
        }).join('\n\n')),
        clientSide: instance.content?.clientSideName || engine.clientSide,
        modeDescription: 'Задание - ответить на правки контрагента: принять или отклонить каждую с обоснованием и написать контрпредложение там, где правка вредит клиенту. Поле extras оставь пустым.'
    });
    // A rejected harmful edit without a counter-proposal is incomplete work
    const harmful = check.results.filter(r => r.needsCounter);
    const withCounter = harmful.filter(r => r.decision === 'reject' && r.hasCounter).length;
    const completenessCap = harmful.length ? Math.round(100 * (0.5 + 0.5 * withCounter / harmful.length)) : 100;
    return {
        out: res.data,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: { score: check.score, kind: 'fix_check', results: check.results },
        caps: { accuracy: check.score, completeness: completenessCap },
        reviewReasons: []
    };
}

async function evaluateProcess(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine as any;
    const a = attempt.answer as any;
    const det = processCheck(engine, a);
    const res = await callLlm(ctx, 'evaluate-process', processSchema, {
        task: taskBlock(instance),
        caseText: escapeBlock(instance.content?.caseText ?? ''),
        referenceAnswer: instance.expected?.referenceAnswer || '-',
        checklist: (instance.expected?.checklist ?? []).map((c, i) => `${i + 1}. ${c}`).join('\n') || '-',
        engineResult: JSON.stringify({
            lastDay: engine?.deadline?.endDate ?? null,
            deadlineRule: engine?.deadline?.articleRef ?? null,
            fee: engine?.fee?.fee ?? null,
            acceptableCourts: engine?.courts ?? [],
            studentFieldsCorrect: det?.checks.map(c => ({ field: c.key, ok: c.ok, justified: c.justified })) ?? []
        }),
        studentCard: escapeBlock([
            `Действие и документ: ${a.action || '-'}`,
            `Суд: ${a.court || '-'}`,
            `Основание подсудности: ${a.courtBasis || '-'}`,
            `Последний день срока: ${a.deadline || '-'}`,
            `Расчет срока: ${a.deadlineCalc || '-'}`,
            `Госпошлина: ${a.fee ?? '-'}`,
            `Расчет пошлины: ${a.feeCalc || '-'}`,
            `Последствия пропуска срока: ${a.consequences || '-'}`
        ].join('\n'))
    });
    const aiAccuracy = res.data.criteria.find(c => c.key === 'accuracy')?.score ?? 0;
    return {
        out: res.data,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: det ? { ...det, kind: 'process' } : null,
        caps: det ? { accuracy: det.score, reasoning: det.reasoningCap } : {},
        reviewReasons: det && aiAccuracy > 70 && det.checks.some(c => !c.ok) ? ['engine_mismatch'] : []
    };
}

// "Where to apply": the route is compared by code with the author's routes; questions to the client feed completeness
async function evaluateRoute(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine as any;
    const a = attempt.answer as any;
    const steps: { bodyCode: string; basis: string; deadline: string }[] = a.steps ?? [];
    const codes = steps.map(x => x.bodyCode);
    const det = checkRoute(engine.routes ?? [], codes);
    const names = await bodyNames([...new Set([...codes, ...(engine.routes ?? []).flatMap((r: any) => r.steps.map((x: any) => x.bodyCode))])], instance.language as any);
    const facts: { key: string; text: string; onRequest: boolean }[] = engine.facts ?? [];
    const onRequest = facts.filter(f => f.onRequest).map(f => f.key);
    const revealed: string[] = ((instance.expected?.values as any)?.revealedFacts ?? []).filter((k: string) => onRequest.includes(k));
    // Key facts the client tells only when asked: their share caps completeness (PRD 4.5)
    const completenessCap = onRequest.length ? Math.round(60 + 40 * revealed.length / onRequest.length) : undefined;
    const dialog = instance.content?.clientDialog ?? [];
    const res = await callLlm(ctx, 'evaluate-route', routeSchema, {
        task: taskBlock(instance),
        caseText: escapeBlock(instance.content?.caseText ?? ''),
        facts: facts.map(f => `[${f.key}]${f.onRequest ? ' (клиент сообщает только по запросу)' : ''} ${f.text}`).join('\n') || '-',
        dialog: escapeBlock(dialog.map(d => `Студент: ${d.question}\nКлиент: ${d.answer}`).join('\n\n')) || '(вопросов не было)',
        routes: (engine.routes ?? []).map((r: any, i: number) => `Маршрут ${i + 1} (${r.score === 100 ? 'оптимальный' : 'допустимый'}): ${r.steps.map((x: any) => `${names[x.bodyCode] ?? x.bodyCode}${x.pretrial ? ' [досудебный]' : ''} - ${x.basis}; срок: ${x.deadline || '-'}`).join(' -> ')}${r.comment ? `. ${r.comment}` : ''}`).join('\n') || '-',
        referenceAnswer: instance.expected?.referenceAnswer || '-',
        checklist: (instance.expected?.checklist ?? []).map((c, i) => `${i + 1}. ${c}`).join('\n') || '-',
        engineResult: JSON.stringify(det ? {
            routeScore: det.score, optimal: det.optimal, matchedRoute: det.routeIndex == null ? null : det.routeIndex + 1,
            missingPretrialSteps: det.missingPretrial.map(c => names[c] ?? c), stepOrderOk: det.orderOk,
            bodiesOutsideAnyRoute: det.wrongBodies.map(c => names[c] ?? c),
            onRequestFactsRevealed: `${revealed.length} из ${onRequest.length}`
        } : { routes: 'не заданы' }),
        studentWork: escapeBlock([
            `Квалификация: ${a.qualification}`,
            'Маршрут:',
            ...steps.map((x, i) => `#${i}: ${names[x.bodyCode] ?? x.bodyCode}; основание: ${x.basis || '-'}; срок: ${x.deadline || '-'}`),
            'Обращение в первый орган:',
            a.document
        ].join('\n'))
    });
    const caps: Partial<Record<Criterion, number>> = {};
    if (det) caps.accuracy = det.score;
    if (completenessCap !== undefined) caps.completeness = completenessCap;
    return {
        out: { ...res.data, items: res.data.steps } as any,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: det ? { ...det, names, revealedFacts: revealed, onRequestTotal: onRequest.length } : null,
        caps,
        reviewReasons: []
    };
}

// Branching simulation: the verdicts of the choices are the author's; the AI grades justifications at key nodes
async function evaluateSim(ctx: EvalContext): Promise<EvalResult> {
    const { instance } = ctx;
    const engine = instance.expected?.engine as any;
    const sim = instance.content!.sim!;
    const det = scorePath(engine.scenario, sim.history as any, sim.currentNodeId);
    const res = await callLlm(ctx, 'evaluate-sim', simSchema, {
        task: taskBlock(instance),
        caseText: escapeBlock(instance.content?.caseText ?? ''),
        engineResult: JSON.stringify({ choicesScore: det.score, outcome: det.outcome, steps: det.steps.map(x => ({ index: x.index, stage: x.stage, verdict: x.verdict, keyNode: x.keyNode, criterion: x.freeTextRubric, authorExplanation: x.explanation, normRef: x.normRef })) }),
        studentPath: escapeBlock(det.steps.map(x => `#${x.index} [${x.stage}] Выбор: ${x.choiceText}${x.keyNode ? `\nОбоснование: ${x.justification || '-'}` : ''}`).join('\n\n')),
        role: sim.roleName || sim.role
    });
    return {
        out: { ...res.data, extras: [] } as any,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: det,
        caps: { accuracy: det.score },
        reviewReasons: []
    };
}

// Hearing simulation: the protocol comes from code, the AI grades how the role was played and the likely outcome
async function evaluateHearing(ctx: EvalContext): Promise<EvalResult> {
    const { instance } = ctx;
    const scenario = (instance.expected?.engine as any).scenario as HearingScenario;
    const state = instance.content!.hearing as HearingState;
    const protocol = buildProtocol(scenario, state, instance.content!.today);
    const stageTitle = (key: string) => scenario.stages.find(st => st.key === key)?.title ?? key;
    const replies = state.transcript.filter(e => e.speaker === STUDENT).map((e, index) => ({ index, stage: stageTitle(e.stage), text: e.text, voice: Boolean(e.voice) }));
    const res = await callLlm(ctx, 'evaluate-hearing', hearingEvalSchema, {
        task: taskBlock(instance),
        caseText: escapeBlock(scenario.caseText || instance.content?.caseText || ''),
        role: `${scenario.studentRole.name}. Цель: ${scenario.studentRole.goal || '-'}`,
        criteria: scenario.criteria.map(c => `- ${c.title}: ${c.description}`).join('\n') || '-',
        decisionGuide: scenario.decisionGuide || '-',
        transcript: escapeBlock(protocol),
        studentReplies: escapeBlock(replies.map(r => `#${r.index} [${r.stage}]${r.voice ? ' (голос)' : ''} ${r.text}`).join('\n') || '-')
    });
    const { outcome, outcomeReason, ...rest } = res.data;
    return {
        out: { ...rest, extras: [] } as any,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: { kind: 'hearing', score: null, outcome, outcomeReason, protocol, replies },
        caps: {},
        reviewReasons: []
    };
}

// "Mines": found, missed and false clicks come from code; the AI grades the free replacements
async function evaluateMines(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine as any;
    const m = instance.content!.mines!;
    const text = instance.content?.documentText ?? '';
    const items: any[] = (attempt.answer as any)?.items ?? [];
    const det = scoreMines(engine.mines, m.segments as any, m.clicks as any, items, Boolean(engine.simplified));
    const segText = (i: number) => (m.segments[i] ? text.slice(m.segments[i].from!, m.segments[i].to!) : '');
    const res = await callLlm(ctx, 'evaluate-review', reviewSchema, {
        task: taskBlock(instance),
        clientGoals: '-',
        documentText: escapeBlock(text),
        referenceMarkup: engine.mines.map((x: any) => `[${x.id}] "${x.quote}"; ${x.type}; ${x.normRef}; ${x.explanation}; безопасно: ${x.fix}`).join('\n'),
        engineResult: JSON.stringify({ mines: det.total, found: det.handled.map(h => ({ item: h.itemIndex, mine: h.mineId })), missed: det.missed, falseClicks: det.falseClicks, options: det.optionResults }),
        studentWork: escapeBlock(items.map((it, i) => {
            const chosen = it.optionIndex != null ? (engine.mines.find((x: any) => det.handled.some(h => h.itemIndex === i && h.mineId === x.id))?.options?.[it.optionIndex]?.text ?? '') : '';
            return `#${i}: "${segText(it.segment)}"\nЗамена: ${chosen || it.replacement || '-'}\nВ чем опасность: ${it.danger || '-'}`;
        }).join('\n\n') || '(мины не найдены)'),
        clientSide: 'сторона, подписывающая документ',
        modeDescription: 'Задание "мины": найти опасные формулировки, для каждой предложить безопасную замену и одной фразой сказать, в чем опасность. Поле extras оставь пустым.'
    });
    return {
        out: { ...res.data, extras: [] },
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: det,
        caps: { completeness: det.score, accuracy: det.accuracyCap },
        reviewReasons: []
    };
}

// Court acts: as the contract review, plus exact dates and sums in the corrections (PRD 4.3)
async function evaluateCourtAct(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine as any;
    const items: any[] = (attempt.answer as any)?.items ?? [];
    const match = matchReview(engine.flaws, 'both', items);
    const flawById = new Map<string, any>(engine.flaws.map((f: any) => [f.id, f]));
    const valueChecks = match.found.flatMap(x => {
        const f = flawById.get(x.flawId);
        if (!f?.expectedValue || f.expectedValue.kind === 'none' || !f.expectedValue.value) return [];
        return [{ flawId: x.flawId, itemIndex: x.itemIndex, kind: f.expectedValue.kind, ok: containsValue(String(items[x.itemIndex]?.replacement ?? ''), f.expectedValue.kind, f.expectedValue.value) }];
    });
    const res = await callLlm(ctx, 'evaluate-review', reviewSchema, {
        task: taskBlock(instance),
        clientGoals: instance.content?.clientGoals || '-',
        documentText: escapeBlock(instance.content?.documentText ?? ''),
        referenceMarkup: engine.flaws.map((f: any) => `[${f.id}] часть ${f.segmentKey || '-'}; "${f.quote}"; ${f.type}; ${f.normRef}; ${f.explanation}; в оригинале: ${f.fix}`).join('\n') || '(в акте нет ошибок)',
        engineResult: JSON.stringify({
            errors: match.targets.length,
            found: match.found.map(x => ({ item: x.itemIndex, flaw: x.flawId })),
            missed: match.missed,
            extra: match.extras,
            exactValues: valueChecks.map(v => ({ item: v.itemIndex, kind: v.kind, ok: v.ok }))
        }),
        studentWork: escapeBlock(items.map((it, i) => `#${i}: "${it.quote}"\nЧто нарушено: ${it.comment}\nИсправление: ${it.replacement || '-'}`).join('\n\n') || '(студент считает, что ошибок нет)'),
        clientSide: 'законность акта (стажер проверяет акт как помощник судьи перед подписанием или юрист перед обжалованием)',
        modeDescription: 'Задание - найти в судебном акте ошибки по форме и содержанию, указать, что нарушено и какой нормой, и исправить текст. Пункты extras - то, что студент счел ошибкой, но чего нет в разметке: justified = true только для реального нарушения закона.'
    });
    const justified = res.data.extras.filter(x => x.justified && match.extras.includes(x.index)).length;
    const scores = reviewScores(match, justified);
    const valueErrors = valueChecks.filter(v => !v.ok).length;
    return {
        out: res.data,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: {
            score: scores.completeness,
            kind: 'court_act',
            targets: match.targets.length,
            found: match.found,
            missed: match.missed.map(id => ({ flawId: id, severity: flawById.get(id)?.severity })),
            extras: match.extras,
            justifiedExtras: res.data.extras.filter(x => x.justified && match.extras.includes(x.index)).map(x => x.index),
            againstClient: [],
            valueChecks
        },
        caps: { completeness: scores.completeness, accuracy: Math.max(0, scores.accuracyCap - 25 * valueErrors) },
        reviewReasons: justified > 0 ? ['markup_candidate'] : []
    };
}

// proc_timeline: last days and violations come from the engine, the AI grades the calculations and explanations
export function timelineCheck(engine: any, answer: any) {
    const rows: any[] = answer.deadlines ?? [];
    const justified = (s: unknown) => typeof s === 'string' && s.trim().length >= 15;
    const checks = (engine?.checks ?? []).map((c: any) => {
        const own = rows.filter(r => r.fromEventKey === c.fromEventKey);
        const hit = own.find(r => r.endDate === c.endDate);
        return {
            key: c.key, label: c.label, ok: Boolean(hit), expected: c.endDate, actual: (hit ?? own[0])?.endDate ?? null,
            explanation: c.steps, justified: justified((hit ?? own[0])?.calc), rowIndex: rows.indexOf(hit ?? own[0])
        };
    });
    const expected: string[] = engine?.violations ?? [];
    const marked = [...new Set((answer.violations ?? []).map((v: any) => String(v.eventKey)))] as string[];
    const found = marked.filter(k => expected.includes(k));
    const extra = marked.filter(k => !expected.includes(k));
    const deadlineScore = checks.length ? 100 * checks.filter((c: any) => c.ok).length / checks.length : 100;
    const violationScore = Math.max(0, (expected.length ? 100 * found.length / expected.length : 100) - 15 * extra.length);
    const score = Math.round(checks.length ? (deadlineScore + violationScore) / 2 : violationScore);
    const matched = checks.filter((c: any) => c.rowIndex >= 0);
    const reasoningCap = matched.length ? Math.round(100 * matched.filter((c: any) => c.justified).length / Math.max(1, checks.length)) : 0;
    return { kind: 'timeline', score, checks, violations: { expected, found, extra, missed: expected.filter(k => !found.includes(k)) }, reasoningCap };
}

async function evaluateTimeline(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine as any;
    const a = attempt.answer as any;
    const det = timelineCheck(engine, a);
    const events = instance.content?.timelineEvents ?? [];
    const title = (k: string) => events.find(e => e.key === k)?.title ?? k;
    const res = await callLlm(ctx, 'evaluate-timeline', timelineSchema, {
        task: taskBlock(instance),
        caseText: escapeBlock(instance.content?.caseText ?? ''),
        events: escapeBlock(events.map(e => `[${e.key}] ${e.date} - ${e.title}: ${e.text}`).join('\n')),
        engineResult: JSON.stringify({
            deadlines: engine.checks.map((c: any) => ({ deadline: c.label, from: title(c.fromEventKey), lastDay: c.endDate, rule: c.articleRef, violatedBy: c.violated ? title(c.toEventKey) : null })),
            studentDeadlinesCorrect: det.checks.map((c: any) => ({ deadline: c.label, ok: c.ok, justified: c.justified, studentRow: c.rowIndex })),
            violations: { found: det.violations.found.map(title), missed: det.violations.missed.map(title), extra: det.violations.extra.map(title) }
        }),
        studentWork: escapeBlock([
            'Сроки:',
            ...(a.deadlines ?? []).map((r: any, i: number) => `#${i}: от "${title(r.fromEventKey)}" - ${r.label || '-'}; последний день: ${r.endDate || '-'}; расчет: ${r.calc || '-'}`),
            'Нарушения:',
            ...(a.violations ?? []).map((v: any) => `"${title(v.eventKey)}": ${v.explanation || '-'}`),
            a.summary ? `Вывод: ${a.summary}` : ''
        ].join('\n'))
    });
    const aiAccuracy = res.data.criteria.find(c => c.key === 'accuracy')?.score ?? 0;
    return {
        out: { ...res.data, extras: [] } as any,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: det,
        caps: { accuracy: det.score, reasoning: det.reasoningCap },
        reviewReasons: aiAccuracy > 70 && det.score < 100 ? ['engine_mismatch'] : []
    };
}

// Extraction of terms (4.8): the code compares the cells, the AI judges the meaning of text terms only
async function evaluateExtraction(ctx: EvalContext): Promise<EvalResult> {
    const { instance, attempt } = ctx;
    const engine = instance.expected?.engine as any;
    const ex = instance.content?.extraction as any;
    const a = attempt.answer as any;
    const docTitle = new Map<string, string>((ex?.documents ?? []).map((d: any) => [d.id, d.title]));
    const field = new Map<string, any>((ex?.fields ?? []).map((f: any) => [f.key, f]));
    const first = compareCells(engine?.cells ?? [], a.cells ?? []);
    const ref: any[] = engine?.cells ?? [];
    const label = (c: { documentId: string; fieldKey: string }) => `${docTitle.get(c.documentId) ?? c.documentId} / ${field.get(c.fieldKey)?.label ?? c.fieldKey}`;
    const toJudge = first.filter(c => c.status === 'ai');
    const quoteOf = new Map<string, string>((a.cells ?? []).map((x: any) => [`${x.documentId}|${x.fieldKey}`, x.quote ?? '']));
    const res = await callLlm(ctx, 'evaluate-extraction', extractionSchema, {
        task: taskBlock(instance),
        documents: escapeBlock((ex?.documents ?? []).map((d: any) => `### ${d.title}\n${d.text}`).join('\n\n')),
        engineResult: JSON.stringify(first.map(c => ({
            index: c.index, cell: label(c),
            status: c.status === 'ai' ? 'needs_meaning_check' : c.status,
            source: c.needsSource ? (c.sourceOk ? 'ok' : 'missing_or_wrong') : 'not_needed'
        }))),
        toJudge: toJudge.length
            ? toJudge.map(c => `#${c.index} ${label(c)}\nЭталон: ${ref[c.index]?.value ?? ''}\nСтажер: ${escapeBlock(c.actual ?? '')}`).join('\n\n')
            : '-',
        studentWork: escapeBlock([
            ...first.map(c => {
                const quote = quoteOf.get(`${c.documentId}|${c.fieldKey}`);
                return `#${c.index} ${label(c)}: ${c.actualAbsent ? 'нет в документе' : c.actual || '-'}${quote ? ` (источник: "${quote}")` : ''}`;
            }),
            a.notes ? `Заметки: ${a.notes}` : ''
        ].join('\n'))
    });
    const verdicts = new Map<number, AiVerdict>(res.data.cells.filter(v => toJudge.some(c => c.index === v.index)).map(v => [v.index, v.verdict]));
    const det = scoreExtraction(first, verdicts);
    const aiAccuracy = res.data.criteria.find(c => c.key === 'accuracy')?.score ?? 0;
    return {
        // Verdicts on the text cells go to "items", so the result screen shows the AI comment next to the cell
        out: { ...res.data, items: res.data.cells, extras: [] } as any,
        model: res.model,
        promptVersion: res.promptVersion,
        deterministic: det,
        caps: { accuracy: det.score, completeness: det.completenessCap, reasoning: det.reasoningCap },
        reviewReasons: aiAccuracy > 70 && det.score < 50 ? ['engine_mismatch'] : []
    };
}

const EVALUATORS: Record<string, (ctx: EvalContext) => Promise<EvalResult>> = {
    draft_full: evaluateDraft,
    draft_part: evaluateDraft,
    review_contract: evaluateReviewContract,
    review_fix_check: evaluateFixCheck,
    review_court_act: evaluateCourtAct,
    review_admin_act: evaluateReviewContract,
    proc_draft: evaluateDraft,
    proc_timeline: evaluateTimeline,
    mines: evaluateMines,
    proc_next_step: evaluateProcess,
    route_and_apply: evaluateRoute,
    sim_branching: evaluateSim,
    sim_hearing: evaluateHearing,
    extraction_compare: evaluateExtraction
};

// ---------- Main pipeline (PRD 9.5) ----------

// The grade without saving anything: used by the worker below and by the prompt quality check (npm run eval:grading).
// weights: the eval passes the weights the attempt was graded with, so the scores compare one to one
export async function gradeAttempt(attempt: AttemptDoc, opts: { weights?: Record<string, number> } = {}) {
    const instance = await TaskInstance.findById(attempt.instanceId);
    if (!instance) throw new Error('Instance not found');
    const template = await TaskTemplate.findById(instance.templateId);
    if (!template) throw new Error('Template not found');
    const evaluator = EVALUATORS[instance.taskType];
    if (!evaluator) throw new Error(`No evaluator for ${instance.taskType}`);

    const lang = languageName(instance.language);
    const rubricOverride = template.rubric as Record<string, any> | null;
    const base = RUBRICS_BY_TYPE[instance.taskType] ?? RUBRICS[instance.mode] ?? RUBRICS.draft;
    const rubric = JSON.stringify(Object.fromEntries(CRITERIA.map(k => [k, rubricOverride?.[k] ? pick(rubricOverride[k], instance.language as any) : base[k]])));

    const r = await evaluator({ attempt, instance, template, lang, rubric });
    const out = r.out;

    const config = await ScoringConfig.findOne({ mode: instance.mode }).lean();
    const weights: Record<string, number> = opts.weights ?? { ...(config?.weights ?? DEFAULT_WEIGHTS[instance.mode] ?? DEFAULT_WEIGHTS.draft), ...((template.weightsOverride as any) ?? {}) };

    // Deterministic part overrides the AI where they overlap: the code sets an upper bound per criterion
    const criteriaFinal = CRITERIA.map(key => {
        const ai = out.criteria.find(c => c.key === key);
        let score = ai?.score ?? 0;
        let source = 'ai';
        const cap = r.caps[key];
        if (cap !== undefined) {
            score = Math.min(score, cap);
            source = 'engine+ai';
        }
        return { key, score: Math.round(score), weight: weights[key] ?? 0, source };
    });
    const reviewReasons = [...r.reviewReasons];
    if (out.confidence < 0.6) reviewReasons.push('low_confidence');
    if (out.injectionSuspected) reviewReasons.push('injection_suspected');

    const finalScore = weightedScore(criteriaFinal, weights);

    const errors = [];
    for (const e of out.errors) errors.push({ ...e, normVerified: e.normRef ? await normExists(e.normRef) : false });
    return { instance, template, r, out, criteriaFinal, finalScore, reviewReasons, errors };
}

export async function evaluateAttempt(attempt: AttemptDoc) {
    const { instance, template, r, out, criteriaFinal, finalScore, reviewReasons, errors } = await gradeAttempt(attempt);

    attempt.set({
        deterministic: { score: r.deterministic?.score ?? null, details: r.deterministic },
        ai: {
            criteria: out.criteria,
            errors,
            feedback: out.feedback,
            improvedVersion: out.improvedVersion,
            missing: out.missing,
            extracted: 'extracted' in out ? out.extracted : null,
            items: 'items' in out ? out.items : [],
            extras: 'extras' in out ? out.extras : [],
            fields: 'fields' in out ? out.fields : [],
            confidence: out.confidence,
            injectionSuspected: out.injectionSuspected,
            model: r.model,
            promptVersion: r.promptVersion
        },
        criteriaFinal,
        finalScore,
        status: reviewReasons.length ? 'needs_review' : 'auto',
        reviewReasons,
        lockedUntil: null,
        lastError: ''
    });

    // Best result on the instance: max(first, 0.7 * second) (PRD 4.0)
    const effective = attempt.iteration === 2 ? Math.round(finalScore * 0.7) : finalScore;
    instance.bestScore = Math.max(instance.bestScore ?? 0, effective);
    // A simulation is played once: the path cannot be reworked, the analysis opens right away
    if (instance.taskType === 'sim_branching' || instance.taskType === 'sim_hearing') instance.closed = true;
    // A stage of a case track has one iteration: the document goes on through the case (PRD 4.10)
    if (instance.runId) instance.closed = true;
    await instance.save();
    // Saved before the gamification step: achievements count this attempt too
    await attempt.save();

    const result = await applyAttemptResult({
        userId: attempt.userId,
        attemptId: attempt._id,
        score: finalScore,
        difficulty: instance.difficulty,
        taskType: instance.taskType,
        iteration: attempt.iteration,
        skills: template.skills.map(s => ({ key: s.key, weight: s.weight ?? 1 })),
        errors,
        isExam: instance.isExam,
        instanceId: instance._id,
        mode: instance.mode
    });
    attempt.xpAwarded = result.xp;
    await attempt.save();
    // The case moves on; a failure here does not undo the grade, the run catches up on the next read
    if (instance.runId) {
        try {
            await advanceRun(instance, attempt);
        } catch (e: any) {
            logError(e, {}, { runId: String(instance.runId), attemptId: String(attempt._id) });
        }
    }
    return { attempt, achievements: result.achievements };
}

export { Attempt };

// ---------- explainResult (PRD 10.2): why the student's number differs from the engine ----------

const explainSchema = z.object({ explanation: z.string().min(10) });

export async function explainCheck(attempt: AttemptDoc, instance: TaskInstanceDoc, key: string) {
    const cached = (attempt.explanations as Record<string, string> | null)?.[key];
    if (cached) return cached;
    const details = attempt.deterministic?.details as any;
    const check = (details?.checks ?? []).find((c: any) => c.key === key);
    if (!check || check.ok) return null;
    if (!aiAvailable()) throw new EvaluationDeferred('LLM is not configured');
    const a = attempt.answer as any;
    // The student's own calculation for this field, when the card or the timeline has one
    const calc = key === 'deadline' ? a.deadlineCalc : key === 'fee' ? a.feeCalc : key === 'court' ? a.courtBasis
        : (a.deadlines ?? [])[check.rowIndex ?? -1]?.calc ?? '';
    const prompt = loadPrompt('explain-result', 2);
    try {
        const r = await aiGenerate({
            task: 'explainResult',
            attemptId: attempt._id,
            promptVersion: prompt.version,
            ...render(prompt, {
                field: check.label || key,
                expected: Array.isArray(check.expected) ? check.expected.join('; ') : String(check.expected ?? '-'),
                steps: (check.explanation ?? []).map((s: string, i: number) => `${i + 1}. ${s}`).join('\n') || '-',
                actual: check.actual == null ? '(не указано)' : String(check.actual),
                calc: escapeBlock(String(calc || '-')),
                language: languageName(instance.language)
            }),
            schema: explainSchema
        });
        attempt.set(`explanations.${key}`, r.data.explanation);
        attempt.markModified('explanations');
        await attempt.save();
        return r.data.explanation;
    } catch (e: any) {
        if (e instanceof LlmUnavailableError) throw new EvaluationDeferred(e.message);
        throw e;
    }
}
