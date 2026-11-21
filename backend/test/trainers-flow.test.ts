import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Review trainers, procedural card, teacher moderation and exams through the HTTP API, stub LLM.
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

const DOC_TEXT = [
    'ДОГОВОР ПОДРЯДА',
    '1. Подрядчик вправе в одностороннем порядке изменить цену работ.',
    '2. Заказчик оплачивает работы в течение 5 дней после подписания акта.',
    '3. Неустойка подрядчика за просрочку составляет 0,01% от цены работ.',
    '4. Споры рассматриваются в экономическом суде по месту нахождения подрядчика.'
].join('\n');

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
            const common = { errors: [], missing: [], feedback: 'Разбор', improvedVersion: 'Лучше так', confidence: 0.9, injectionSuspected: false };
            let data: unknown;
            if (s.includes('учебные документы')) {
                calls.push('generateDocument');
                data = {
                    title: 'Договор поставки',
                    text: 'Поставщик вправе менять сроки поставки без согласия покупателя. Покупатель платит штраф 50% за любую задержку. Прочие условия обычные и не вызывают вопросов у сторон договора поставки, текст дополнен для длины.',
                    flaws: [
                        { quote: 'менять сроки поставки без согласия покупателя', type: 'одностороннее изменение', severity: 'high', badFor: 'buyer', normRef: 'ст. 357 ГК', explanation: 'Риск срыва', fix: 'по согласованию сторон' },
                        { quote: 'этого текста нет', type: 'x', severity: 'low', badFor: 'buyer', normRef: '', explanation: '', fix: '' }
                    ],
                    counterpartyEdits: [{ quote: 'штраф 50%', replacement: 'штраф 100%', badFor: 'buyer', explanation: 'Ухудшает' }]
                };
            } else if (s.includes('старший юрист')) {
                calls.push('evaluateReview');
                // Every extra the engine reports is judged unjustified
                const extras = [...req.user.matchAll(/"extra": ?\[([^\]]*)\]/g)].flatMap((m: RegExpMatchArray) => m[1].split(',').filter(Boolean).map(Number));
                data = { ...common, criteria: criteria(90), items: [], extras: extras.map(index => ({ index, justified: false, comment: 'не риск' })) };
            } else if (s.includes('процессуальную карточку')) {
                calls.push('evaluateProcess');
                data = { ...common, criteria: criteria(90), fields: [] };
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

test('review, fix-check and procedural card trainers: engines, hidden markup, reference after close', async () => {
    const { processOne } = await import('../src/jobs/evaluate-attempt.job');

    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-123' } });
    r = await api('/auth/change-password', { token: r.body.accessToken, body: { currentPassword: 'admin-pass-123', newPassword: 'admin-pass-456' } });
    const admin = r.body.accessToken;

    // ---- Document library ----
    const docBody = {
        type: 'contract', title: 'Договор подряда', language: 'ru', text: DOC_TEXT,
        parties: [{ key: 'customer', name: { ru: 'Заказчик', uz: 'Buyurtmachi' } }, { key: 'contractor', name: { ru: 'Подрядчик', uz: 'Pudratchi' } }],
        flaws: [
            { quote: 'в одностороннем порядке изменить цену работ', badFor: 'customer', severity: 'high', normRef: 'ст. 637 ГК', explanation: { ru: 'Цена меняется без согласия', uz: '' }, fix: { ru: 'по соглашению сторон', uz: '' } },
            { quote: '0,01% от цены работ', badFor: 'customer', explanation: { ru: 'Неустойка символическая', uz: '' } },
            // A short payment term is dangerous for the contractor only - "fixing" it works against the customer
            { quote: 'в течение 5 дней после подписания акта', badFor: 'contractor', explanation: { ru: 'Короткий срок оплаты рискован для подрядчика', uz: '' } },
            { quote: 'по месту нахождения подрядчика', badFor: 'customer', explanation: { ru: 'Неудобная подсудность', uz: '' } }
        ],
        counterpartyEdits: [
            { quote: 'ДОГОВОР ПОДРЯДА', replacement: 'ДОГОВОР ПОДРЯДА № 15', badFor: 'none' },
            { quote: 'за просрочку', replacement: 'за просрочку свыше 30 дней', badFor: 'customer' }
        ],
        status: 'draft'
    };
    r = await api('/admin/documents', { token: admin, body: { ...docBody, flaws: [{ quote: 'нет в тексте', badFor: 'customer' }] } });
    assert.equal(r.status, 400, 'quote missing from the text is rejected');
    r = await api('/admin/documents', { token: admin, body: docBody });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const docId = r.body.document._id;
    assert.equal(r.body.document.flaws[0].from, DOC_TEXT.indexOf('в одностороннем порядке'));

    // AI draft: unusable quote dropped, saved as draft
    r = await api('/admin/documents/generate', { token: admin, body: { type: 'contract', topic: 'поставка оборудования', language: 'ru', parties: [{ key: 'buyer', name: { ru: 'Покупатель', uz: '' } }, { key: 'supplier', name: { ru: 'Поставщик', uz: '' } }], flawsCount: 2, editsCount: 1 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.document.status, 'draft');
    assert.equal(r.body.document.source, 'ai');
    assert.equal(r.body.dropped.flaws, 1);

    const reviewTemplate = {
        taskType: 'review_contract', difficulty: 2, skills: [{ key: 'contract.liability', weight: 1 }],
        title: { ru: 'Проверка договора подряда', uz: '' }, instructions: { ru: 'Проверь договор в интересах заказчика', uz: '' },
        context: { role: { ru: 'Юрист заказчика', uz: '' }, today: '2026-11-10' },
        caseText: { ru: 'Заказчик прислал проект договора подряда перед подписанием.', uz: '' },
        review: { documentId: docId, clientSide: 'customer', clientGoals: { ru: 'Сохранить фиксированную цену', uz: '' } },
        status: 'published'
    };
    r = await api('/admin/templates', { token: admin, body: reviewTemplate });
    assert.equal(r.status, 400, 'a review template cannot be published with a draft document');
    const docPublished = { ...docBody, status: 'published' };
    await api(`/admin/documents/${docId}`, { method: 'PUT', token: admin, body: docPublished });
    r = await api('/admin/templates', { token: admin, body: reviewTemplate });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const reviewTplId = r.body.template._id;
    r = await api('/admin/templates', { token: admin, body: { ...reviewTemplate, taskType: 'review_fix_check', title: { ru: 'Правки контрагента', uz: '' } } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const fixTplId = r.body.template._id;

    const processTemplate = {
        taskType: 'proc_next_step', difficulty: 3, skills: [{ key: 'deadline.appeal', weight: 1 }, { key: 'fee.appeal', weight: 0.5 }],
        title: { ru: 'Обжалование решения', uz: '' }, instructions: { ru: 'Заполни процессуальную карточку', uz: '' },
        context: { role: { ru: 'Юрист ответчика', uz: '' }, today: '2026-11-12' },
        caseText: { ru: 'Решение о взыскании {{debt}} принято {{decided}}. Клиент хочет обжаловать решение полностью.', uz: '' },
        variablesSchema: [
            { key: 'debt', kind: 'money', min: 50000000, max: 50000000, step: 1000000 },
            { key: 'decided', kind: 'date', min: -4, max: -4 }
        ],
        referenceAnswer: { ru: 'Апелляционная жалоба через суд первой инстанции', uz: '' },
        process: {
            acceptableCourts: ['Ташкентский межрайонный экономический суд'],
            deadline: { ruleCode: 'appeal_filing', eventDateVar: 'decided' },
            fee: { rateCode: 'property', amountVar: 'debt', instance: 'appeal' }
        },
        status: 'published'
    };
    r = await api('/admin/templates', { token: admin, body: processTemplate });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const procTplId = r.body.template._id;

    // ---- Student ----
    r = await api('/auth/register', { body: { fullName: 'Студент Тест', email: 's@test.local', password: 'student-pass', course: 3, locale: 'ru' } });
    const student = r.body.accessToken;
    await api('/me', { method: 'PATCH', token: student, body: { startLevel: 'intermediate' } });

    // Review: the student sees the document and the flaw count, never the markup
    r = await api(`/tasks/from-template/${reviewTplId}`, { token: student, body: {} });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const reviewInst = r.body.instance;
    assert.equal(reviewInst.content.documentText, DOC_TEXT);
    assert.equal(reviewInst.content.flawCount, 3);
    assert.equal(reviewInst.content.clientSideName, 'Заказчик');
    assert.equal(JSON.stringify(reviewInst).includes('Неустойка символическая'), false);

    const sel = (q: string, comment: string, replacement = '') => ({ from: DOC_TEXT.indexOf(q), to: DOC_TEXT.indexOf(q) + q.length, quote: q, comment, replacement });
    r = await api('/attempts', { token: student, body: { instanceId: reviewInst.id, answer: { items: [{ ...sel('Подрядчик вправе', 'риск'), quote: 'подмена' }] } } });
    assert.equal(r.status, 400, 'selection must match the document');
    r = await api('/attempts', { token: student, body: { instanceId: reviewInst.id, answer: { items: [
        sel('в одностороннем порядке изменить цену', 'Цена может вырасти без согласия заказчика, ст. 637 ГК', 'изменить цену только по соглашению сторон'),
        sel('Заказчик оплачивает работы', 'Не вижу проблемы, но отмечу'),
        sel('в течение 5 дней', 'Удлинить срок оплаты', 'в течение 30 дней')
    ] } } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    let a = r.body.attempt;
    assert.equal(a.deterministic.kind, 'review');
    assert.deepEqual(a.deterministic.foundItems, [0]);
    assert.equal(a.deterministic.missedCount, 2);
    assert.deepEqual(a.deterministic.extras, [1]);
    assert.equal(a.deterministic.markup, null, 'markup hidden before the reference opens');
    // completeness = 1 of 3 -> 33; accuracy cap = 100 - 10 (one unjustified extra) - 20 (one edit against the client) = 70
    assert.equal(a.criteria.find((c: any) => c.key === 'completeness').score, 33);
    assert.equal(a.criteria.find((c: any) => c.key === 'accuracy').score, 70);
    await api(`/attempts/instances/${reviewInst.id}/close`, { token: student, body: {} });
    r = await api(`/attempts/${a.id}`, { token: student });
    assert.equal(r.body.attempt.deterministic.markup.filter((m: any) => m.status === 'missed').length, 2);
    assert.equal(r.body.attempt.deterministic.markup.find((m: any) => m.status === 'against_client').quote, 'в течение 5 дней после подписания акта');

    // Fix-check: every edit needs a decision
    r = await api(`/tasks/from-template/${fixTplId}`, { token: student, body: {} });
    const fixInst = r.body.instance;
    assert.equal(fixInst.content.counterpartyEdits.length, 2);
    assert.equal(JSON.stringify(fixInst).includes('badFor'), false);
    const [e1, e2] = fixInst.content.counterpartyEdits;
    r = await api('/attempts', { token: student, body: { instanceId: fixInst.id, answer: { decisions: [{ editId: e1.id, decision: 'accept', reason: 'Номер договора - нейтрально' }] } } });
    assert.equal(r.status, 400);
    r = await api('/attempts', { token: student, body: { instanceId: fixInst.id, answer: { decisions: [
        { editId: e1.id, decision: 'accept', reason: 'Номер договора, риска нет' },
        { editId: e2.id, decision: 'reject', reason: 'Освобождает подрядчика от неустойки на месяц', counter: 'за каждый день просрочки' }
    ] } } });
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    a = r.body.attempt;
    assert.equal(a.deterministic.correct, 2);
    assert.equal(a.deterministic.results, null);
    assert.equal(a.finalScore, 90);

    // Procedural card: last day and fee from the engines; correct numbers without calculations cap reasoning
    r = await api(`/tasks/from-template/${procTplId}`, { token: student, body: {} });
    const procInst = r.body.instance;
    assert.ok(procInst.content.caseText.includes('08.11.2026'));
    r = await api('/attempts', { token: student, body: { instanceId: procInst.id, answer: {
        action: 'Подать апелляционную жалобу через суд первой инстанции',
        court: 'Ташкентский межрайонный экономический суд', courtBasis: 'Жалоба подается через суд, принявший решение, ст. 262 ЭПК',
        deadline: '2026-12-09', deadlineCalc: '',
        fee: 500000, feeCalc: '2% от 50 000 000 = 1 000 000, апелляция 50% = 500 000',
        consequences: 'Жалоба будет возвращена, нужно ходатайство о восстановлении'
    } } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token: student });
    a = r.body.attempt;
    // 08.11 + 1 month = 08.12.2026 holiday -> 09.12.2026
    assert.deepEqual(a.deterministic.checks.map((c: any) => [c.key, c.ok]), [['court', true], ['deadline', true], ['fee', true]]);
    assert.equal(a.deterministic.checks[1].expected, undefined, 'expected date hidden before the reference');
    assert.equal(a.criteria.find((c: any) => c.key === 'reasoning').score, 67);
});

test('teacher cabinet: groups, exam hidden until published, moderation adjusts XP', async () => {
    const { processOne } = await import('../src/jobs/evaluate-attempt.job');
    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-456' } });
    const admin = r.body.accessToken;
    r = await api('/admin/users', { token: admin, body: { email: 'teacher2@test.local', fullName: 'Учитель Два', role: 'teacher' } });
    const temp = r.body.temporaryPassword;
    r = await api('/auth/login', { body: { email: 'teacher2@test.local', password: temp } });
    r = await api('/auth/change-password', { token: r.body.accessToken, body: { currentPassword: temp, newPassword: 'teacher-pass-2' } });
    const teacher = r.body.accessToken;

    r = await api('/teacher/groups', { token: teacher, body: { name: 'ЭП-301' } });
    assert.equal(r.status, 201);
    const group = r.body.group;
    assert.match(group.inviteCode, /^[A-Z2-9]{6}$/);

    r = await api('/auth/login', { body: { email: 's@test.local', password: 'student-pass' } });
    const student = r.body.accessToken;
    r = await api('/me/groups/join', { token: student, body: { inviteCode: group.inviteCode.toLowerCase() } });
    assert.equal(r.status, 200);

    r = await api('/teacher/templates', { token: teacher });
    const proc = r.body.templates.find((t: any) => t.taskType === 'proc_next_step');
    r = await api('/teacher/assignments', { token: teacher, body: { groupId: group.id, title: 'Контрольная', templateIds: [proc.id], kind: 'exam', dueAt: new Date(Date.now() + 86400000).toISOString() } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const assignmentId = r.body.assignment.id;

    r = await api('/me/assignments', { token: student });
    assert.equal(r.body.assignments[0].tasks[0].instanceId, null);
    r = await api(`/tasks/from-assignment/${assignmentId}/${proc.id}`, { token: student, body: {} });
    assert.equal(r.status, 201);
    const inst = r.body.instance;
    assert.equal(inst.isExam, true);
    r = await api(`/tasks/from-assignment/${assignmentId}/${proc.id}`, { token: student, body: {} });
    assert.equal(r.body.instance.id, inst.id, 'an exam keeps one instance');

    const xpBefore = (await api('/me/dashboard', { token: student })).body.xp;
    r = await api('/attempts', { token: student, body: { instanceId: inst.id, answer: { action: 'Подать апелляционную жалобу', court: 'Другой суд', deadline: '2026-12-08', fee: 1000000 } } });
    const attemptId = r.body.attempt.id;
    await processOne();
    r = await api(`/attempts/${attemptId}`, { token: student });
    assert.equal(r.body.attempt.status, 'awaiting_publication');
    assert.equal(r.body.attempt.finalScore, null);
    const dash = (await api('/me/dashboard', { token: student })).body;
    assert.equal(dash.xp, xpBefore, 'exams give no XP');
    const examRow = dash.recent.find((x: any) => x.id === attemptId);
    assert.equal(examRow.finalScore, null, 'exam score hidden in the dashboard');
    assert.equal(examRow.status, 'awaiting_publication');
    assert.equal((await api('/attempts', { token: student })).body.attempts.find((x: any) => x.id === attemptId).finalScore, null);
    r = await api('/attempts', { token: student, body: { instanceId: inst.id, answer: { action: 'Вторая попытка в экзамене' } } });
    assert.equal(r.status, 409);

    // Wrong engine fields with high AI accuracy -> moderation queue
    r = await api('/teacher/moderation/queue', { token: teacher });
    const item = r.body.queue.find((q: any) => q.id === attemptId);
    assert.ok(item, 'attempt is in the teacher queue');
    assert.deepEqual(item.reviewReasons, ['engine_mismatch']);
    r = await api(`/teacher/moderation/${attemptId}`, { token: teacher });
    assert.equal(r.body.reference.engine.deadline.endDate, '2026-12-09');
    r = await api(`/teacher/moderation/${attemptId}`, { token: teacher, body: { criteria: ['accuracy', 'completeness', 'reasoning', 'form', 'language'].map(key => ({ key, score: 40 })), comment: 'Неверный суд и срок' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.finalScore, 40);

    r = await api(`/teacher/assignments/${assignmentId}`, { token: teacher });
    assert.equal(r.body.rows[0].cells[0].bestScore, 40);
    await api(`/teacher/assignments/${assignmentId}/publish-results`, { token: teacher, body: {} });
    r = await api(`/attempts/${attemptId}`, { token: student });
    assert.equal(r.body.attempt.status, 'moderated');
    assert.equal(r.body.attempt.finalScore, 40);
    // AI score before moderation: accuracy 0 and reasoning 0 from the engines, 90 elsewhere -> (15*90 + 10*90 + 5*90) / 100 = 27
    assert.equal(r.body.attempt.moderation.prevScore, 27);

    // Admin sees all groups, a teacher without groups sees none
    r = await api('/teacher/groups', { token: admin });
    assert.ok(r.body.groups.length >= 1);

    // STD-5: dispute of an auto score
    r = await api('/attempts', { token: student });
    const auto = r.body.attempts.find((x: any) => x.status === 'auto');
    r = await api(`/attempts/${auto.id}/dispute`, { token: student, body: { comment: 'Пункт про подсудность я нашел, но он не засчитан' } });
    assert.equal(r.status, 200);
    r = await api('/teacher/moderation/queue', { token: teacher });
    assert.equal(r.body.queue.some((q: any) => q.id === auto.id), true);

    // Raising a training score raises the XP awarded for it
    const before = (await api('/me/dashboard', { token: student })).body.xp;
    const awarded = (await api(`/attempts/${auto.id}`, { token: student })).body.attempt;
    r = await api(`/teacher/moderation/${auto.id}`, { token: teacher, body: { criteria: ['accuracy', 'completeness', 'reasoning', 'form', 'language'].map(key => ({ key, score: 100 })), comment: 'Засчитано' } });
    assert.equal(r.body.finalScore, 100);
    const afterAttempt = (await api(`/attempts/${auto.id}`, { token: student })).body.attempt;
    assert.ok(afterAttempt.xpAwarded > awarded.xpAwarded);
    assert.equal((await api('/me/dashboard', { token: student })).body.xp, before + afterAttempt.xpAwarded - awarded.xpAwarded);
});
