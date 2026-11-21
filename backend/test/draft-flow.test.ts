import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Full drafting-trainer flow through the HTTP API with an in-memory MongoDB and a stub LLM.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.LOGS_DIR = '/tmp/caselab-test-logs';

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
const llmCalls: string[] = [];

async function api(path: string, opts: { method?: string; token?: string; body?: unknown; cookie?: string } = {}) {
    const res = await fetch(`${base}/api/v1${path}`, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: {
            'Content-Type': 'application/json',
            ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
            ...(opts.cookie ? { Cookie: opts.cookie } : {})
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri('caselab');

    const { setLlmForTests } = await import('../src/modules/ai/claude.provider');
    // Stub: the instance rewrite keeps values verbatim; the evaluation returns a fixed grading
    setLlmForTests({
        async generateJson(req: any) {
            const isEval = req.system.includes('экзаменатор');
            llmCalls.push(isEval ? 'evaluate' : 'generate');
            if (!isEval) {
                const values = [...req.user.matchAll(/^\w+: (.+)$/gm)].map((m: RegExpMatchArray) => m[1]);
                return { data: req.schema.parse({ caseText: `Переписанный казус. ${values.join('; ')}. Конец истории для студента.` }), tokensIn: 1, tokensOut: 1, model: 'stub' };
            }
            const student = req.user.split('<student_answer>')[1] ?? '';
            const fee = Number(student.match(/пошлина (\d+)/)?.[1] ?? 0);
            const amount = Number(student.match(/сумма (\d+)/)?.[1] ?? 0);
            return {
                data: req.schema.parse({
                    criteria: ['accuracy', 'completeness', 'reasoning', 'form', 'language'].map(key => ({ key, score: 80, comment: 'ok', quotes: [] })),
                    errors: [{ errorType: 'wrong_norm', skillKey: 'claim.prayer', quote: 'x', comment: 'Не та статья', normRef: 'ст. 151 ЭПК' }],
                    missing: [],
                    feedback: 'Хорошо',
                    improvedVersion: 'Лучше так',
                    extracted: { court: 'Ташкентский межрайонный экономический суд', plaintiff: 'ООО А', defendant: 'ООО Б', claimAmount: amount, fee, attachments: [] },
                    confidence: 0.9,
                    injectionSuspected: false
                }),
                tokensIn: 1, tokensOut: 1, model: 'stub'
            };
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

test('drafting trainer: admin publishes a template, student drafts, AI + engine grade, rework, reference opens', async () => {
    // Admin login, forced password change
    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-123' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.mustChangePassword, true);
    r = await api('/auth/change-password', { token: r.body.accessToken, body: { currentPassword: 'admin-pass-123', newPassword: 'admin-pass-456' } });
    assert.equal(r.status, 200);
    const adminToken = r.body.accessToken;

    // Template with variables and a deterministic requisites check
    const template = {
        taskType: 'draft_full',
        skills: [{ key: 'claim.prayer', weight: 1 }, { key: 'fee.property', weight: 0.5 }],
        difficulty: 2,
        title: { ru: 'Иск о взыскании долга', uz: '' },
        instructions: { ru: 'Составьте исковое заявление', uz: '' },
        context: { role: { ru: 'Вы - юрист истца', uz: '' }, today: '2026-11-10' },
        caseText: { ru: 'Поставщик не получил оплату {{debt}} по договору. Иск подается {{filed}}.', uz: '' },
        variablesSchema: [
            { key: 'debt', kind: 'money', min: 50000000, max: 50000000, step: 1000000 },
            { key: 'filed', kind: 'date', min: 0, max: 0 }
        ],
        scaffold: [{ title: { ru: 'Шапка', uz: '' }, hint: { ru: 'Суд и стороны', uz: '' } }],
        relatedNorms: [{ code: 'ЭПК', article: '151' }],
        referenceAnswer: { ru: 'Эталонный иск', uz: '' },
        checklist: [{ ru: 'Указан суд', uz: '' }],
        deterministicCheck: { kind: 'claim_requisites', params: { amountVar: 'debt', filingDateVar: 'filed', feeRateCode: 'property', acceptableCourts: ['Ташкентский межрайонный экономический суд'] } },
        status: 'published'
    };
    r = await api('/admin/templates', { token: adminToken, body: { ...template, caseText: { ru: 'Без переменной {{missing}}', uz: '' } } });
    assert.equal(r.status, 400, 'placeholder without a variable is rejected');
    r = await api('/admin/templates', { token: adminToken, body: template });
    assert.equal(r.status, 201, JSON.stringify(r.body));

    // Student registration, onboarding, refresh cookie
    r = await api('/auth/register', { body: { fullName: 'Студент Тест', email: 'student@test.local', password: 'student-pass', course: 3, locale: 'ru' } });
    assert.equal(r.status, 201);
    const cookie = r.headers.get('set-cookie')!.split(';')[0];
    r = await api('/auth/refresh', { method: 'POST', cookie });
    assert.equal(r.status, 200);
    const token = r.body.accessToken;
    r = await api('/me', { method: 'PATCH', token, body: { startLevel: 'beginner' } });
    assert.equal(r.body.user.startLevel, 'beginner');

    // Next task: generated, the expected answer is not exposed
    r = await api('/tasks/next', { token, body: { mode: 'draft' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const instance = r.body.instance;
    assert.equal(instance.expected, undefined);
    assert.ok(instance.content.caseText.includes('50 000 000 сум'));
    assert.ok(instance.content.caseText.includes('10.11.2026'));
    assert.equal(instance.content.generatedByAi, true);
    assert.equal(instance.content.scaffold[0].hint, 'Суд и стороны');

    r = await api(`/tasks/instances/${instance.id}`, { token });
    assert.equal(r.body.instance.relatedNorms[0].inDictionary, false);

    // First iteration with a wrong fee: the engine caps accuracy and flags the mismatch
    r = await api('/attempts', { token, body: { instanceId: instance.id, answer: { text: 'Исковое заявление. Цена иска сумма 50000000, пошлина 500000. Прошу взыскать долг.' } } });
    assert.equal(r.status, 202);
    const first = r.body.attempt.id;

    const { processOne } = await import('../src/jobs/evaluate-attempt.job');
    assert.equal(await processOne(), true);

    r = await api(`/attempts/${first}`, { token });
    const a1 = r.body.attempt;
    assert.equal(a1.status, 'needs_review');
    // The engine says the fee is wrong, but the right amount stays hidden until the reference opens
    const feeCheck = a1.deterministic.checks.find((c: any) => c.key === 'fee');
    assert.equal(feeCheck.ok, false);
    assert.equal(feeCheck.expected, undefined);
    assert.equal(a1.criteria.find((c: any) => c.key === 'accuracy').score, 67);
    // (30*67 + 25*80 + 20*80 + 15*80 + 10*80) / 100 = 76.1
    assert.equal(a1.finalScore, 76);
    assert.equal(a1.canRework, true);
    assert.equal(a1.reference, null);
    assert.ok(a1.xpAwarded > 0);
    assert.deepEqual(a1.achievements, ['first_case']);

    // Second iteration with the right fee
    r = await api('/attempts', { token, body: { instanceId: instance.id, answer: { text: 'Исковое заявление. Цена иска сумма 50000000, пошлина 1000000. Прошу взыскать долг.' } } });
    assert.equal(r.status, 202);
    await processOne();
    r = await api(`/attempts/${r.body.attempt.id}`, { token });
    const a2 = r.body.attempt;
    assert.equal(a2.status, 'auto');
    assert.equal(a2.finalScore, 80);
    assert.equal(a2.reference.answer, 'Эталонный иск');
    assert.equal(a2.deterministic.checks.find((c: any) => c.key === 'fee').expected, 1000000);
    // best = max(76, 0.7 * 80)
    assert.equal(a2.instanceBestScore, 76);

    r = await api('/attempts', { token, body: { instanceId: instance.id, answer: { text: 'Третья попытка, которой быть не должно, текст длинный.' } } });
    assert.equal(r.status, 409);

    r = await api('/me/dashboard', { token });
    assert.ok(r.body.xp > 0);
    assert.equal(r.body.streak.current, 1);
    r = await api('/me/skills', { token });
    assert.ok(r.body.skills.find((s: any) => s.key === 'claim.prayer').rating !== null);

    // Roles: a student cannot reach the admin API
    r = await api('/admin/users', { token });
    assert.equal(r.status, 403);
    assert.deepEqual(llmCalls, ['generate', 'evaluate', 'evaluate']);
});
