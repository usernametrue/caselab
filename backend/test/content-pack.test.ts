import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';

// The content pack in content/caselab-content-pack.json: imports without errors, and every template gives a task
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'admin-pass-123';
process.env.LOGS_DIR = '/tmp/caselab-test-logs';

const PACK = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'caselab-content-pack.json'), 'utf8'));
let mongo: MongoMemoryServer;
let server: Server;
let base = '';

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
    // No LLM: instances use the template text as is
    const { setLlmForTests } = await import('../src/modules/ai/claude.provider');
    setLlmForTests(null);
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

test('content pack: imports cleanly and every template generates a task', async () => {
    let r = await api('/auth/login', { body: { email: 'admin@test.local', password: 'admin-pass-123' } });
    r = await api('/auth/change-password', { token: r.body.accessToken, body: { currentPassword: 'admin-pass-123', newPassword: 'admin-pass-456' } });
    const admin = r.body.accessToken;

    r = await api('/admin/import?dryRun=1', { token: admin, body: PACK });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.errors, [], JSON.stringify(r.body.errors, null, 1));
    assert.deepEqual(r.body.warnings, []);
    assert.deepEqual(r.body.created, { documents: 12, scenarios: 3, templates: 39, tracks: 0, bodies: 3 });

    r = await api('/admin/import', { token: admin, body: PACK });
    assert.equal(r.status, 201, JSON.stringify(r.body.errors));
    assert.deepEqual(r.body.errors, []);
    // A second import of the same file updates, nothing is duplicated
    r = await api('/admin/import', { token: admin, body: PACK });
    assert.deepEqual(r.body.created, { documents: 0, scenarios: 0, templates: 0, tracks: 0, bodies: 0 });
    assert.equal(r.body.updated.templates, 39);

    // The lawyer's check is simulated: everything is published
    const { LegalDocument, Scenario, TaskTemplate } = await import('../src/modules/content/content.model');
    await LegalDocument.updateMany({ importKey: /^pack\./ }, { status: 'published' });
    await Scenario.updateMany({ importKey: /^pack\./ }, { status: 'published' });
    await TaskTemplate.updateMany({ importKey: /^pack\./ }, { status: 'published' });

    const reg = await api('/auth/register', { body: { fullName: 'Студент Пакета', email: 'pack@test.local', password: 'student-pass', course: 3, locale: 'ru' } });
    const student = reg.body.accessToken;
    await api('/me', { method: 'PATCH', token: student, body: { startLevel: 'beginner' } });
    const uz = (await api('/auth/register', { body: { fullName: 'Talaba', email: 'packuz@test.local', password: 'student-pass', course: 3, locale: 'uz' } })).body.accessToken;

    const { TaskInstance } = await import('../src/modules/tasks/task.model');
    const report: string[] = [];
    for (const t of await TaskTemplate.find({ importKey: /^pack\./ }).sort({ importKey: 1 }).lean()) {
        for (const [who, token] of [['ru', student], ['uz', uz]] as const) {
            r = await api(`/tasks/from-template/${t._id}`, { token, body: {} });
            assert.equal(r.status, 201, `${t.importKey} (${who}): ${JSON.stringify(r.body)}`);
            const inst = r.body.instance;
            assert.ok(inst.content.title && inst.content.instructions && inst.content.caseText, `${t.importKey} (${who}) has texts`);
            assert.ok(!/\{\{(?!PART)\w+\}\}/.test(JSON.stringify(inst.content)), `${t.importKey} (${who}): unfilled placeholder`);
            if (who === 'uz') assert.ok(!/[а-яё]{4,}/i.test(inst.content.title + inst.content.instructions) || t.taskType === 'sim_branching', `${t.importKey}: Uzbek texts`);
        }
        const engine = (await TaskInstance.findOne({ templateId: t._id }).lean())!.expected?.engine as any;
        if (engine?.kind === 'timeline') report.push(`${t.importKey}: ${engine.checks.map((c: any) => `${c.key} до ${c.endDate}${c.violated ? ' НАРУШЕН' : ''}`).join('; ')}`);
        if (engine?.kind === 'process') report.push(`${t.importKey}: срок ${engine.deadline?.endDate ?? '-'}, пошлина ${engine.fee?.fee ?? '-'}, суды ${engine.courts.length}`);
        if (engine?.kind === 'claim_requisites') report.push(`${t.importKey}: пошлина ${engine.fee}, суды ${engine.acceptableCourts.length}`);
    }
    console.log(report.join('\n'));
    const tl = (k: string) => report.find(x => x.startsWith(k))!;
    assert.match(tl('pack.tpl.timeline.appeal'), /acceptance до 2026-06-0\d; appeal до 2026-09-03 НАРУШЕН/);
    assert.match(tl('pack.tpl.timeline.order'), /issue до 2026-09-1\d; cancel до 2026-09-2\d НАРУШЕН/);
    assert.match(tl('pack.tpl.timeline.full_case'), /defects .* НАРУШЕН; response .* НАРУШЕН; appeal до 2026-06-15; cassation до 2027-02-10/);
});
