import test from 'node:test';
import assert from 'node:assert/strict';
import { handleInvitePreview } from '../supabase/functions/preview-dietitian-invite/handler.ts';

const request = body => new Request('https://example.invalid', { method: 'POST', headers: { authorization: 'Bearer fake' }, body: JSON.stringify(body) });
test('preview signs only the dietitian returned by the authenticated RPC', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  let signed;
  const response = await handleInvitePreview(request({ code: 'DB-TEST', dietitianId: 'attacker' }), {
    preview: async () => ({ result: 'ready', dietitian: { id, display_name: 'Test', professional_title: 'Diyetisyen', avatar_url: null } }),
    avatar: async value => { signed = value; return 'https://example.invalid/signed'; },
  });
  assert.equal(signed, id); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).dietitian.avatar_url, 'https://example.invalid/signed');
});
test('invalid and rate limited previews never sign an avatar', async () => {
  for (const result of ['not_found', 'closed', 'rate_limited']) {
    const response = await handleInvitePreview(request({ code: 'bad' }), { preview: async () => ({ result }), avatar: async () => assert.fail('must not sign') });
    assert.deepEqual(await response.json(), { result });
  }
});
test('missing auth and raw backend errors fail closed', async () => {
  const dependencies = { preview: async () => { throw new Error('private database error'); }, avatar: async () => null };
  assert.equal((await handleInvitePreview(new Request('https://example.invalid', { method: 'POST' }), dependencies)).status, 401);
  const response = await handleInvitePreview(request({ code: 'test' }), dependencies);
  assert.equal(response.status, 400); assert.equal((await response.text()).includes('private database'), false);
});
