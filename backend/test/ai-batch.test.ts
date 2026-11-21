import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Background AI work through Message Batches: queued admin drafts, the case pool for tomorrow and its use,
// the weekly summary queue, the eval collector. The provider is a fake with a batch API.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.LOGS_DIR = '/tmp/caselab-test-logs';

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
const direct: string[] = [];
const batches: { customId: string; req: any }[][] = [];
let schemaMissOnce = false;

const values = (user: string) => String(user.split('<values>')[1] ?? '').split('\n').map(l => l.split(': ')[1]).filter(Boolean);

function answer(req: any): unknown {
    if (req.task === 'generateInstance') return { caseText: `Подготовленный заранее казус: ${values(req.user).join(', ')}. Текст длиннее пятидесяти символов.` };
    if (req.task === 'generateFlawedDocument') {
        return {
            title: 'Договор поставки', text: `Договор поставки. Поставщик вправе в одностороннем порядке изменить цену. ${'Обычный текст договора. '.repeat(12)}`,
            flaws: [{ quote: 'в одностороннем порядке изменить цену', type: 'изменение цены', severity: 'high', badFor: 'buyer', normRef: 'ст. 382 ГК', explanation: 'риск', fix: 'по соглашению сторон' }],
            counterpartyEdits: []
        };
    }
    if (req.task === 'evaluate') return { title: 'graded' };
    throw new Error(`unexpected task ${req.task}`);
}

const result = (req: any, data: unknown) => ({ data: req.schema.parse(data), tokensIn: 10, tokensOut: 5, cacheRead: 0, cacheWrite: 0, costUsd: 0.0001, model: 'fake' });

const fake = {
    async generateJson(req: any) {
        direct.push(req.task);
        return result(req, answer(req));
    },
    batch: {
        async submit(items: { customId: string; req: any }[]) {
            batches.push(items);
            return `batch-${batches.length}`;
        },
        async ended() {
            return true;
        },
        async *results(id: string) {
            for (const it of batches[Number(id.split('-')[1]) - 1]) yield { customId: it.customId, ok: true as const, message: { text: JSON.stringify(answer(it.req)) } };
        },
        parse(message: any, req: any) {
            if (schemaMissOnce) {
                schemaMissOnce = false;
                throw Object.assign(new Error('miss'), { name: 'SchemaMismatch' });
            }
            return { ...result(req, JSON.parse(message.text)), costUsd: 0.00005 };
        }
    }
};

