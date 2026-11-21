import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Case track, timeline, proc_draft, admin acts, explainResult, teacher content, import - HTTP API with a stub LLM.
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
// What the draft evaluator "extracts" from the next document
let extract: any = { court: null, plaintiff: null, defendant: null, claimAmount: null, fee: null, attachments: [] };

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
            const common = { errors: [{ errorType: 'missing_fact', skillKey: 'claim.facts', quote: '', comment: 'Не указана дата получения претензии', normRef: '' }], missing: [], feedback: 'Разбор', improvedVersion: 'Лучше так', confidence: 0.9, injectionSuspected: false };
            let data: unknown;
            if (s.includes('составил документ')) { calls.push('draft'); data = { ...common, criteria: criteria(90), extracted: extract }; }
            else if (s.includes('процессуальную карточку')) { calls.push('process'); data = { ...common, criteria: criteria(90), fields: [] }; }
            else if (s.includes('хронологию')) { calls.push('timeline'); data = { ...common, criteria: criteria(90), items: [] }; }
            else if (s.includes('судебную симуляцию')) { calls.push('sim'); data = { ...common, criteria: criteria(90), items: [] }; }
            else if (s.includes('помощник судьи экономического суда')) { calls.push('courtAct'); data = { title: 'Определение', text: `Определение суда. ${req.user.split('<decision>')[1].split('</decision>')[0].trim()} Текст достаточно длинный для схемы.` }; }
            else if (s.includes('противоположной стороны')) { calls.push('opponent'); data = { title: 'Отзыв на иск', text: 'Ответчик возражает: претензия не получена уполномоченным лицом, товар поставлен с просрочкой.' }; }
            else if (s.includes('объясняешь студенту')) { calls.push('explain'); data = { explanation: 'Ты взял не ту ставку: пошлина считается от цены иска, 2 процента.' }; }
            else if (s.includes('старший юрист')) { calls.push('review'); data = { ...common, criteria: criteria(90), items: [], extras: [] }; }
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

async function loginAdmin() {
    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-123' } });
    r = await api('/auth/change-password', { token: r.body.accessToken, body: { currentPassword: 'admin-pass-123', newPassword: 'admin-pass-456' } });
    return r.body.accessToken as string;
}
async function newStudent(email: string) {
    const r = await api('/auth/register', { body: { fullName: `Студент ${email}`, email, password: 'student-pass', course: 3, locale: 'ru' } });
    await api('/me', { method: 'PATCH', token: r.body.accessToken, body: { startLevel: 'beginner' } });
    return r.body.accessToken as string;
}

test('demo track content passes the same validation as content made in the admin panel', async () => {
    const { templateZod } = await import('../src/modules/admin/admin.routes');
    const { scenarioZod } = await import('../src/modules/admin/scenarios.routes');
    const { trackZod } = await import('../src/modules/tracks/track-admin.routes');
    const { validateTrack } = await import('../src/modules/tracks/track.service');
    const { validateScenario } = await import('../src/modules/sim/sim-engine');
    const { DEMO_SCENARIO, DEMO_TEMPLATES, DEMO_TRACK } = await import('../src/seed/demo-track');
    const fakeId = 'a'.repeat(24);
    for (const t of DEMO_TEMPLATES) {
        const r = templateZod.safeParse({ ...t, sim: t.taskType === 'sim_branching' ? { scenarioId: fakeId, role: 'plaintiff' } : undefined });
        assert.ok(r.success, `${t.seedKey}: ${JSON.stringify(r.error?.issues)}`);
    }
    assert.ok(scenarioZod.safeParse({ ...DEMO_SCENARIO, status: 'published' }).success);
    assert.deepEqual(validateScenario(DEMO_SCENARIO as any), []);
    const track = { ...DEMO_TRACK, stages: DEMO_TRACK.stages.map(s => ({ ...s, templateId: fakeId })) };
    const r = trackZod.safeParse(track);
    assert.ok(r.success, JSON.stringify(r.error?.issues));
    assert.deepEqual(validateTrack(track as any), []);
});

