import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Iteration 5: extraction of terms, AI template drafts, admin audit, weekly summary, grading eval, LLM cut-off - HTTP API with a stub LLM.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.LOGS_DIR = '/tmp/caselab-test-logs';
// Only for constructing ClaudeProvider in the provider test; every other call goes to the stub
process.env.ANTHROPIC_API_KEY = 'test-key';

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
const calls: string[] = [];
let generated: any = null;

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
    const res = await fetch(`${base}/api/v1${path}`, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

const criteria = (score: number) => ['accuracy', 'completeness', 'reasoning', 'form', 'language'].map(key => ({ key, score, comment: 'ok', quotes: [] }));

before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri('caselab');
    const { setLlmForTests } = await import('../src/modules/ai/claude.provider');
    setLlmForTests({
        async generateJson(req: any) {
            const s: string = req.system;
            let data: unknown;
            if (s.includes('черновик шаблона учебного задания')) { calls.push('template'); data = generated; }
            else if (s.includes('due diligence')) {
                calls.push('extraction');
                // Every text cell the code sent is judged as a match
                const indexes = [...String(req.user).matchAll(/^#(\d+) /gm)].map(m => Number(m[1]));
                const toJudge = String(req.user).split('<to_judge>')[1].split('</to_judge>')[0];
                data = {
                    criteria: criteria(90), errors: [], missing: [], feedback: 'Разбор таблицы', improvedVersion: '', confidence: 0.9, injectionSuspected: false,
                    cells: indexes.filter(i => toJudge.includes(`#${i} `)).map(index => ({ index, verdict: 'match', comment: 'по смыслу верно' }))
                };
            }
            else if (s.includes('отчет о его неделе')) { calls.push('weekly'); data = { summary: 'Ты тренировал сверку условий, половина ячеек верна.', strengths: ['Суммы'], focus: ['Ставь источник у каждого условия'] }; }
            else { calls.push('other'); data = { caseText: 'не используется в этом тесте, текст длиннее пятидесяти символов для схемы' }; }
            return { data: req.schema.parse(data), tokensIn: 1, tokensOut: 1, model: 'stub' };
        }
    });
    const { connect } = await import('../src/db');
    await connect();
    const { seed } = await import('../src/seed/index');
    await seed();
    const { createApp } = await import('../src/app');
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    server?.close();
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
    await mongo?.stop();
});

let adminToken = '';
async function loginAdmin() {
    if (adminToken) return adminToken;
    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-123' } });
    r = await api('/auth/change-password', { token: r.body.accessToken, body: { currentPassword: 'admin-pass-123', newPassword: 'admin-pass-456' } });
    adminToken = r.body.accessToken as string;
    return adminToken;
}
async function newStudent(email: string) {
    const r = await api('/auth/register', { body: { fullName: `Студент ${email}`, email, password: 'student-pass', course: 3, locale: 'ru' } });
    await api('/me', { method: 'PATCH', token: r.body.accessToken, body: { startLevel: 'beginner' } });
    return r.body.accessToken as string;
}

const SUPPLY = 'Договор поставки № 1. г. Ташкент, 01.03.2026. ООО «Альфа» (Поставщик) и ООО «Бета» (Покупатель) заключили договор. '
    + '3.1. Цена договора составляет 150 000 000 сум. 7.2. За просрочку поставки Поставщик уплачивает неустойку 0,1% за каждый день просрочки, но не более 10% цены. '
    + '9.1. Договор действует до 31.12.2026. 10.1. Споры рассматриваются в Ташкентском межрайонном экономическом суде.';
const LEASE = 'Договор аренды № 7. г. Ташкент, 10.01.2026. ООО «Гамма» (Арендодатель) и ООО «Бета» (Арендатор). '
    + '4.1. Арендная плата 12 000 000 сум в месяц. 8.1. При смене собственника Арендатора Арендодатель вправе отказаться от договора. 9.1. Срок аренды 11 месяцев.';

test('extraction of terms: template checks, hidden reference, cell-by-cell scoring, weekly summary and the grading eval', async () => {
    const { processOne } = await import('../src/jobs/evaluate-attempt.job');
    const admin = await loginAdmin();
    const doc = async (title: string, text: string) => {
        const r = await api('/admin/documents', { token: admin, body: { type: 'contract', title, language: 'ru', text, parties: [{ key: 'buyer', name: { ru: 'Покупатель', uz: '' } }], status: 'published' } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        return r.body.document._id as string;
    };
    const supply = await doc('Договор поставки № 1', SUPPLY);
    const lease = await doc('Договор аренды № 7', LEASE);

    const L = (ru: string) => ({ ru, uz: '' });
    const reference = [
        { documentId: supply, fieldKey: 'price', value: '150000000', quote: 'Цена договора составляет 150 000 000 сум' },
        { documentId: supply, fieldKey: 'penalty', value: '0,1% за каждый день просрочки, не более 10% цены', quote: 'неустойку 0,1% за каждый день просрочки, но не более 10% цены' },
        { documentId: supply, fieldKey: 'coc', absent: true },
        { documentId: lease, fieldKey: 'price', value: '12000000', quote: 'Арендная плата 12 000 000 сум в месяц' },
        { documentId: lease, fieldKey: 'penalty', absent: true },
        { documentId: lease, fieldKey: 'coc', value: 'yes', quote: 'При смене собственника Арендатора Арендодатель вправе отказаться от договора' }
    ];
    const tpl = {
        taskType: 'extraction_compare', difficulty: 2, skills: [{ key: 'claim.facts', weight: 1 }],
        title: L('Сверка договоров Бета'), instructions: L('Заполни таблицу условий по двум договорам клиента'), caseText: L('Клиент ООО «Бета» покупает бизнес и просит проверить договоры перед сделкой.'),
        extraction: {
            documentIds: [supply, lease],
            fields: [
                { key: 'price', label: L('Цена'), kind: 'money', hint: L('Сумма цифрами') },
                { key: 'penalty', label: L('Неустойка'), kind: 'text' },
                { key: 'coc', label: L('Change of control'), kind: 'bool' }
            ],
            reference
        },
        status: 'published'
    };
    let r = await api('/admin/templates', { token: admin, body: { ...tpl, extraction: { ...tpl.extraction, reference: reference.slice(0, 5) } } });
    assert.equal(r.status, 400, 'every term of every document needs a reference cell');
    r = await api('/admin/templates', { token: admin, body: { ...tpl, extraction: { ...tpl.extraction, reference: reference.map((c, i) => (i === 0 ? { ...c, quote: 'Такого текста нет' } : c)) } } });
    assert.equal(r.status, 400, 'a reference quote must be in the document');
    r = await api('/admin/templates', { token: admin, body: { ...tpl, extraction: { ...tpl.extraction, reference: reference.map((c, i) => (i === 0 ? { ...c, value: 'сто пятьдесят' } : c)) } } });
    assert.equal(r.status, 400, 'a sum is given in digits');
    r = await api('/admin/templates', { token: admin, body: tpl });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.template.mode, 'review', 'scored with the analysis weights');
    const tplId = r.body.template._id;

    const student = await newStudent('extract@test.local');
    r = await api(`/tasks/from-template/${tplId}`, { token: student, body: {} });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const inst = r.body.instance;
    assert.equal(inst.content.extraction.documents.length, 2);
    assert.equal(inst.content.extraction.fields[0].hint, 'Сумма цифрами', 'hints on level 2');
    assert.equal(JSON.stringify(inst).includes('150000000'), false, 'the reference values are not sent');

    const sel = (text: string, quote: string) => ({ quote, from: text.indexOf(quote), to: text.indexOf(quote) + quote.length });
    const cells = [
        { documentId: supply, fieldKey: 'price', value: '150 000 000', ...sel(SUPPLY, '150 000 000 сум') },
        { documentId: supply, fieldKey: 'penalty', value: 'пеня 0,1% в день, максимум 10%', ...sel(SUPPLY, '0,1% за каждый день просрочки') },
        { documentId: supply, fieldKey: 'coc', absent: true },
        { documentId: lease, fieldKey: 'price', value: '12000000' },
        { documentId: lease, fieldKey: 'penalty', value: '5% от суммы' }
    ];
    r = await api('/attempts', { token: student, body: { instanceId: inst.id, answer: { cells: [{ ...cells[0], quote: 'не то' }] } } });
    assert.equal(r.status, 400, 'a source must match the document');
    r = await api('/attempts', { token: student, body: { instanceId: inst.id, answer: { cells: [{ documentId: supply, fieldKey: 'nope', value: 'x' }] } } });
    assert.equal(r.status, 400, 'unknown terms are refused');
    r = await api('/attempts', { token: student, body: { instanceId: inst.id, answer: { cells, notes: 'В аренде нет неустойки' } } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const attemptId = r.body.attempt.id;
    await processOne();
    assert.equal(calls.filter(c => c === 'extraction').length, 1);

    r = await api(`/attempts/${attemptId}`, { token: student });
    let a = r.body.attempt;
    const det = a.deterministic;
    assert.equal(det.kind, 'extraction');
    assert.equal(det.total, 6);
    // price, penalty (AI: match), "not in the document" and the lease price are right; the invented penalty is wrong; change of control is empty
    assert.deepEqual([det.correct, det.partial, det.wrong, det.empty], [4, 0, 1, 1]);
    assert.equal(det.score, 67);
    const cell = (d: string, k: string) => det.cells.find((c: any) => c.documentId === d && c.fieldKey === k);
    assert.equal(cell(supply, 'penalty').status, 'correct', 'the AI judged the meaning of the text term');
    assert.equal(cell(lease, 'price').sourceOk, false, 'no source for the lease price');
    assert.equal(cell(supply, 'price').expected, null, 'the reference opens later');
    const crit = (k: string) => a.criteria.find((c: any) => c.key === k).score;
    assert.equal(crit('accuracy'), 67, 'accuracy capped by the cells');
    assert.equal(crit('completeness'), 83, '5 of 6 cells answered');
    assert.equal(crit('reasoning'), 50, 'sources for 2 of 4 values');
    assert.equal(a.items.find((i: any) => i.index === cell(supply, 'penalty').index).comment, 'по смыслу верно');

    r = await api(`/attempts/instances/${inst.id}/close`, { token: student, body: {} });
    assert.equal(r.status, 200);
    a = (await api(`/attempts/${attemptId}`, { token: student })).body.attempt;
    assert.deepEqual(a.deterministic.cells.find((c: any) => c.documentId === lease && c.fieldKey === 'coc').expected, { value: 'yes', absent: false, quote: reference[5].quote });

    // ---- Weekly summary: written once per week from the aggregates ----
    r = await api('/me/weekly-summary', { token: student });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.summary.stats.attempts, 1);
    assert.ok(r.body.summary.summary.includes('сверку условий'));
    assert.deepEqual(r.body.summary.focus, ['Ставь источник у каждого условия']);
    r = await api('/me/weekly-summary', { token: student });
    assert.equal(calls.filter(c => c === 'weekly').length, 1, 'kept until the next week');
    const idle = await newStudent('idle@test.local');
    r = await api('/me/weekly-summary', { token: idle });
    assert.deepEqual(r.body, { summary: null, reason: 'no_activity' });

    // ---- Grading eval: the moderated attempt is graded again and compared with the teacher ----
    const aiScore = a.finalScore;
    r = await api(`/teacher/moderation/${attemptId}`, { token: admin, body: { criteria: ['accuracy', 'completeness', 'reasoning', 'form', 'language'].map(key => ({ key, score: 50 })), comment: 'Строже' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const { evalGrading } = await import('../src/scripts/eval-grading');
    const report = await evalGrading({ limit: 10, taskType: 'extraction_compare', maxMae: 10, out: '' });
    assert.equal(report.attempts, 1);
    assert.equal(report.graded, 1);
    assert.equal(report.rows[0].teacher, 50);
    assert.equal(report.rows[0].aiBefore, aiScore);
    assert.equal(report.rows[0].aiNow, aiScore, 'the same stub gives the same grade');
    assert.equal(report.maeNow, Math.abs(50 - aiScore));
    const { Attempt } = await import('../src/modules/attempts/attempt.model');
    assert.equal((await Attempt.findById(attemptId).lean())!.finalScore, 50, 'the eval saves nothing');
});

test('AI template draft: codes and placeholders are cleaned, problems are reported, the draft is saved', async () => {
    const admin = await loginAdmin();
    const empty = {
        title: 'Карточка после возвращения иска', instructions: 'Определи следующее действие, суд и срок обжалования определения', role: 'Юрист истца',
        caseText: 'Суд вернул иск ООО «Дельта» о взыскании {{debt}}. Определение вынесено {{actDate}}, представитель {{lawyer}} получил его через неделю.',
        variables: [
            { key: 'debt', kind: 'money', label: 'Долг', min: 90000000, max: 50000000, step: 1000000, options: [] },
            { key: 'actDate', kind: 'date', label: 'Дата определения', min: -10, max: -3, step: 1, options: [] },
            { key: 'bad key', kind: 'money', label: '', min: 0, max: 1, step: 1, options: [] }
        ],
        referenceAnswer: 'Частная жалоба на определение о возвращении в течение месяца (ст. 155 ЭПК).', checklist: ['Вид жалобы', 'Срок'],
        relatedNorms: [{ code: 'ЭПК', article: '155' }], scaffold: [], lockedDocument: '',
        acceptableCourts: ['Ташкентский городской суд'], deadlineRuleCode: 'claim_return_complaint', eventDateVar: 'actDate',
        feeRateCode: 'no_such_rate', feeAmountVar: 'debt', draftDocType: '', instructionsHidden: '',
        timelineEvents: [], timelineChecks: [], clientFacts: [], routes: []
    };
    generated = empty;
    let r = await api('/admin/templates/generate', { token: admin, body: { taskType: 'proc_next_step', topic: 'обжалование возвращения иска', skills: ['claim.facts'], difficulty: 3, language: 'ru' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    let t = r.body.template;
    assert.equal(t.status, 'draft');
    assert.equal(t.source, 'ai');
    assert.equal(t.mode, 'process');
    assert.deepEqual(t.variablesSchema.map((v: any) => v.key), ['debt', 'actDate'], 'invalid keys dropped');
    assert.deepEqual([t.variablesSchema[0].min, t.variablesSchema[0].max], [50000000, 90000000], 'range put in order');
    assert.ok(!t.caseText.ru.includes('{{lawyer}}') && t.caseText.ru.includes('{{debt}}'), 'a placeholder without a variable becomes a word');
    assert.equal(t.process.deadline.ruleCode, 'claim_return_complaint');
    assert.equal(t.process.deadline.eventDateVar, 'actDate');
    assert.equal(t.process.fee.rateCode, '', 'unknown fee rate dropped');
    assert.deepEqual(r.body.problems, []);

    // A route to a body that does not exist: the steps are dropped and the editor is told what is missing
    generated = { ...empty, clientFacts: [{ key: 'Receipt', text: 'Чек сохранился', onRequest: true }], routes: [{ score: 100, comment: '', steps: [{ bodyCode: 'no-such-body', basis: '', deadline: '', pretrial: false }] }] };
    r = await api('/admin/templates/generate', { token: admin, body: { taskType: 'route_and_apply', topic: 'возврат некачественного товара', skills: ['claim.facts'], difficulty: 2, language: 'ru' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    t = r.body.template;
    assert.deepEqual(t.route.clientFacts.map((f: any) => f.key), ['receipt']);
    assert.equal(t.route.acceptableRoutes.length, 0);
    assert.ok(r.body.problems.some((p: any) => p.message.includes('acceptable route')), JSON.stringify(r.body.problems));

    r = await api('/admin/templates/generate', { token: admin, body: { taskType: 'mines', topic: 'договор подряда', skills: ['claim.facts'], language: 'ru' } });
    assert.equal(r.status, 400, 'analysis drafts start from a generated document');
});

test('admin audit: changing requests are logged with secrets hidden, students are not logged', async () => {
    const admin = await loginAdmin();
    await api('/admin/users', { token: admin, body: { email: 'not-an-email', fullName: 'Тест', role: 'student', password: 'secret-value' } });
    const student = await newStudent('audit@test.local');
    await api('/me', { method: 'PATCH', token: student, body: { startLevel: 'middle' } });
    // The log is written after the response
    await new Promise(res => setTimeout(res, 200));
    let r = await api('/admin/audit', { token: admin });
    assert.equal(r.status, 200);
    const users = r.body.items.find((i: any) => i.path === '/api/v1/admin/users');
    assert.ok(users, 'the failed user creation is logged');
    assert.equal(users.status, 400);
    assert.ok(users.body.includes('[hidden]') && !users.body.includes('secret-value'), users.body);
    assert.ok(r.body.items.some((i: any) => i.action === 'POST /api/v1/admin/templates' && i.status === 201));
    assert.ok(r.body.items.some((i: any) => i.action === 'POST /api/v1/teacher/moderation/:id'), 'admin actions outside the admin panel too');
    assert.ok(!r.body.items.some((i: any) => i.path === '/api/v1/me'), 'student requests are not logged');
    r = await api('/admin/audit?failed=1', { token: admin });
    assert.ok(r.body.items.length && r.body.items.every((i: any) => i.status >= 400));
    r = await api('/admin/audit', { token: student });
    assert.equal(r.status, 403);
});

test('Claude provider: cache breakpoints, model routing, structured output, cut-off and schema retry', async () => {
    const { ClaudeProvider } = await import('../src/modules/ai/claude.provider');
    const { z } = await import('zod');
    const p = new ClaudeProvider();
    const schema = z.object({ title: z.string().min(3) });
    const calls: any[] = [];
    const msg = (text: string, extra: any = {}) => ({
        model: extra.model ?? 'claude-sonnet-5-5', stop_reason: extra.stop ?? 'end_turn', content: [{ type: 'text', text }],
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: extra.write ?? 0, cache_read_input_tokens: extra.read ?? 0 }
    });
    let replies: any[] = [];
    (p as any).client = { messages: { create: async (params: any) => { calls.push(params); return replies.shift(); } } };

    // Grading: shared rules, prompt instructions and context are cached, the student's answer is not
    replies = [msg('{"title":"ok title"}', { read: 900 })];
    const r = await p.generateJson({ task: 'evaluate', shared: 'общие правила', system: 'инструкции', context: 'рубрика', user: 'ответ', schema });
    const c = calls[0];
    assert.equal(c.model, 'claude-sonnet-5-5');
    assert.deepEqual(c.system.map((b: any) => [b.text, b.cache_control?.type]), [['общие правила', 'ephemeral'], ['инструкции', 'ephemeral']]);
    assert.deepEqual(c.messages[0].content.map((b: any) => [b.text.slice(0, 7), Boolean(b.cache_control)]), [['рубрика', true], ['ответ', false]]);
    assert.deepEqual(c.thinking, { type: 'adaptive' });
    assert.equal(c.output_config.effort, 'medium');
    assert.equal(c.output_config.format.type, 'json_schema');
    assert.equal(c.output_config.format.schema.additionalProperties, false, 'the SDK helper prepared the schema');
    assert.equal('temperature' in c, false);
    assert.equal(r.tokensIn, 1000);
    assert.equal(r.cacheRead, 900);
    assert.equal(r.costUsd, Math.round(((100 * 2 + 50 * 10 + 900 * 0.1) / 1e6) * 1e6) / 1e6);

    // Short texts go to Haiku with thinking off; Sonnet without thinking answers "between tools"
    replies = [msg('{"title":"case text"}', { model: 'claude-haiku-5-5' }), msg('{"title":"court doc"}')];
    await p.generateJson({ task: 'clientReply', system: 's', user: 'u', schema });
    await p.generateJson({ task: 'generateOpponentDoc', system: 's', user: 'u', schema });
    assert.equal(calls[1].model, 'claude-haiku-5-5');
    assert.deepEqual(calls[1].thinking, { type: 'disabled' });
    assert.equal(calls[1].messages[0].content.length, 1, 'no context block when there is no context');
    assert.deepEqual(calls[2].thinking, { type: 'between_tools' });

    // A model for one task from LLM_TASK_MODELS
    process.env.LLM_TASK_MODELS = 'clientReply=claude-opus-5-5';
    const { env } = await import('../src/config/env');
    (env() as any).LLM_TASK_MODELS = 'clientReply=claude-opus-5-5';
    replies = [msg('{"title":"opus answer"}', { model: 'claude-opus-5-5' })];
    await p.generateJson({ task: 'clientReply', system: 's', user: 'u', schema });
    assert.equal(calls[3].model, 'claude-opus-5-5');
    assert.equal(calls[3].thinking, undefined, 'Opus cannot turn thinking off');
    (env() as any).LLM_TASK_MODELS = undefined;

    // Schema miss: one retry, the note goes after the cached blocks
    replies = [msg('{"title":"x"}'), msg('{"title":"fixed"}')];
    const fixed = await p.generateJson({ task: 'evaluate', system: 'инструкции', context: 'рубрика', user: 'ответ', schema });
    assert.equal(fixed.data.title, 'fixed');
    assert.equal(calls[5].messages[0].content.length, 3);
    assert.ok(calls[5].messages[0].content[2].text.includes('title'));
    assert.equal(fixed.tokensOut, 100, 'both calls counted');

    // A cut-off answer fails with the task, the model and the limit
    replies = [msg('{"title": "Догов', { stop: 'max_tokens' })];
    await assert.rejects(p.generateJson({ task: 'generateFlawedDocument', system: 's', user: 'u', schema }), /cut off at max_tokens=20000 \(task generateFlawedDocument/);

    // Batch answers are validated the same way and cost half
    const b = p.batch.parse(msg('{"title":"batch ok"}'), { task: 'evaluate', system: 's', user: 'u', schema });
    assert.equal(b.costUsd, Math.round(((100 * 2 + 50 * 10) / 2 / 1e6) * 1e6) / 1e6);
});

test('content pack: dry run, update by key, tracks by reference, export round trip, teacher rules', async () => {
    const admin = await loginAdmin();
    const L = (ru: string) => ({ ru, uz: `${ru} (uz)` });
    const pack = {
        // A file in the format from before the rename still imports
        format: 'lexhackathon-content', version: 1,
        documents: [{ key: 'pack.doc.lease', type: 'contract', title: 'Аренда склада', language: 'ru', text: 'Арендатор платит 10 000 000 сум в месяц. Арендодатель вправе в одностороннем порядке повысить плату. Прочие условия обычные.', parties: [{ key: 'tenant', name: L('Арендатор') }], flaws: [{ quote: 'в одностороннем порядке повысить плату', badFor: 'tenant' }] }],
        templates: [
            { key: 'pack.tpl.review', taskType: 'review_contract', difficulty: 2, skills: [{ key: 'claim.facts', weight: 1 }], title: L('Аренда: риски арендатора'), instructions: L('Проверь договор'), caseText: L('Клиент снимает склад.'), documentRef: 'pack.doc.lease', review: { clientSide: 'tenant' } },
            { key: 'pack.tpl.card', taskType: 'proc_next_step', difficulty: 2, skills: [{ key: 'claim.facts', weight: 1 }], title: L('Карточка'), instructions: L('Определи действие'), caseText: L('Суд вернул иск.'), referenceAnswer: L('Частная жалоба'), process: { deadline: { ruleCode: 'claim_return_complaint' } } },
            { key: 'pack.tpl.broken', taskType: 'review_contract', difficulty: 2, skills: [{ key: 'claim.facts', weight: 1 }], title: L('Битая ссылка'), instructions: L('x'), caseText: L('x'), documentRef: 'no.such.doc', review: { clientSide: 'tenant' } }
        ],
        tracks: [{ key: 'pack.track', title: L('Мини-дело'), stages: [{ key: 'card', title: L('Карточка'), templateRef: 'pack.tpl.card', defaultNext: 'outcome:win' }], firstStageKey: 'card' }]
    };
    let r = await api('/admin/import?dryRun=1', { token: admin, body: pack });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dryRun, true);
    assert.deepEqual(r.body.created, { documents: 1, scenarios: 0, templates: 2, tracks: 1, bodies: 0 });
    assert.equal(r.body.errors.length, 1);
    assert.ok(r.body.errors[0].message.includes('no.such.doc'), r.body.errors[0].message);
    r = await api('/admin/templates', { token: admin });
    assert.ok(!r.body.templates.some((x: any) => x.title.ru === 'Карточка'), 'the dry run wrote nothing');

    r = await api('/admin/import', { token: admin, body: pack });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.created, { documents: 1, scenarios: 0, templates: 2, tracks: 1, bodies: 0 });
    r = await api('/admin/tracks', { token: admin });
    const track = r.body.tracks.find((x: any) => x.title.ru === 'Мини-дело');
    assert.ok(track);
    const { TaskTemplate } = await import('../src/modules/content/content.model');
    const card = await TaskTemplate.findOne({ importKey: 'pack.tpl.card' }).lean();
    const review = await TaskTemplate.findOne({ importKey: 'pack.tpl.review' }).lean();
    assert.equal(card!.status, 'draft');
    r = await api(`/admin/tracks/${track._id}`, { token: admin });
    assert.equal(String(r.body.track.stages[0].templateId), String(card!._id), 'the stage points to the imported template');

    // The admin publishes; a repeated import of the same keys updates the records and keeps the status
    await TaskTemplate.updateOne({ _id: card!._id }, { status: 'published' });
    r = await api('/admin/import', { token: admin, body: { ...pack, templates: [{ ...pack.templates[1], title: L('Карточка v2') }] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.updated, { documents: 1, scenarios: 0, templates: 1, tracks: 1, bodies: 0 });
    assert.deepEqual(r.body.created, { documents: 0, scenarios: 0, templates: 0, tracks: 0, bodies: 0 });
    const card2 = await TaskTemplate.findOne({ importKey: 'pack.tpl.card' }).lean();
    assert.equal(card2!.title.ru, 'Карточка v2');
    assert.equal(card2!.status, 'published', 'an updated record keeps its status');
    assert.equal(await TaskTemplate.countDocuments({ importKey: 'pack.tpl.card' }), 1);

    // Export of the track: its template, nothing else; importing it back updates the same records
    r = await api(`/admin/import/export?trackIds=${track._id}`, { token: admin });
    assert.equal(r.status, 200);
    assert.equal(r.body.format, 'caselab-content');
    assert.equal(r.body.tracks.length, 1);
    assert.equal(r.body.templates.length, 1);
    assert.equal(r.body.tracks[0].stages[0].templateRef, 'pack.tpl.card');
    r = await api(`/admin/import/export?templateIds=${review!._id}`, { token: admin });
    assert.equal(r.body.templates[0].documentRef, 'pack.doc.lease');
    assert.equal(r.body.documents.length, 1);
    assert.equal(r.body.documents[0].flaws[0].from, undefined, 'ranges are recomputed on import');
    const exported = r.body;
    r = await api('/admin/import', { token: admin, body: exported });
    assert.deepEqual(r.body.updated, { documents: 1, scenarios: 0, templates: 1, tracks: 0, bodies: 0 }, JSON.stringify(r.body));
    // Records without a key get "tpl-<id>": the round trip on this server updates them
    r = await api('/admin/import/export', { token: admin });
    const demo = r.body.templates.find((x: any) => x.key.startsWith('tpl-'));
    assert.ok(demo, 'seeded templates have no pack key');
    r = await api('/admin/import?dryRun=1', { token: admin, body: { templates: [demo] } });
    assert.equal(r.body.updated.templates, 1, JSON.stringify(r.body.errors));

    // Teacher: documents and templates go to review; scenarios, tracks and other people's keys are refused
    const { User } = await import('../src/modules/users/user.model');
    const bcrypt = (await import('bcryptjs')).default;
    const org = (await User.findOne({ role: 'admin' }).lean())!.organizationId;
    await User.create({ email: 'packteacher@test.local', fullName: 'Преподаватель', role: 'teacher', passwordHash: await bcrypt.hash('teacher-pass', 10), organizationId: org, mustChangePassword: false });
    r = await api('/auth/login', { body: { email: 'packteacher@test.local', password: 'teacher-pass' } });
    const teacher = r.body.accessToken;
    assert.ok(teacher, JSON.stringify(r.body));
    r = await api('/teacher/content/import', { token: teacher, body: {
        documents: [{ ...pack.documents[0], key: 'teacher.doc' }],
        templates: [{ ...pack.templates[0], key: 'teacher.tpl', documentRef: 'teacher.doc', status: 'published' }, { ...pack.templates[1] }],
        scenarios: [{ title: 'Сценарий', language: 'ru', roles: [{ key: 'a', name: 'Истец' }], startNodeId: 'n1', nodes: [{ id: 'n1', text: 'Начало' }, { id: 'n2', text: 'Конец', outcome: 'win' }] }]
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.created, { documents: 1, scenarios: 0, templates: 1, tracks: 0, bodies: 0 });
    assert.equal(r.body.errors.length, 2, JSON.stringify(r.body.errors));
    assert.ok(r.body.errors.some((e: any) => e.kind === 'scenario'));
    assert.ok(r.body.errors.some((e: any) => e.key === 'pack.tpl.card' && e.message.includes('published')), 'the admin template is not the teacher\'s to update');
    assert.equal((await TaskTemplate.findOne({ importKey: 'teacher.tpl' }).lean())!.status, 'review');
});
