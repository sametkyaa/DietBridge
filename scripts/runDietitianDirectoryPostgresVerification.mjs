// Focused PostgreSQL verification for the dietitian directory migration.
// Needs a throwaway local database URL (localhost only). The surrounding
// Auth/relationship tables are minimal fixtures; the relationship transition,
// notification and invite actor functions are taken from the real migrations.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2];
if (!url || !/^postgres(ql)?:\/\/[^@]*@?(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  throw new Error('Pass a disposable local PostgreSQL URL, e.g. postgresql://postgres@127.0.0.1:55432/directory_check');
}
const read = (path) => readFileSync(join(repo, path), 'utf8');
const extract = (file, signature) => {
  const source = read(`supabase/migrations/${file}`);
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Missing ${signature} in ${file}`);
  const end = source.indexOf('$function$;', start);
  const endAlt = source.indexOf('$$;', start);
  const stop = [end, endAlt].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  return source.slice(start, stop + (stop === end ? '$function$;'.length : 3));
};
const psql = (input) => execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q'], { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
psql(read('supabase/tests/disposable/dietitian_directory_focused_bootstrap.sql'));
psql([
  extract('20260725133956_20260725160000_client_relationship_security_contract_forward_fix.sql', 'create or replace function public.enforce_dietitian_client_transition()'),
  extract('20261005120859_dietitian_invite_codes.sql', 'create or replace function private.require_invite_actor'),
  extract('20261005120859_dietitian_invite_codes.sql', 'create or replace function private.notify_dietitian_client_change()'),
  extract('20260812090000_mvp7_subscription_plans_and_client_limits.sql', 'create or replace function public.dietitian_active_client_usage'),
  'create trigger trg_enforce_dietitian_client_transition before insert or update on public.dietitian_clients for each row execute function public.enforce_dietitian_client_transition();',
  'create trigger trg_notify_dietitian_client_change after insert or update on public.dietitian_clients for each row execute function private.notify_dietitian_client_change();',
].join('\n\n'));
const migration = read('supabase/migrations/20261016130000_dietitian_directory_inquiries.sql');
psql(migration); console.log('PASS directory migration applies');
psql(migration); console.log('PASS directory migration re-applies');
const output = psql(read('supabase/tests/dietitian_directory_contract.sql'));
if (!output.includes('DIETITIAN_DIRECTORY_CONTRACT_PASS')) throw new Error('Directory contract did not pass.');
console.log('DIETITIAN_DIRECTORY_POSTGRES_VERIFICATION_PASS');
