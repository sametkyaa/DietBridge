import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText).toString('base64')}`;
const { createReadFetch } = await import(moduleUrl(source('lib/readFetch.ts')));
const moveUrl = moduleUrl(source('features/meal-plans/utils/mealPlanMove.ts'));
const { applyMealImagePreviews } = await import(moduleUrl(source('features/meal-plans/utils/mealPlanPreview.ts').replace("'./mealPlanMove'", JSON.stringify(moveUrl))));
const origin = 'https://test.invalid';
const signUrl = `${origin}/storage/v1/object/sign/recipe-images/path`;
const sign = (token = 'owner-a') => ({ method: 'POST', headers: { authorization: token }, body: '{"expiresIn":300}' });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('concurrent signed-image reads share a request and each consumer can read its response', async () => {
  const pending = deferred(); let calls = 0;
  const fetcher = createReadFetch(async () => { calls++; return pending.promise; }, origin);
  const first = fetcher(signUrl, sign()); const second = fetcher(signUrl, sign());
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve(Response.json({ signedURL: '/private-image' }));
  const results = await Promise.all([first, second]);
  assert.deepEqual(await results[0].json(), await results[1].json());
  await fetcher(signUrl, sign());
  assert.equal(calls, 2, 'completed responses must not mask a later permission recheck');
});

test('image requests with different identities are never shared', async () => {
  let calls = 0;
  const fetcher = createReadFetch(async () => { calls++; return Response.json({}); }, origin);
  await Promise.all([fetcher(signUrl, sign('owner-a')), fetcher(signUrl, sign('owner-b'))]);
  assert.equal(calls, 2);
});

test('image concurrency is limited, DB reads proceed and queued timeouts release the queue', async () => {
  let active = 0; let peak = 0;
  const firstBatch = deferred();
  const fetcher = createReadFetch(async (input) => {
    if (String(input).includes('/rest/v1/')) return Response.json({ id: 'ready' });
    active++; peak = Math.max(peak, active);
    await firstBatch.promise; active--;
    return Response.json({ signedURL: 'image' });
  }, origin);
  const images = Array.from({ length: 9 }, (_, index) => fetcher(`${signUrl}-${index}`, sign()));
  assert.deepEqual(await (await fetcher(`${origin}/rest/v1/meal_plans`)).json(), { id: 'ready' });
  assert.equal(peak, 4);
  firstBatch.resolve(); await Promise.all(images); assert.equal(peak, 4);

  let blockedCalls = 0;
  const blocked = createReadFetch(async () => { blockedCalls++; return new Promise(() => {}); }, origin, { readMs: 10, imageMs: 10 });
  await Promise.all(Array.from({ length: 8 }, (_, index) => assert.rejects(blocked(`${signUrl}-${index}`, sign()), { name: 'AbortError' })));
  const beforeRetry = blockedCalls;
  await assert.rejects(blocked(signUrl, sign()), { name: 'AbortError' });
  assert.equal(blockedCalls, beforeRetry + 1);
});

test('stalled read aborts, releases the shared request and permits retry', async () => {
  const signals = [];
  const fetcher = createReadFetch(async (_, init) => { signals.push(init.signal); return new Promise(() => {}); }, origin, { readMs: 15, imageMs: 15 });
  await Promise.all([assert.rejects(fetcher(signUrl, sign()), { name: 'AbortError' }), assert.rejects(fetcher(signUrl, sign()), { name: 'AbortError' })]);
  assert.equal(signals.length, 1); assert.equal(signals[0].aborted, true);
  await assert.rejects(fetcher(signUrl, sign()), { name: 'AbortError' });
  assert.equal(signals.length, 2);
});

test('deadline includes a stalled JSON body even after headers arrive', async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } }));
  const fetcher = createReadFetch(async () => response, origin, { readMs: 10, imageMs: 10 });
  await assert.rejects(fetcher(`${origin}/rest/v1/meal_plans`), { name: 'AbortError' });
});

test('actual Supabase SDK does not automatically retry a timed-out read', async () => {
  let calls = 0;
  const fetcher = createReadFetch(async () => { calls++; return new Promise(() => {}); }, origin, { readMs: 10, imageMs: 10 });
  const client = createClient(origin, 'fixture-placeholder', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
  const result = await client.from('meal_plans').select('id');
  assert.equal(result.data, null); assert.ok(result.error); assert.equal(calls, 1);
});

test('DB reads are not cached and user cancellation is forwarded', async () => {
  let calls = 0; let signal;
  const fetcher = createReadFetch(async (_, init) => { calls++; signal = init.signal; return Response.json({}); }, origin);
  await Promise.all([fetcher(`${origin}/rest/v1/profiles`), fetcher(`${origin}/rest/v1/profiles`)]);
  assert.equal(calls, 2);
  const controller = new AbortController(); controller.abort();
  await fetcher(`${origin}/rest/v1/profiles`, { signal: controller.signal });
  assert.equal(signal.aborted, true);
});

test('mutations, RPC, upload and other hosts retain their original request options', async () => {
  let received;
  const fetcher = createReadFetch(async (input, init) => { received = [input, init]; return Response.json({}); }, origin);
  for (const [url, init] of [
    [`${origin}/rest/v1/meal_plans`, { method: 'PATCH', body: '{}' }],
    [`${origin}/rest/v1/rpc/save_weekly_meal_plan`, { method: 'POST', body: '{}' }],
    [`${origin}/rest/v1/rpc/read_counts`, { method: 'GET' }],
    [`${origin}/storage/v1/object/meal-photos/path`, { method: 'POST', body: 'file' }],
    ['https://elsewhere.invalid/rest/v1/plans', { method: 'GET' }],
  ]) { await fetcher(url, init); assert.equal(received[0], url); assert.equal(received[1], init); }
});

test('late previews preserve edited nutrition, moved cells, removed photos and local files', () => {
  const original = { id: 'meal', name: 'Düzenlenen öğün', calories: 450, image: 'old-path', imagePreview: null, macros: { protein: 10, carbs: 30, fat: 5 } };
  const local = { ...original, imagePreview: 'blob:local', pendingPhoto: { name: 'new.webp' } };
  const changed = { ...original, image: 'new-path' };
  const removed = { ...original, image: null };
  const plan = { Pazartesi: { moved: original, local, changed, removed, custom: 'Serbest öğün', empty: null } };
  const next = applyMealImagePreviews(plan, new Map([['old-path', 'signed-url']]));
  assert.deepEqual(next.Pazartesi.moved, { ...original, imagePreview: 'signed-url' });
  for (const id of ['local', 'changed', 'removed', 'custom', 'empty']) assert.equal(next.Pazartesi[id], plan.Pazartesi[id]);
  assert.equal(plan.Pazartesi.moved.imagePreview, null);
  assert.equal(applyMealImagePreviews(next, new Map([['old-path', 'late-url']])), next);
});
