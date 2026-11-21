import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// "Where to apply", "mines", simulation, court acts, daily tasks, leaderboard, analytics, CSV through the HTTP API, stub LLM.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.LOGS_DIR = '/tmp/caselab-test-logs';

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
const calls: string[] = [];

async function api(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
    const res = await fetch(`${base}/api/v1${path}`, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let body: any = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* CSV */ }
    return { status: res.status, body, headers: res.headers };
}

const criteria = (score: number) => ['accuracy', 'completeness', 'reasoning', 'form', 'language'].map(key => ({ key, score, comment: 'ok', quotes: [] }));

const ACT = [
    'РЕШЕНИЕ',
    'Дело № 4-1001-2601/55',
    'Ташкентский межрайонный экономический суд, 10.03.2026',
    'Суд в составе председательствующего судьи А. рассмотрел иск о взыскании 50 000 000 сум.',
    'Суд установил, что ответчик не оплатил поставленный товар.',
    'РЕШИЛ: иск удовлетворить, взыскать госпошлину 1 600 000 сум. Решение вступает в силу через месяц.'
].join('\n');

before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri('caselab');
    const { setLlmForTests } = await import('../src/modules/ai/claude.provider');
    setLlmForTests({
        async generateJson(req: any) {
            const s: string = req.system;
            const common = { errors: [], missing: [], feedback: 'Разбор', improvedVersion: 'Лучше так', confidence: 0.9, injectionSuspected: false };
            let data: unknown;
            if (s.includes('рассказ клиента')) {
                calls.push('clientStory');
                const values = String(req.user.split('<values>')[1] ?? '').split('\n').map((l: string) => l.split(': ')[1]).filter(Boolean);
                data = { story: `Здравствуйте, я купил телефон, а он сломался. Сосед говорит, надо в прокуратуру. ${values.join(' ')}` };
            } else if (s.includes('роль клиента')) {
                calls.push('clientReply');
                const asksContract = req.user.split('<question>')[1].includes('договор');
                data = { answer: asksContract ? 'Да, чек и гарантийный талон есть.' : 'Не помню.', revealedFactKeys: asksContract ? ['receipt', 'made_up'] : [] };
            } else if (s.includes('по обращению клиента')) {
                calls.push('evaluateRoute');
                data = { ...common, criteria: criteria(90), steps: [{ index: 0, comment: 'верно' }], fields: [{ field: 'document', comment: 'ok' }] };
            } else if (s.includes('судебную симуляцию')) {
                calls.push('evaluateSim');
                data = { ...common, criteria: criteria(90), items: [{ index: 1, verdict: 'strong', comment: 'убедительно' }] };
            } else if (s.includes('вносишь ошибки в судебный акт')) {
                calls.push('injectErrors');
                data = {
                    text: ACT.replace('через месяц', 'через три месяца'),
                    flaws: [
                        { quote: 'через три месяца', original: 'через месяц', segmentKey: 'operative', type: 'срок', severity: 'high', normRef: 'ст. 185 ЭПК', explanation: 'неверный срок', expectedKind: 'none', expectedValue: '' },
                        { quote: 'этого нет', original: 'через месяц', segmentKey: 'operative', type: 'x', severity: 'low', normRef: '', explanation: '', expectedKind: 'none', expectedValue: '' }
                    ]
                };
            } else if (s.includes('старший юрист')) {
                calls.push('evaluateReview');
                data = { ...common, criteria: criteria(90), items: [], extras: [] };
            } else {
                calls.push('other');
                data = { caseText: 'не используется в этом тесте, текст длиннее пятидесяти символов для схемы' };
            }
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

async function loginAdmin() {
    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-123' } });
    r = await api('/auth/change-password', { token: r.body.accessToken, body: { currentPassword: 'admin-pass-123', newPassword: 'admin-pass-456' } });
    return r.body.accessToken as string;
}

async function newStudent(email: string, course = 3) {
    const r = await api('/auth/register', { body: { fullName: `Студент ${email}`, email, password: 'student-pass', course, locale: 'ru' } });
    await api('/me', { method: 'PATCH', token: r.body.accessToken, body: { startLevel: 'beginner' } });
    return r.body.accessToken as string;
}

test('iteration 3 trainers, gamification and analytics', async () => {
    const { processOne } = await import('../src/jobs/evaluate-attempt.job');
    const admin = await loginAdmin();
    const student = await newStudent('s3@test.local');
    let r;

    // ---- Bodies: the register snapshot is seeded, courts come from the courts dictionary ----
    r = await api('/bodies?q=' + encodeURIComponent('защите прав потребителей'), { token: student });
    const committee = r.body.bodies.find((b: any) => b.name.includes('Комитет по развитию конкуренции'));
    assert.ok(committee, JSON.stringify(r.body));
    r = await api('/bodies?q=' + encodeURIComponent('Министерство обороны'), { token: student });
    const defence = r.body.bodies[0];
    r = await api('/admin/dictionaries/courts', { token: admin, body: { name: { ru: 'Юнусабадский районный суд по гражданским делам', uz: '' }, level: 'district', region: 'Ташкент' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await api('/bodies?q=' + encodeURIComponent('Юнусабадский'), { token: student });
    const court = r.body.bodies[0];
    assert.equal(court.kind, 'court');
    assert.match(court.code, /^court-/);

    // ---- "Where to apply" ----
    const routeTpl = {
        taskType: 'route_and_apply', difficulty: 2, skills: [{ key: 'jurisdiction.subject', weight: 1 }],
        title: { ru: 'Сломанный телефон', uz: '' }, instructions: { ru: 'Разберитесь, куда обратиться, и составьте обращение', uz: '' },
        context: { role: { ru: 'Юрист клиента', uz: '' }, today: '2026-11-10' },
        caseText: { ru: 'Клиент купил телефон за {{price}}, через неделю он сломался, магазин отказал в замене.', uz: '' },
        variablesSchema: [{ key: 'price', kind: 'money', min: 5000000, max: 5000000, step: 1000 }],
        referenceAnswer: { ru: 'Претензия продавцу, затем жалоба в комитет или иск в суд', uz: '' },
        scaffold: [{ title: { ru: 'Адресат', uz: '' }, hint: { ru: 'Кому', uz: '' } }],
        route: {
            clientFacts: [
                { key: 'bought', text: { ru: 'Телефон куплен за {{price}}', uz: '' } },
                { key: 'receipt', text: { ru: 'Есть чек и гарантийный талон', uz: '' }, onRequest: true },
                { key: 'date', text: { ru: 'Покупка была 1 ноября', uz: '' }, onRequest: true }
            ],
            acceptableRoutes: [
                { score: 100, steps: [{ bodyCode: committee.code, basis: 'Закон о защите прав потребителей', pretrial: true }, { bodyCode: court.code, basis: 'ГПК' }] },
                { score: 70, steps: [{ bodyCode: court.code, basis: 'ГПК' }] }
            ]
        },
        status: 'published'
    };
    r = await api('/admin/templates', { token: admin, body: { ...routeTpl, route: { ...routeTpl.route, acceptableRoutes: [{ score: 70, steps: [{ bodyCode: court.code }] }] } } });
    assert.equal(r.status, 400, 'an optimal route is required');
    r = await api('/admin/templates', { token: admin, body: { ...routeTpl, route: { ...routeTpl.route, acceptableRoutes: [{ score: 100, steps: [{ bodyCode: 'no-such-body' }] }] } } });
    assert.equal(r.status, 400, 'route bodies must exist');
    r = await api('/admin/templates', { token: admin, body: routeTpl });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const routeTplId = r.body.template._id;

    r = await api(`/tasks/from-template/${routeTplId}`, { token: student, body: {} });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const routeInst = r.body.instance;
    assert.ok(routeInst.content.caseText.includes('Сосед говорит'), 'the client story is written by the AI');
    assert.equal(routeInst.content.scaffold.length, 1, 'scaffold on level 2');
    assert.equal(JSON.stringify(routeInst).includes('гарантийный талон'), false, 'facts on request are not shown');

    r = await api(`/tasks/instances/${routeInst.id}/ask-client`, { token: student, body: { question: 'Есть ли у вас договор или чек?' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.left, 2);
    await api(`/tasks/instances/${routeInst.id}/ask-client`, { token: student, body: { question: 'Когда это было?' } });
    await api(`/tasks/instances/${routeInst.id}/ask-client`, { token: student, body: { question: 'Что сказал магазин?' } });
    r = await api(`/tasks/instances/${routeInst.id}/ask-client`, { token: student, body: { question: 'Еще один вопрос?' } });
    assert.equal(r.status, 409, 'three questions at most');

    const routeAnswer = {
        qualification: 'Продан товар ненадлежащего качества, нарушено право потребителя на замену товара. Можно требовать замены или возврата денег.',
        steps: [{ bodyCode: committee.code, basis: 'Закон о защите прав потребителей', deadline: 'гарантийный срок' }, { bodyCode: court.code, basis: 'ГПК', deadline: '3 года' }],
        document: 'В Комитет по развитию конкуренции и защите прав потребителей. Жалоба на отказ в замене телефона. Приложения: чек.'
    };
    r = await api('/attempts', { token: student, body: { instanceId: routeInst.id, answer: { ...routeAnswer, steps: [{ bodyCode: 'reestr-999999' }] } } });
    assert.equal(r.status, 400, 'bodies must come from the dictionary');
    r = await api('/attempts', { token: student, body: { instanceId: routeInst.id, answer: routeAnswer } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    let a = r.body.attempt;
    assert.equal(a.deterministic.kind, 'route');
    assert.equal(a.deterministic.score, 100);
    assert.equal(a.deterministic.optimal, true);
    assert.equal(a.deterministic.revealedFacts, 1, 'unknown fact keys from the model are dropped');
    assert.equal(a.deterministic.onRequestTotal, 2);
    assert.equal(a.deterministic.routes, null, 'routes hidden before the reference');
    // completeness capped by the questions: 60 + 40 * 1/2 = 80
    assert.equal(a.criteria.find((c: any) => c.key === 'completeness').score, 80);
    assert.equal(a.items[0].comment, 'верно');

    // Second student goes to a body outside every route
    const student2 = await newStudent('s4@test.local', 2);
    r = await api(`/tasks/from-template/${routeTplId}`, { token: student2, body: {} });
    const routeInst2 = r.body.instance;
    r = await api('/attempts', { token: student2, body: { instanceId: routeInst2.id, answer: { ...routeAnswer, steps: [{ bodyCode: defence.code }] } } });
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student2 });
    a = r.body.attempt;
    assert.equal(a.deterministic.score, 0);
    assert.equal(a.criteria.find((c: any) => c.key === 'accuracy').score, 0);
    assert.equal(a.deterministic.wrongBodies.length, 1);
    r = await api(`/attempts/instances/${routeInst2.id}/close`, { token: student2, body: {} });
    r = await api(`/attempts/${a.id}`, { token: student2 });
    assert.equal(r.body.attempt.deterministic.routes.length, 2, 'routes open with the reference');
    assert.equal(r.body.attempt.deterministic.routes[0].steps[0].name.includes('Комитет'), true);
    assert.equal(r.body.attempt.deterministic.onRequestFacts.length, 2);

    // ---- "Mines" ----
    const MINES_TEXT = 'Договор поставки. Поставщик вправе в одностороннем порядке менять цену товара. Оплата производится в течение 10 дней. Покупатель отвечает за любые убытки поставщика без ограничений.';
    r = await api('/admin/documents', { token: admin, body: {
        type: 'contract', title: 'Мины в поставке', language: 'ru', text: MINES_TEXT,
        parties: [{ key: 'buyer', name: { ru: 'Покупатель', uz: '' } }],
        flaws: [
            { quote: 'в одностороннем порядке менять цену', explanation: { ru: 'цена меняется без согласия', uz: '' }, fix: { ru: 'по соглашению сторон', uz: '' }, options: [{ text: 'по соглашению сторон', correct: true }, { text: 'по решению поставщика', correct: false }, { text: 'ежемесячно', correct: false }] },
            { quote: 'за любые убытки поставщика без ограничений', explanation: { ru: 'неограниченная ответственность', uz: '' }, options: [{ text: 'за реальный ущерб в пределах цены договора', correct: true }, { text: 'за любые убытки', correct: false }, { text: 'за убытки и упущенную выгоду', correct: false }] }
        ],
        status: 'published'
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const minesDocId = r.body.document._id;
    const minesTpl = {
        taskType: 'mines', difficulty: 2, skills: [{ key: 'contract.liability', weight: 1 }],
        title: { ru: 'Найди мины', uz: '' }, instructions: { ru: 'Найдите опасные формулировки', uz: '' },
        caseText: { ru: 'Клиент собирается подписать договор поставки.', uz: '' },
        review: { documentId: minesDocId, clientSide: '', clientGoals: { ru: '', uz: '' } },
        timerSec: 600,
        status: 'published'
    };
    r = await api('/admin/templates', { token: admin, body: minesTpl });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const minesTplId = r.body.template._id;

    r = await api(`/tasks/from-template/${minesTplId}`, { token: student, body: {} });
    const minesInst = r.body.instance;
    assert.equal(minesInst.content.flawCount, 2);
    assert.equal(minesInst.content.mines.simplified, true);
    assert.equal(minesInst.content.mines.timerSec, 600);
    assert.equal(JSON.stringify(minesInst).includes('по соглашению сторон'), false, 'options are not sent with the task');
    const segs = minesInst.content.mines.segments.map((x: any) => MINES_TEXT.slice(x.from, x.to));
    const segOf = (q: string) => segs.findIndex((x: string) => x.includes(q));
    r = await api(`/tasks/instances/${minesInst.id}/mines/click`, { token: student, body: { segment: segOf('Оплата производится') } });
    assert.equal(r.body.mine, false, 'a safe phrase');
    r = await api(`/tasks/instances/${minesInst.id}/mines/click`, { token: student, body: { segment: segOf('менять цену') } });
    assert.equal(r.body.mine, true);
    assert.equal(r.body.options.length, 3);
    r = await api('/attempts', { token: student, body: { instanceId: minesInst.id, answer: { items: [{ segment: segOf('без ограничений'), danger: 'x', optionIndex: 0 }] } } });
    assert.equal(r.status, 400, 'an unopened phrase cannot be answered');
    r = await api('/attempts', { token: student, body: { instanceId: minesInst.id, answer: { items: [{ segment: segOf('менять цену'), danger: 'цена без согласия', optionIndex: 0 }] } } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    a = r.body.attempt;
    assert.equal(a.deterministic.kind, 'mines');
    assert.equal(a.deterministic.foundCount, 1);
    assert.equal(a.deterministic.missedCount, 1);
    assert.equal(a.deterministic.falseClicks, 1);
    assert.equal(a.criteria.find((c: any) => c.key === 'completeness').score, 50);
    assert.equal(a.criteria.find((c: any) => c.key === 'accuracy').score, 85);
    assert.equal(a.achievements.includes('sapper'), false);

    // A clean run on the free-text level gives the sapper achievement
    r = await api(`/admin/templates/${minesTplId}`, { method: 'PUT', token: admin, body: { ...minesTpl, difficulty: 4 } });
    r = await api(`/tasks/from-template/${minesTplId}`, { token: student, body: {} });
    const mines2 = r.body.instance;
    assert.equal(mines2.content.flawCount, null);
    for (const q of ['менять цену', 'без ограничений']) await api(`/tasks/instances/${mines2.id}/mines/click`, { token: student, body: { segment: segOf(q) } });
    r = await api('/attempts', { token: student, body: { instanceId: mines2.id, answer: { items: [
        { segment: segOf('менять цену'), replacement: 'изменять цену по соглашению сторон', danger: 'Цена растет без согласия покупателя' },
        { segment: segOf('без ограничений'), replacement: 'за реальный ущерб в пределах цены договора', danger: 'Ответственность без предела' }
    ] } } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    assert.equal(r.body.attempt.deterministic.clean, true);
    assert.ok(r.body.attempt.achievements.includes('sapper'), JSON.stringify(r.body.attempt.achievements));

    // ---- Simulation ----
    const scenario = {
        title: 'Взыскание долга', language: 'ru', caseText: 'Поставщик взыскивает долг за товар.',
        roles: [{ key: 'plaintiff', name: 'Представитель истца' }, { key: 'defendant', name: 'Представитель ответчика', startNodeId: 'd1' }],
        startNodeId: 'n1',
        nodes: [
            { id: 'n1', stage: 'Подготовка', speaker: 'Судья', text: 'Есть ли ходатайства?', choices: [
                { id: 'a', text: 'Приобщить акт сверки', next: 'n2', verdict: 'correct', explanation: 'доказательство долга', normRef: 'ст. 68 ЭПК' },
                { id: 'b', text: 'Ходатайств нет', next: 'lose', verdict: 'wrong', explanation: 'нет доказательств' }
            ] },
            { id: 'n2', stage: 'Прения', speaker: 'Судья', text: 'Ваша позиция?', freeTextRubric: 'Сослаться на акт сверки и ст. 333 ГК', choices: [
                { id: 'c', text: 'Просить взыскать долг', next: 'win', verdict: 'correct' }
            ] },
            { id: 'd1', stage: 'Подготовка', speaker: 'Судья', text: 'Отзыв представлен?', choices: [{ id: 'e', text: 'Да', next: 'lose', verdict: 'acceptable' }] },
            { id: 'win', stage: 'Решение', speaker: 'Судья', text: 'Иск удовлетворен', outcome: 'win' },
            { id: 'lose', stage: 'Решение', speaker: 'Судья', text: 'В иске отказано', outcome: 'loss' }
        ],
        status: 'published'
    };
    r = await api('/admin/scenarios', { token: admin, body: { ...scenario, nodes: scenario.nodes.map(n => (n.id === 'win' ? { ...n, outcome: '' } : n)) } });
    assert.equal(r.status, 400, 'a final node needs an outcome to publish');
    r = await api('/admin/scenarios', { token: admin, body: scenario });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const scenarioId = r.body.scenario._id;
    r = await api('/admin/templates', { token: admin, body: {
        taskType: 'sim_branching', difficulty: 1, skills: [{ key: 'claim.evidence', weight: 1 }],
        title: { ru: 'Заседание по долгу', uz: '' }, instructions: { ru: 'Проведите заседание', uz: '' },
        caseText: { ru: 'Поставщик взыскивает долг за товар.', uz: '' },
        sim: { scenarioId, role: '' }, status: 'published'
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const simTplId = r.body.template._id;
    r = await api(`/tasks/from-template/${simTplId}`, { token: student, body: {} });
    const simInst = r.body.instance;
    assert.equal(simInst.content.sim.role, '', 'two roles: the student chooses');
    assert.equal(JSON.stringify(simInst).includes('verdict'), false);
    r = await api(`/sim/${simInst.id}/turn`, { token: student, body: { choiceId: 'a' } });
    assert.equal(r.status, 409, 'role first');
    r = await api(`/sim/${simInst.id}/role`, { token: student, body: { role: 'plaintiff' } });
    assert.equal(r.body.state.node.id, 'n1');
    assert.equal(JSON.stringify(r.body.state).includes('correct'), false);
    r = await api(`/sim/${simInst.id}/turn`, { token: student, body: { choiceId: 'a' } });
    assert.equal(r.body.state.node.needsJustification, true);
    r = await api('/attempts', { token: student, body: { instanceId: simInst.id, answer: {} } });
    assert.equal(r.status, 409, 'the hearing must be finished');
    r = await api(`/sim/${simInst.id}/turn`, { token: student, body: { choiceId: 'c' } });
    assert.equal(r.status, 400, 'a key node needs a justification');
    r = await api(`/sim/${simInst.id}/turn`, { token: student, body: { choiceId: 'c', justification: 'Долг подтвержден актом сверки, ст. 333 ГК' } });
    assert.equal(r.body.state.finished, true);
    assert.equal(r.body.state.node.outcome, 'win');
    r = await api('/attempts', { token: student, body: { instanceId: simInst.id, answer: {} } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    a = r.body.attempt;
    assert.equal(a.deterministic.kind, 'sim');
    assert.equal(a.deterministic.score, 100);
    assert.equal(a.deterministic.outcome, 'win');
    assert.equal(a.deterministic.steps[0].verdict, 'correct');
    assert.equal(a.canRework, false, 'a simulation is played once');
    assert.ok(a.reference, 'the analysis opens right away');
    assert.ok(a.achievements.includes('first_win'));

    // ---- Court act: parts, AI copy with errors, exact sums ----
    r = await api('/admin/documents', { token: admin, body: {
        type: 'court_act', title: 'Решение по делу 4-1001', language: 'ru', script: 'cyrl', text: ACT,
        parties: [{ key: 'court', name: { ru: 'Суд', uz: '' } }],
        segments: [
            { key: 'act_type', startQuote: 'РЕШЕНИЕ' }, { key: 'case_number', startQuote: 'Дело №' }, { key: 'court', startQuote: 'Ташкентский межрайонный' },
            { key: 'intro', startQuote: 'Суд в составе' }, { key: 'reasoning', startQuote: 'Суд установил' }, { key: 'operative', startQuote: 'РЕШИЛ' }
        ],
        flaws: [{ quote: 'госпошлину 1 600 000 сум', explanation: { ru: 'пошлина неверна', uz: '' }, fix: { ru: 'госпошлину 1 650 000 сум', uz: '' }, expectedValue: { kind: 'money', value: '1650000' } }],
        status: 'published'
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const actId = r.body.document._id;
    assert.equal(r.body.document.flaws[0].segmentKey, 'operative', 'the part is found from the position');
    assert.equal(r.body.document.segments.find((x: any) => x.key === 'operative').to, ACT.length);

    r = await api(`/admin/documents/${actId}/inject-errors`, { token: admin, body: { errorsCount: 2 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.document.status, 'draft');
    assert.equal(r.body.document.originalId, actId);
    assert.equal(r.body.document.flaws.length, 1);
    assert.equal(r.body.dropped.flaws, 1);
    assert.equal(r.body.document.flaws[0].fix.ru, 'через месяц');

    r = await api('/admin/templates', { token: admin, body: {
        taskType: 'review_court_act', difficulty: 3, skills: [{ key: 'fee.property', weight: 1 }],
        title: { ru: 'Проверка решения', uz: '' }, instructions: { ru: 'Найдите и исправьте ошибки акта', uz: '' },
        caseText: { ru: 'Помощник судьи готовит решение к подписанию.', uz: '' },
        review: { documentId: actId, clientSide: '', clientGoals: { ru: '', uz: '' } }, status: 'published'
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const actTplId = r.body.template._id;
    r = await api(`/tasks/from-template/${actTplId}`, { token: student, body: {} });
    const actInst = r.body.instance;
    assert.equal(actInst.content.flawCount, 1, 'count known on level 3');
    assert.equal(JSON.stringify(actInst).includes('operative'), false, 'the parts markup is internal');
    const q = 'госпошлину 1 600 000 сум';
    const item = (replacement: string) => ({ from: ACT.indexOf(q), to: ACT.indexOf(q) + q.length, quote: q, comment: 'Пошлина рассчитана неверно, ЗРУ-600', replacement });
    r = await api('/attempts', { token: student, body: { instanceId: actInst.id, answer: { items: [item('госпошлину 1 700 000 сум')] } } });
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    a = r.body.attempt;
    assert.equal(a.deterministic.kind, 'court_act');
    assert.deepEqual(a.deterministic.wrongValueItems, [0]);
    assert.equal(a.criteria.find((c: any) => c.key === 'accuracy').score, 75, 'wrong sum costs 25');
    r = await api('/attempts', { token: student, body: { instanceId: actInst.id, answer: { items: [item('госпошлину 1 650 000 сум')] } } });
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    assert.deepEqual(r.body.attempt.deterministic.wrongValueItems, []);
    assert.equal(r.body.attempt.deterministic.markup[0].status, 'found', 'markup opens after the second iteration');

    // ---- Daily tasks, achievements, leaderboard ----
    r = await api('/me/daily', { token: student });
    assert.equal(r.status, 200);
    assert.ok(r.body.tasks.length >= 1 && r.body.tasks.length <= 3);
    assert.equal(new Set(r.body.tasks.map((t: any) => t.title)).size, r.body.tasks.length, 'different templates');
    const again = await api('/me/daily', { token: student });
    assert.deepEqual(again.body.tasks.map((t: any) => t.title), r.body.tasks.map((t: any) => t.title), 'fixed for the day');
    // At most one of the four published templates is the simulation, so one of these types is always there
    const routeDaily = r.body.tasks.find((t: any) => ['route_and_apply', 'mines', 'review_court_act'].includes(t.taskType));
    assert.ok(routeDaily, JSON.stringify(r.body.tasks));
    {
        const st = await api(`/me/daily/${routeDaily.index}/start`, { token: student, body: {} });
        const st2 = await api(`/me/daily/${routeDaily.index}/start`, { token: student, body: {} });
        assert.equal(st.body.instance.id, st2.body.instance.id, 'one instance per daily task');
        const xpBefore = (await api('/me', { token: student })).body.user.xp;
        const answer = routeDaily.taskType === 'route_and_apply' ? routeAnswer : { items: [] };
        const sub = await api('/attempts', { token: student, body: { instanceId: st.body.instance.id, answer } });
        assert.equal(sub.status, 202, JSON.stringify(sub.body));
        await processOne();
        const res = await api(`/attempts/${sub.body.attempt.id}`, { token: student });
        const xpAfter = (await api('/me', { token: student })).body.user.xp;
        assert.equal(xpAfter - xpBefore, res.body.attempt.xpAwarded + 15, 'daily bonus on top of the attempt XP');
        const d = await api('/me/daily', { token: student });
        assert.equal(d.body.tasks.find((t: any) => t.index === routeDaily.index).done, true);
    }
    r = await api('/me/achievements', { token: student });
    const earned = r.body.achievements.filter((x: any) => x.earnedAt).map((x: any) => x.code);
    for (const code of ['first_case', 'sapper', 'first_win']) assert.ok(earned.includes(code), code);

    r = await api('/leaderboard?scope=all&period=week', { token: student });
    assert.equal(r.status, 200);
    assert.equal(r.body.rows[0].me, true, 'the most active student leads');
    assert.ok(r.body.rows.every((x: any) => x.xp >= 0));
    await api('/me', { method: 'PATCH', token: student, body: { hideFromLeaderboard: true } });
    r = await api('/leaderboard?scope=all&period=all', { token: student2 });
    assert.equal(r.body.rows.some((x: any) => x.fullName === 'Студент s3@test.local'), false, 'hidden from the overall leaderboard');
    r = await api('/leaderboard?scope=course&period=all', { token: student });
    assert.equal(r.body.rows.length, 1, 'course 3 only');
    assert.equal(r.body.me.rank, 1);

    // ---- Teacher analytics ----
    r = await api('/admin/users', { token: admin, body: { email: 't3@test.local', fullName: 'Преподаватель', role: 'teacher' } });
    let t = await api('/auth/login', { body: { email: 't3@test.local', password: r.body.temporaryPassword } });
    t = await api('/auth/change-password', { token: t.body.accessToken, body: { currentPassword: r.body.temporaryPassword, newPassword: 'teacher-pass-1' } });
    const teacher = t.body.accessToken;
    r = await api('/teacher/groups', { token: teacher, body: { name: 'ЮР-31' } });
    const groupId = r.body.group.id;
    await api('/me/groups/join', { token: student, body: { inviteCode: r.body.group.inviteCode } });
    await api('/me/groups/join', { token: student2, body: { inviteCode: r.body.group.inviteCode } });
    r = await api(`/teacher/groups/${groupId}/analytics`, { token: teacher });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.heatmap.length, 2);
    assert.ok(r.body.skills.length >= 3);
    assert.equal(r.body.heatmap[0].cells.length, r.body.skills.length);
    r = await api(`/leaderboard?scope=group&period=all&groupId=${groupId}`, { token: student2 });
    assert.equal(r.body.rows.length, 2, 'hiding applies to the overall leaderboard only');

    // ---- CSV export ----
    r = await api('/admin/results.csv?mode=route', { token: admin });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
    const lines = String(r.body).trim().split('\n');
    assert.ok(lines[0].startsWith('date;student;email'));
    // fetch().text() drops the BOM, the raw bytes keep it for Excel
    const raw = new Uint8Array(await (await fetch(`${base}/api/v1/admin/results.csv`, { headers: { Authorization: `Bearer ${admin}` } })).arrayBuffer());
    assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(lines.length >= 3);
    assert.ok(lines.slice(1).every(l => l.includes(';route;')));
});
