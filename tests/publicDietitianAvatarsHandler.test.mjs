import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePublicDietitianAvatars } from '../supabase/functions/public-dietitian-avatars/handler.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const request = (body, authorization = 'Bearer fake') => new Request('https://example.invalid', {
  method: 'POST', headers: authorization ? { authorization } : {}, body: JSON.stringify(body),
});

test('signs only canonical paths the authenticated RPC returned for requested ids', async () => {
  const signed = [];
  const response = await handlePublicDietitianAvatars(request({ dietitianIds: [A, B, A] }), {
    paths: async (ids) => {
      assert.deepEqual(ids, [A, B]);
      return [
        { id: A, avatar_path: `${A}/avatar.jpg` },
        { id: B, avatar_path: `${A}/avatar.jpg` },
        { id: '33333333-3333-4333-8333-333333333333', avatar_path: '33333333-3333-4333-8333-333333333333/avatar.png' },
      ];
    },
    sign: async (path) => { signed.push(path); return `https://example.invalid/${path}`; },
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { result: 'ready', avatars: { [A]: `https://example.invalid/${A}/avatar.jpg` } });
  assert.deepEqual(signed, [`${A}/avatar.jpg`]);
});

test('rejects missing auth, malformed ids and oversized lists before any lookup', async () => {
  const dependencies = { paths: async () => assert.fail('must not query'), sign: async () => assert.fail('must not sign') };
  assert.equal((await handlePublicDietitianAvatars(request({ dietitianIds: [A] }, ''), dependencies)).status, 401);
  assert.equal((await handlePublicDietitianAvatars(request({ dietitianIds: ['not-a-uuid'] }), dependencies)).status, 400);
  assert.equal((await handlePublicDietitianAvatars(request({ dietitianIds: Array(51).fill(A) }), dependencies)).status, 400);
  assert.deepEqual(await (await handlePublicDietitianAvatars(request({ dietitianIds: [] }), dependencies)).json(), { result: 'ready', avatars: {} });
});

test('backend errors fail closed without leaking details and sign failures fall back to initials', async () => {
  const failing = await handlePublicDietitianAvatars(request({ dietitianIds: [A] }), {
    paths: async () => { throw new Error('private database error'); }, sign: async () => null,
  });
  assert.equal(failing.status, 400); assert.equal((await failing.text()).includes('private database'), false);
  const partial = await handlePublicDietitianAvatars(request({ dietitianIds: [A] }), {
    paths: async () => [{ id: A, avatar_path: `${A}/avatar.webp` }], sign: async () => { throw new Error('storage down'); },
  });
  assert.deepEqual(await partial.json(), { result: 'ready', avatars: {} });
});
