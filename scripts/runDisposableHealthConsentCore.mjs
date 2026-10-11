import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';

// A local-only PostgreSQL core fixture; no remote keys, linked projects or ports.
assertCiSafeEnvironment();
const name = `dietbridge-consent-${randomUUID().slice(0,8)}`;
const docker = (args, options = {}) => execFileSync('docker',args,{ encoding:'utf8', timeout:60000, ...options });
let started = false;
try {
  docker(['run','--detach','--name',name,'--network','none','--env','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);
  started = true;
  let ready = false;
  for (let attempt=0; attempt<60; attempt+=1) {
    // The image briefly starts an initialization server on a Unix socket.
    // Wait for the final TCP listener so tests cannot race that server's stop.
    try { docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']); ready=true; break; }
    catch { await delay(500); }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  for (const file of [
    'supabase/tests/disposable/health_consent_bootstrap.sql',
    'supabase/migrations/20261011191135_health_data_consent.sql',
    'supabase/tests/health_consent_contract.sql',
  ]) {
    const result = docker(['exec','-i',name,'psql','-h','127.0.0.1','-X','-U','postgres','-v','ON_ERROR_STOP=1','-f','-'],
      {input:readFileSync(new URL('../'+file,import.meta.url),'utf8')});
    if (file.endsWith('health_consent_contract.sql') && !result.includes('HEALTH_CONSENT_CORE_CONTRACT_PASS')) {
      throw new Error('Missing SQL contract success marker');
    }
    process.stdout.write(`PASS: ${file}\n`);
  }
} finally {
  if (started) docker(['rm','--force','--volumes',name]);
}
