import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Hearing simulation with AI participants (sim_hearing): admin scenario CRUD, the moves, the protocol and the grade - HTTP API with a stub LLM.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.LOGS_DIR = '/tmp/caselab-test-logs';

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let turnReply: any = { replies: [{ speaker: 'judge', text: 'Суд вас услышал.' }], stageDone: false, nextStageOpening: '' };
let lastTurnUser = '';

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
    process.env.ANTHROPIC_API_KEY = 'test';
    const { setLlmForTests } = await import('../src/modules/ai/claude.provider');
    setLlmForTests({
        async generateJson(req: any) {
            let data: unknown;
            if (req.task === 'hearingTurn') { lastTurnUser = req.user; data = turnReply; }
            else if (String(req.system).includes('симуляцию судебного заседания') && req.task === 'evaluate') {
                data = { criteria: criteria(80), errors: [], missing: ['Не заявлено ходатайство'], feedback: 'Разбор роли', improvedVersion: 'Уважаемый суд...', confidence: 0.9, injectionSuspected: false, items: [{ index: 0, verdict: 'strong', comment: 'Хорошо' }], outcome: 'partial', outcomeReason: 'Неустойка уменьшена' };
            } else data = { caseText: 'не используется в этом тесте, текст длиннее пятидесяти символов для схемы' };
            return { data: req.schema.parse(data), tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0, model: 'stub' };
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

test('hearing: scenario CRUD, moves through the stages, protocol and grade', async () => {
    const admin = await loginAdmin();
    let r = await api('/auth/register', { body: { fullName: 'Студент Заседание', email: 'hearing@test.local', password: 'student-pass', course: 3, locale: 'ru' } });
    const student = r.body.accessToken as string;

    // A published scenario must have a judge
    const scenario = {
        title: 'Тестовое заседание', language: 'ru', court: 'Учебный суд', caseText: 'Казус',
        studentRole: { name: 'Представитель ответчика', goal: 'Уменьшить неустойку' },
        participants: [{ key: 'plaintiff', name: 'Представитель истца', role: 'opponent', persona: 'Настаивает' }],
        stages: [
            { key: 'prep', title: 'Подготовка', goal: 'Ходатайства', opening: 'Заседание открыто.', openingBy: '', maxTurns: 2 },
            { key: 'debate', title: 'Прения', goal: 'Речи', maxTurns: 1 }
        ],
        status: 'published'
    };
    r = await api('/admin/hearings', { token: admin, body: scenario });
    assert.equal(r.status, 400);
    r = await api('/admin/hearings', { token: admin, body: { ...scenario, participants: [...scenario.participants, { key: 'judge', name: 'Судья', role: 'judge' }] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const hearingId = r.body.hearing._id;

    // The template needs a scenario
    const tpl = {
        taskType: 'sim_hearing', difficulty: 2, skills: [{ key: 'procedure.claim', weight: 1 }],
        title: { ru: 'Заседание', uz: 'Majlis' }, instructions: { ru: 'Проведи', uz: "O'tkaz" }, caseText: { ru: 'Казус', uz: 'Kazus' },
        status: 'published'
    };
    r = await api('/admin/templates', { token: admin, body: tpl });
    assert.equal(r.status, 400);
    r = await api('/admin/templates', { token: admin, body: { ...tpl, hearing: { scenarioId: hearingId } } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    r = await api(`/admin/hearings/${hearingId}`, { token: admin });
    assert.equal(r.body.usedBy.length, 1);

    r = await api(`/tasks/from-template/${r.body.usedBy[0]._id}`, { token: student, body: {} });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const instanceId = r.body.instance.id;
    const state0 = r.body.instance.content.hearing;
    assert.equal(state0.transcript.length, 1);
    assert.equal(state0.transcript[0].text, 'Заседание открыто.');
    assert.equal(state0.transcript[0].speaker, 'judge');
    assert.ok(!('persona' in state0.participants[0]), 'personas stay on the server');

    // Not finished yet - cannot submit
    r = await api('/attempts', { token: student, body: { instanceId, answer: {} } });
    assert.equal(r.status, 409);

    // Unknown speakers are dropped; the turn limit closes the stage and the next one opens with a standard line
    turnReply = { replies: [{ speaker: 'plaintiff', text: 'Возражаем.' }, { speaker: 'student', text: 'чужие слова' }], stageDone: false, nextStageOpening: '' };
    r = await api(`/hearing/${instanceId}/say`, { token: student, body: { text: 'Уважаемый суд, прошу уменьшить неустойку.' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.state.transcript.length, 3);
    assert.equal(r.body.state.stageIndex, 0);
    r = await api(`/hearing/${instanceId}/say`, { token: student, body: { text: 'Ходатайств больше нет.', voice: true } });
    assert.ok(lastTurnUser.includes('Лимит реплик исчерпан'));
    assert.equal(r.body.state.stageIndex, 1);
    assert.match(r.body.state.transcript.at(-1).text, /Прения/);

    // The AI closes the last stage: the hearing ends with the judge's closing line
    turnReply = { replies: [{ speaker: 'judge', text: 'Прения окончены.' }], stageDone: true, nextStageOpening: '' };
    r = await api(`/hearing/${instanceId}/say`, { token: student, body: { text: 'Прошу удовлетворить иск частично.' } });
    assert.equal(r.body.state.finished, true);
    r = await api(`/hearing/${instanceId}/say`, { token: student, body: { text: 'Еще слово' } });
    assert.equal(r.status, 409);

    r = await api('/attempts', { token: student, body: { instanceId, answer: {} } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    const attemptId = r.body.attempt.id;
    const { processOne } = await import('../src/jobs/evaluate-attempt.job');
    assert.equal(await processOne(), true);
    const attempt: any = (await api(`/attempts/${attemptId}`, { token: student })).body.attempt;
    assert.notEqual(attempt.status, 'evaluating');
    const det = attempt.deterministic;
    assert.equal(det.kind, 'hearing');
    assert.equal(det.outcome, 'partial');
    assert.match(det.protocol, /ПРОТОКОЛ СУДЕБНОГО ЗАСЕДАНИЯ/);
    assert.match(det.protocol, /Представитель ответчика: Уважаемый суд, прошу уменьшить неустойку/);
    assert.equal(det.replies.length, 3);
    assert.equal(det.replies[1].voice, true);
    assert.equal(attempt.finalScore, 80);

    // Played once
    r = await api('/attempts', { token: student, body: { instanceId, answer: {} } });
    assert.equal(r.status, 409);
});

test('hearing: the demo scenario is seeded and playable', async () => {
    const { TaskTemplate } = await import('../src/modules/content/content.model');
    const t = await TaskTemplate.findOne({ seedKey: 'demo.hearing.penalty.template' }).lean();
    assert.ok(t?.hearing?.scenarioId);
    assert.equal(t?.status, 'published');
});