test('case track: seeded demo, publish, branches with court acts and the opponent, report and XP', async () => {
    const { processOne } = await import('../src/jobs/evaluate-attempt.job');
    const admin = await loginAdmin();
    let r = await api('/admin/tracks', { token: admin });
    const demo = r.body.tracks[0];
    assert.equal(demo.status, 'review', 'the demo track waits for review');
    const student = await newStudent('case@test.local');
    r = await api('/tracks', { token: student });
    assert.equal(r.body.tracks.length, 0, 'not published yet');
    r = await api(`/admin/tracks/${demo._id}/publish-all`, { token: admin, body: {} });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.published.templates, 7);
    assert.equal(r.body.published.scenarios, 1);

    r = await api('/tracks', { token: student });
    assert.equal(r.body.tracks.length, 1);
    r = await api(`/tracks/${demo._id}/start`, { token: student, body: {} });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    let run = r.body.run;
    assert.equal(run.folder.length, 2);
    assert.ok(run.folder[1].text.includes('ООО «Бета Трейд»'), 'case values are filled into the folder');
    assert.equal(run.currentDate, '2026-09-14');

    const submit = async (body: unknown) => {
        const inst = (await api(`/tasks/instances/${run.currentInstanceId}`, { token: student })).body.instance;
        const s = await api('/attempts', { token: student, body: { instanceId: inst.id, answer: body } });
        assert.equal(s.status, 202, JSON.stringify(s.body));
        await processOne();
        run = (await api(`/runs/${run.id}`, { token: student })).body.run;
        return { inst, attemptId: s.body.attempt.id };
    };

    // 1. Claim letter
    let inst = (await api(`/tasks/instances/${run.currentInstanceId}`, { token: student })).body.instance;
    assert.equal(inst.runId, run.id);
    assert.equal(inst.content.today, '2026-09-14');
    assert.ok(inst.content.caseText.includes('84 000 000 сум'));
    assert.ok(inst.content.role.includes('ООО «Альфа Поставка»'));
    const { attemptId: letterAttempt } = await submit({ text: 'Претензия. Просим оплатить долг 84 000 000 сум в течение 15 дней, иначе обратимся в суд.' });
    let a = (await api(`/attempts/${letterAttempt}`, { token: student })).body.attempt;
    assert.equal(a.canRework, false, 'a stage has one iteration');
    assert.equal(a.runId, run.id);
    assert.equal(run.visits[1].stageKey, 'filing_card');
    assert.equal(run.currentDate, '2026-10-06', '22 days later');
    assert.ok(run.folder.some((f: any) => f.kind === 'student'), 'the letter goes into the folder');

    // 2. Filing card
    await submit({ action: 'Подать иск о взыскании долга', court: 'Юнусабадский межрайонный экономический суд', courtBasis: 'по месту нахождения ответчика, п. 7.2 договора', fee: 1680000, feeCalc: '2% от 84 000 000 сум по ЗРУ-600' });
    assert.equal(run.visits[2].stageKey, 'claim');

    // 3. Claim to the wrong court -> returned, with a court act
    extract = { court: 'Чиланзарский межрайонный экономический суд', plaintiff: 'А', defendant: 'Б', claimAmount: 84000000, fee: 1680000, attachments: [] };
    await submit({ text: 'Исковое заявление в Чиланзарский межрайонный экономический суд о взыскании 84 000 000 сум.' });
    assert.equal(run.visits[2].courtAct, 'return_claim');
    assert.match(run.visits[2].reason, /суд/);
    assert.equal(run.visits[3].stageKey, 'return_ruling');
    assert.ok(run.folder.some((f: any) => f.kind === 'court' && f.text.includes('возвращено')));

    // 4. Return ruling -> back to the claim
    await submit({ action: 'Подать иск заново в надлежащий суд', court: 'Юнусабадский межрайонный экономический суд', courtBasis: 'по месту нахождения ответчика', deadline: '', consequences: 'потеря времени' });
    assert.equal(run.visits[4].stageKey, 'claim');

    // 5. Claim right -> accepted, the opponent answers before the objections
    extract = { ...extract, court: 'Юнусабадский межрайонный экономический суд города Ташкента' };
    await submit({ text: 'Исковое заявление в Юнусабадский межрайонный экономический суд города Ташкента о взыскании 84 000 000 сум, госпошлина 1 680 000 сум.' });
    assert.equal(run.visits[4].courtAct, 'accept_claim');
    assert.equal(run.visits[5].stageKey, 'objections');
    assert.ok(run.folder.some((f: any) => f.kind === 'opponent'), 'the opponent answered');
    inst = (await api(`/tasks/instances/${run.currentInstanceId}`, { token: student })).body.instance;
    assert.ok(!inst.content.instructions.includes('Возражения на отзыв') || inst.difficulty < 3, 'proc_draft hides the document type from level 3');

    // 6. Objections (proc_draft)
    await submit({ text: 'Возражения на отзыв: претензия получена, просрочка не доказана, неустойка не заявлена встречным иском.' });
    assert.equal(run.visits[6].stageKey, 'hearing');

    // 7. Hearing (simulation) -> win
    const sim = run.currentInstanceId;
    await api(`/sim/${sim}/turn`, { token: student, body: { choiceId: 'a' } });
    await api(`/sim/${sim}/turn`, { token: student, body: { choiceId: 'd', justification: 'Неустойка требует встречного иска, долг подтвержден актом сверки' } });
    const xpBefore = (await api('/me', { token: student })).body.user.xp;
    await submit({});
    assert.equal(run.status, 'finished');
    assert.equal(run.outcome, 'win');
    assert.equal(run.outcomeScore, 80, 'one setback stage costs 20');
    assert.ok(run.finalScore > 0 && run.finalScore <= 100);
    assert.ok(run.xpBonus > 0, 'stage XP doubled on completion');
    const xpAfter = (await api('/me', { token: student })).body.user.xp;
    assert.ok(xpAfter - xpBefore >= run.xpBonus);
    assert.ok(run.folder.some((f: any) => f.kind === 'court' && /удовлетворены полностью/.test(f.text)));
    r = await api('/me/achievements', { token: student });
    assert.ok(r.body.achievements.find((x: any) => x.code === 'case_closed').earnedAt);

    // Replay starts a new run only on request
    r = await api(`/tracks/${demo._id}/start`, { token: student, body: {} });
    assert.equal(r.body.run.id, run.id);
    r = await api(`/tracks/${demo._id}/start`, { token: student, body: { restart: true } });
    assert.notEqual(r.body.run.id, run.id);
    assert.ok(calls.includes('courtAct') && calls.includes('opponent'));
});

