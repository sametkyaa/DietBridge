import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDispatch } from '../supabase/functions/dispatch-push/handler.ts';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const claimId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secret = 'synthetic-dispatch-secret-for-isolated-tests';
const job = { id, claimId, notificationId: id, category: 'chat_message', token: 'ExpoPushToken[fixture]', appVersion: '1.0.4', conversationId: claimId };
const request = (value = secret) => new Request('https://fixture.invalid/dispatch', { method: 'POST', headers: { 'x-dispatch-secret': value } });
const fixture = (overrides = {}) => {
    const requests = [], outcomes = [];
    return { requests, outcomes, deps: {
        secret, claim: async kind => kind === 'send' ? [job] : [], prepare: async () => true,
        finish: async (...args) => { outcomes.push(args); return true; },
        fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return Response.json({ data: [{ status: 'ok', id: 'fixture-ticket' }] }); },
        ...overrides,
    } };
};
test('chat sends high priority/new channel, generic content and validated routing IDs', async () => {
    const f = fixture();
    assert.equal((await handleDispatch(request(), f.deps)).status, 200);
    const message = f.requests[0].body[0];
    assert.equal(message.channelId, 'dietbridge-chat-v1'); assert.equal(message.priority, 'high');
    assert.equal(message.sound, 'default'); assert.equal(message.body, 'Yeni bir mesajınız var.');
    assert.deepEqual(message.data, { notificationId: id, version: 1, category: 'chat_message', conversationId: claimId });
    assert.equal(f.outcomes[0][1], 'ticketed');
});
test('legacy/unknown versions preserve existing installed channel', async () => {
    for (const appVersion of [undefined, '1.0.3', 'malformed']) {
        const f = fixture({ claim: async kind => kind === 'send' ? [{ ...job, appVersion }] : [] });
        await handleDispatch(request(), f.deps);
        assert.equal(f.requests[0].body[0].channelId, 'dietbridge-silent'); assert.equal(f.requests[0].body[0].priority, 'high');
    }
});
test('appointments/relationship payload behavior is preserved', async () => {
    for (const category of ['appointment', 'relationship']) {
        const f = fixture({ claim: async kind => kind === 'send' ? [{ ...job, category }] : [] });
        await handleDispatch(request(), f.deps);
        const message = f.requests[0].body[0];
        assert.equal(message.channelId, category === 'appointment' ? 'dietbridge-appointments' : 'dietbridge-silent');
        assert.equal(Object.hasOwn(message, 'priority'), false); assert.equal(Object.hasOwn(message.data, 'conversationId'), false);
    }
});
test('invalid secret/non-POST never claims queue or contacts provider', async () => {
    let claims = 0;
    const f = fixture({ claim: async () => { claims += 1; return []; } });
    assert.equal((await handleDispatch(request('wrong'), f.deps)).status, 401);
    assert.equal((await handleDispatch(new Request('https://fixture.invalid'), f.deps)).status, 405);
    assert.equal(claims, 0); assert.equal(f.requests.length, 0);
});
test('withdrawn/read source rejected by prepare never reaches Expo', async () => {
    const f = fixture({ prepare: async () => false });
    assert.equal((await handleDispatch(request(), f.deps)).status, 200); assert.equal(f.requests.length, 0);
});
test('ambiguous sends are not repeated blindly; provider rate errors remain retryable', async () => {
    const timeout = fixture({ fetch: async () => { throw new Error('synthetic timeout'); } });
    await handleDispatch(request(), timeout.deps);
    assert.equal(timeout.outcomes[0][1], 'permanent'); assert.equal(timeout.outcomes[0][3], 'ambiguous_delivery');
    const rate = fixture({ fetch: async () => new Response('', { status: 429 }) });
    await handleDispatch(request(), rate.deps); assert.equal(rate.outcomes[0][1], 'retryable');
});
