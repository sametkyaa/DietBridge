import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApplicationResultEmail,
  handleApplicationResultEmails,
} from '../supabase/functions/send-application-result-emails/handler.ts';

const request = (authorization = 'Bearer token') => new Request('https://example.invalid', {
  method: 'POST',
  headers: authorization ? { authorization } : {},
});
const row = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  recipient_email: 'dyt@example.invalid',
  recipient_name: 'Ayşe Yılmaz',
  decision: 'approved',
  rejection_reason: null,
  attempts: 1,
  ...overrides,
});
const deps = (overrides = {}) => ({
  config: { providerConfigured: true, panelUrl: 'https://panel.example.invalid' },
  authorize: async () => 'admin',
  claim: async () => [],
  complete: async () => undefined,
  send: async () => ({ id: 'msg-1' }),
  ...overrides,
});

test('missing bearer token is rejected before any queue access', async () => {
  const response = await handleApplicationResultEmails(request(''), deps({ claim: async () => assert.fail('must not claim') }));
  assert.equal(response.status, 401);
});

test('non-admin callers cannot drain the queue', async () => {
  const response = await handleApplicationResultEmails(request(), deps({
    authorize: async () => 'denied',
    claim: async () => assert.fail('must not claim'),
  }));
  assert.equal(response.status, 403);
});

test('without provider configuration nothing is claimed or reported as sent', async () => {
  const response = await handleApplicationResultEmails(request(), deps({
    config: { providerConfigured: false, panelUrl: '' },
    claim: async () => assert.fail('must not claim'),
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { result: 'provider_not_configured' });
});

test('sent and failed rows are completed with the real outcome', async () => {
  const completions = [];
  const response = await handleApplicationResultEmails(request(), deps({
    claim: async () => [row(), row({ id: '22222222-2222-4222-8222-222222222222', recipient_email: 'fail@example.invalid' })],
    send: async (message) => {
      if (message.to.startsWith('fail')) throw new Error('provider_status_500');
      return { id: 'msg-ok' };
    },
    complete: async (...args) => { completions.push(args); },
  }));
  assert.deepEqual(await response.json(), { result: 'ok', claimed: 2, sent: 1, failed: 1 });
  assert.deepEqual(completions, [
    ['11111111-1111-4111-8111-111111111111', true, 'msg-ok', null],
    ['22222222-2222-4222-8222-222222222222', false, null, 'provider_status_500'],
  ]);
});

test('approval and rejection copy are distinct and escape HTML', () => {
  const approved = buildApplicationResultEmail(row(), 'https://panel.example.invalid');
  assert.match(approved.subject, /onaylandı/);
  assert.match(approved.text, /https:\/\/panel\.example\.invalid/);
  const rejected = buildApplicationResultEmail(row({ decision: 'rejected', rejection_reason: '<b>Diploma</b> okunamadı' }), 'https://panel.example.invalid');
  assert.match(rejected.subject, /hakkında/);
  assert.match(rejected.text, /Gerekçe: <b>Diploma<\/b> okunamadı/);
  assert.ok(!rejected.html.includes('<b>Diploma'));
  assert.ok(rejected.html.includes('&lt;b&gt;Diploma'));
});