async function api(p: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
    const res = await fetch(`${base}/api/v1${p}`, {
        method: opts.method ?? (opts.body ? 'POST' : 'GET'),
        headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri('caselab');
    const { setLlmForTests } = await import('../src/modules/ai/claude.provider');
    setLlmForTests(fake as any);
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

test('batches: admin drafts are queued and finished by the worker, the case pool feeds new tasks', async () => {
    const { batchTick } = await import('../src/modules/ai/batch');
    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-123' } });
    r = await api('/auth/change-password', { token: r.body.accessToken, body: { currentPassword: 'admin-pass-123', newPassword: 'admin-pass-456' } });
    const admin = r.body.accessToken;

    // An AI document draft: 202 with a job, nothing called directly
    r = await api('/admin/documents/generate', { token: admin, body: { type: 'contract', topic: 'поставка стройматериалов', language: 'ru', parties: [{ key: 'buyer', name: { ru: 'Покупатель', uz: '' } }, { key: 'supplier', name: { ru: 'Поставщик', uz: '' } }], flawsCount: 1, editsCount: 0 } });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.job.status, 'queued');
    assert.deepEqual(direct, []);
    r = await api('/admin/ai/jobs', { token: admin });
    assert.equal(r.body.jobs[0].label, 'поставка стройматериалов');

    // One tick sends the batch, the next one collects it; a schema miss falls back to one direct call
    await batchTick();
    assert.equal(batches.length, 1);
    assert.ok(batches[0][0].req.system.includes('учебные документы'), 'the request is rebuilt from the stored prompt parts');
    schemaMissOnce = true;
    await batchTick();
    assert.deepEqual(direct, ['generateFlawedDocument'], 'only the missed answer was asked again');
    r = await api('/admin/ai/jobs', { token: admin });
    const job = r.body.jobs[0];
    assert.equal(job.status, 'done', JSON.stringify(job));
    r = await api(`/admin/documents/${job.result.document._id}`, { token: admin });
    assert.equal(r.body.document.status, 'draft');
    assert.equal(r.body.document.flaws.length, 1);

    // The cost of the AI per task, the batch share included
    r = await api('/admin/ai/usage', { token: admin });
    const usage = r.body.items.find((i: any) => i.purpose === 'generateFlawedDocument');
    assert.ok(usage && usage.batch >= 1, JSON.stringify(r.body));

    // A template with values: 5 tasks in a week make a demand of 2 prepared cases a day
    r = await api('/admin/templates', { token: admin, body: {
        taskType: 'draft_full', skills: [{ key: 'claim.prayer', weight: 1 }], difficulty: 2,
        title: { ru: 'Иск о долге', uz: '' }, instructions: { ru: 'Составьте иск', uz: '' },
        context: { role: { ru: 'Юрист истца', uz: '' }, today: '' },
        caseText: { ru: 'Покупатель не оплатил {{debt}} по договору поставки.', uz: '' },
        variablesSchema: [{ key: 'debt', kind: 'money', min: 10000000, max: 90000000, step: 1000000 }],
        referenceAnswer: { ru: 'Эталон', uz: '' }, checklist: [{ ru: 'Суд', uz: '' }], status: 'published'
    } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const templateId = r.body.template._id;
    const reg = await api('/auth/register', { body: { fullName: 'Студент Пула', email: 'pool@test.local', password: 'student-pass', course: 3, locale: 'ru' } });
    const student = reg.body.accessToken;
    for (let i = 0; i < 5; i++) await api(`/tasks/from-template/${templateId}`, { token: student, body: {} });
    assert.equal(direct.filter(t => t === 'generateInstance').length, 5, 'no pool yet: written on the spot');

    const { planPool } = await import('../src/modules/tasks/instance-pool');
    const { tashkentToday } = await import('../src/modules/legal/engines/dates');
    assert.equal(await planPool([tashkentToday()]), 2);
    assert.equal(await planPool([tashkentToday()]), 0, 'queued jobs count: planning again adds nothing');
    await batchTick();
    await batchTick();
    const { InstanceVariant } = await import('../src/modules/tasks/task.model');
    assert.equal(await InstanceVariant.countDocuments({ templateId }), 2);

    // The next task takes a prepared case with its own values: no direct call
    r = await api(`/tasks/from-template/${templateId}`, { token: student, body: {} });
    assert.equal(r.status, 201);
    assert.ok(r.body.instance.content.caseText.startsWith('Подготовленный заранее казус'), r.body.instance.content.caseText);
    assert.equal(direct.filter(t => t === 'generateInstance').length, 5);
    assert.equal(await InstanceVariant.countDocuments({ templateId }), 1, 'a prepared case is used once');

    // An edited template makes its prepared cases stale
    const { TaskTemplate } = await import('../src/modules/content/content.model');
    await TaskTemplate.updateOne({ _id: templateId }, { $set: { 'title.ru': 'Иск о долге (ред.)' } });
    r = await api(`/tasks/from-template/${templateId}`, { token: student, body: {} });
    assert.equal(r.status, 201);
    assert.equal(direct.filter(t => t === 'generateInstance').length, 6, 'written on the spot');
    assert.equal(await InstanceVariant.countDocuments({ templateId }), 1, 'the stale case is not taken');
});

test('batch collector: calls made together go out as one batch and each gets its own answer', async () => {
    const { collectIntoBatch } = await import('../src/modules/ai/batch-collector');
    const { getLlm } = await import('../src/modules/ai/claude.provider');
    const { z } = await import('zod');
    const schema = z.object({ title: z.string() });
    const before = batches.length;
    const out = await collectIntoBatch(
        () => Promise.all([1, 2, 3].map(i => getLlm()!.generateJson({ task: 'evaluate', system: 's', user: `u${i}`, schema }))),
        { idleMs: 20, pollMs: 10 }
    );
    assert.equal(batches.length, before + 1);
    assert.equal(batches.at(-1)!.length, 3);
    assert.deepEqual(out.map(o => o.data.title), ['graded', 'graded', 'graded']);
    assert.equal(getLlm(), fake as any, 'the provider is restored');
});
