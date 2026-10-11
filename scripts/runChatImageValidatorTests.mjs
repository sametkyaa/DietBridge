import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';

// Execute pure Edge-handler Deno.test cases under Node 24 using Web APIs.
// This adapter does not replace validation on the actual Deno/Edge runtime.
assertCiSafeEnvironment();
const dir = await mkdtemp(join(tmpdir(), 'dietbridge-validator-'));
const tests = [];
const previousDeno = globalThis.Deno;
try {
  const output = join(dir, 'tests.mjs');
  await build({ entryPoints: [new URL('../supabase/functions/validate-chat-image/handler.test.ts', import.meta.url).pathname],
    outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node24', plugins: [{
      // Handler cases inject validateJpeg. Fail if an unexpected real decode is
      // attempted; JPEG decoder tests remain in the separate Deno test suite.
      name: 'unused-jpeg-decoder',
      setup(builder) {
        builder.onResolve({ filter: /^jpeg-js$/ }, () => ({ path: 'jpeg-js', namespace: 'handler-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'handler-test' }, () => ({
          contents: 'export default { decode() { throw new Error("Unexpected JPEG decode in handler test"); } };',
          loader: 'js',
        }));
      },
    }] });
  globalThis.Deno = { test: (name, run) => tests.push({ name, run }), env: { get: () => undefined } };
  await import(pathToFileURL(output).href);
  if (tests.length === 0) throw new Error('No validator cases registered');
  for (const { name, run } of tests) {
    await run();
    process.stdout.write(`PASS: ${name}\n`);
  }
  process.stdout.write(`Validator handler: ${tests.length} cases passed (Node adapter).\n`);
} finally {
  if (previousDeno === undefined) delete globalThis.Deno;
  else globalThis.Deno = previousDeno;
  await rm(dir, { recursive: true, force: true });
}