test('timeline, proc_draft, admin act, explanation, teacher content and import', async () => {
    const { processOne } = await import('../src/jobs/evaluate-attempt.job');
    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-456' } });
    const admin = r.body.accessToken;
    const student = await newStudent('t4@test.local');

    // ---- proc_timeline ----
    const tl = {
        taskType: 'proc_timeline', difficulty: 2, skills: [{ key: 'deadline.appeal', weight: 1 }],
        title: { ru: 'Хронология дела', uz: '' }, instructions: { ru: 'Построй хронологию и найди нарушения', uz: '' },
        caseText: { ru: 'Пакет документов по делу о взыскании долга.', uz: '' },
        process: { timeline: {
            events: [
                { key: 'decision', title: { ru: 'Решение суда', uz: '' }, date: '2026-06-01', text: { ru: 'Решение вынесено', uz: '' } },
                { key: 'appeal', title: { ru: 'Апелляционная жалоба', uz: '' }, date: '2026-07-10', text: { ru: 'Жалоба подана', uz: '' } }
            ],
            checks: [{ key: 'appeal', label: { ru: 'Срок апелляции', uz: '' }, fromEventKey: 'decision', ruleCode: 'appeal_filing', toEventKey: 'appeal' }]
        } },
        status: 'published'
    };
    r = await api('/admin/templates', { token: admin, body: { ...tl, process: { timeline: { ...tl.process.timeline, checks: [{ ...tl.process.timeline.checks[0], ruleCode: 'nope' }] } } } });
    assert.equal(r.status, 400, 'unknown deadline rule');
    r = await api('/admin/templates', { token: admin, body: tl });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await api(`/tasks/from-template/${r.body.template._id}`, { token: student, body: {} });
    const tlInst = r.body.instance;
    assert.equal(tlInst.content.timelineEvents.length, 2);
    assert.equal(tlInst.content.timelineChecks.length, 1, 'deadlines named on level 2');
    assert.equal(JSON.stringify(tlInst).includes('2026-07-01'), false);
    r = await api('/attempts', { token: student, body: { instanceId: tlInst.id, answer: { deadlines: [{ fromEventKey: 'nope', endDate: '2026-07-01' }], violations: [] } } });
    assert.equal(r.status, 400, 'events from the package only');
    r = await api('/attempts', { token: student, body: { instanceId: tlInst.id, answer: { deadlines: [{ fromEventKey: 'decision', label: 'апелляция', endDate: '2026-06-30', calc: 'месяц со дня решения, ст. 261 ЭПК' }], violations: [] } } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await processOne();
    let a = (await api(`/attempts/${r.body.attempt.id}`, { token: student })).body.attempt;
    assert.equal(a.deterministic.kind, 'timeline');
    assert.equal(a.deterministic.checks[0].ok, false);
    assert.equal(a.deterministic.checks[0].expected, undefined, 'last day hidden before the reference');
    assert.equal(a.deterministic.violationsMissedCount, 1);
    r = await api(`/attempts/${a.id}/explain`, { token: student, body: { key: 'appeal' } });
    assert.equal(r.status, 409, 'explanation opens with the reference');
    await api(`/attempts/instances/${tlInst.id}/close`, { token: student, body: {} });
    a = (await api(`/attempts/${a.id}`, { token: student })).body.attempt;
    assert.equal(a.deterministic.checks[0].expected, '2026-07-01');
    assert.deepEqual(a.deterministic.violationsMissed, ['appeal']);
    r = await api(`/attempts/${a.id}/explain`, { token: student, body: { key: 'appeal' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.explanation, /ставку/);
    a = (await api(`/attempts/${a.id}`, { token: student })).body.attempt;
    assert.ok(a.explanations.appeal, 'cached on the attempt');

    // ---- proc_draft hides the document type from level 3 ----
    const pd = {
        taskType: 'proc_draft', difficulty: 3, skills: [{ key: 'deadline.appeal', weight: 1 }],
        title: { ru: 'Документ по ситуации', uz: '' }, instructions: { ru: 'Составь апелляционную жалобу', uz: '' },
        caseText: { ru: 'Решение суда клиента не устраивает, срок не истек.', uz: '' }, referenceAnswer: { ru: 'Апелляционная жалоба', uz: '' },
        process: { draftDocType: { ru: 'Апелляционная жалоба', uz: '' } }, status: 'published'
    };
    r = await api('/admin/templates', { token: admin, body: { ...pd, process: {} } });
    assert.equal(r.status, 400, 'document type is required');
    r = await api('/admin/templates', { token: admin, body: pd });
    r = await api(`/tasks/from-template/${r.body.template._id}`, { token: student, body: {} });
    assert.equal(r.body.instance.content.instructions.includes('апелляционную'), false);

    // ---- admin act ----
    const ACT = 'РЕШЕНИЕ хокимията района. Отказать заявителю в регистрации без указания причин. Решение обжалованию не подлежит.';
    r = await api('/admin/documents', { token: admin, body: { type: 'admin_act', title: 'Решение хокимията', language: 'ru', text: ACT, parties: [{ key: 'applicant', name: { ru: 'Заявитель', uz: '' } }], flaws: [{ quote: 'без указания причин', badFor: 'applicant' }, { quote: 'обжалованию не подлежит', badFor: 'applicant' }], status: 'published' } });
    const actDoc = r.body.document._id;
    r = await api('/admin/templates', { token: admin, body: { taskType: 'review_admin_act', difficulty: 2, skills: [{ key: 'act.reasoning', weight: 1 }], title: { ru: 'Проверка решения органа', uz: '' }, instructions: { ru: 'Найди нарушения', uz: '' }, caseText: { ru: 'Клиенту отказали в регистрации.', uz: '' }, review: { documentId: actDoc, clientSide: 'applicant', clientGoals: { ru: 'Получить регистрацию', uz: '' } }, status: 'published' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await api(`/tasks/from-template/${r.body.template._id}`, { token: student, body: {} });
    const q = 'без указания причин';
    r = await api('/attempts', { token: student, body: { instanceId: r.body.instance.id, answer: { items: [{ from: ACT.indexOf(q), to: ACT.indexOf(q) + q.length, quote: q, comment: 'Отказ должен быть мотивирован', replacement: 'с указанием оснований отказа' }] } } });
    assert.equal(r.status, 202);
    await processOne();
    a = (await api(`/attempts/${r.body.attempt.id}`, { token: student })).body.attempt;
    assert.equal(a.deterministic.kind, 'review');
    assert.equal(a.deterministic.missedCount, 1);

    // ---- TCH-5: teacher content goes through review ----
    r = await api('/admin/users', { token: admin, body: { email: 't4t@test.local', fullName: 'Преподаватель', role: 'teacher' } });
    let t = await api('/auth/login', { body: { email: 't4t@test.local', password: r.body.temporaryPassword } });
    t = await api('/auth/change-password', { token: t.body.accessToken, body: { currentPassword: r.body.temporaryPassword, newPassword: 'teacher-pass-1' } });
    const teacher = t.body.accessToken;
    r = await api('/teacher/content/meta', { token: teacher });
    assert.ok(r.body.skills.length && r.body.deadlineRules.length);
    r = await api('/teacher/content/templates', { token: teacher, body: { ...pd, status: 'published' } });
    assert.equal(r.status, 400, 'teachers cannot publish');
    r = await api('/teacher/content/templates', { token: teacher, body: { ...pd, status: 'review' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const tplId = r.body.template._id;
    r = await api('/admin/templates?status=review', { token: admin });
    assert.ok(r.body.templates.some((x: any) => x._id === tplId), 'in the admin review queue');
    r = await api('/teacher/content/templates', { token: teacher });
    assert.equal(r.body.templates.length, 1, 'own templates only');

    // ---- ADM-8: JSON import with refs, DOCX text ----
    r = await api('/admin/import', { token: admin, body: {
        documents: [{ ref: 'd1', type: 'contract', title: 'Импортированный договор', language: 'ru', text: 'Поставщик вправе менять цену в одностороннем порядке. Прочие условия обычные, текст для длины.', parties: [{ key: 'buyer', name: { ru: 'Покупатель', uz: '' } }], flaws: [{ quote: 'менять цену в одностороннем порядке', badFor: 'buyer' }] }],
        templates: [
            { taskType: 'review_contract', difficulty: 2, skills: [{ key: 'contract.price', weight: 1 }], title: { ru: 'Импорт', uz: '' }, instructions: { ru: 'Проверь', uz: '' }, caseText: { ru: 'Кейс', uz: '' }, documentRef: 'd1', review: { clientSide: 'buyer' }, status: 'published' },
            { taskType: 'draft_full', title: { ru: 'Битый', uz: '' } }
        ]
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.created, { documents: 1, scenarios: 0, templates: 1, tracks: 0, bodies: 0 });
    assert.equal(r.body.errors.length, 1);
    r = await api('/admin/templates?status=draft', { token: admin });
    assert.ok(r.body.templates.some((x: any) => x.title.ru === 'Импорт'), 'imported as a draft');

    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ДОГОВОР ПОСТАВКИ</w:t></w:r></w:p><w:p><w:r><w:t>Поставщик обязуется передать товар, а покупатель принять и оплатить его в срок.</w:t></w:r></w:p></w:body></w:document>');
    const b64 = (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64');
    r = await api('/admin/import/docx', { token: admin, body: { fileName: 'Договор.docx', contentBase64: b64 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.title, 'Договор');
    assert.ok(r.body.text.startsWith('ДОГОВОР ПОСТАВКИ\n'));
    r = await api('/admin/import/docx', { token: admin, body: { fileName: 'x.docx', contentBase64: Buffer.from('not a zip at all').toString('base64') } });
    assert.equal(r.status, 400);
});
