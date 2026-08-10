import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workdirIndex = process.argv.indexOf('--workdir');
if (workdirIndex === -1 || !process.argv[workdirIndex + 1]) {
  throw new Error('Usage: node scripts/runMvp3StoragePolicyProductionShapeSimulation.mjs --workdir <disposable-project>');
}
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const status = execFileSync(process.execPath, [
  npxCli, '--yes', 'supabase@2.110.0', '--workdir', resolve(process.argv[workdirIndex + 1]),
  'status', '--output', 'env',
], { encoding: 'utf8' });
const apiUrl = status.match(/^API_URL="([^"]+)"$/m)?.[1];
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(apiUrl ?? '')) {
  throw new Error('Refusing production-shape simulation outside a loopback Supabase stack.');
}

const oldPath = join(repoRoot, 'supabase', 'migrations', '20260810055845_mvp3_meal_photo_lifecycle_closure.sql');
const correctionPath = join(repoRoot, 'supabase', 'migrations', '20260810074910_mvp3_real_storage_upload_policy_correction.sql');
const verificationPath = join(repoRoot, 'supabase', 'verification', 'mvp3_meal_photo_lifecycle_verification.sql');
const oldSql = readFileSync(oldPath, 'utf8');
const oldHash = createHash('sha256').update(oldSql).digest('hex');
if (oldHash !== '4e0f6e16b100e46c17b5f05bd45d14b425811d457314ae41f2f5c1888e560ab0') {
  throw new Error(`Applied MVP-3 migration artifact changed: ${oldHash}`);
}
const oldPolicy = oldSql.match(/create policy meal_photo_objects_insert_active_approved_dietitian[\s\S]+?\n\);\n\ncreate policy meal_photo_objects_select_referenced_linked_actor/i)?.[0]
  .replace(/\n\ncreate policy meal_photo_objects_select_referenced_linked_actor[\s\S]*$/i, '');
if (!oldPolicy || !oldPolicy.includes("metadata ->> 'size'")) {
  throw new Error('Could not extract the exact applied defective INSERT policy.');
}

const psql = (input) => {
  const result = spawnSync('docker', [
    'exec', '-i', 'supabase_db_DietBridge-Web', 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', 'postgres', '-At',
  ], { input, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim());
  return result.stdout;
};

psql(`begin;
do $$ begin
  if (select count(*) from pg_policies where schemaname='storage' and tablename='objects'
      and lower(coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%meal-photos%') <> 2 then
    raise exception 'Unexpected production-shape policy surface.';
  end if;
end $$;
drop policy meal_photo_objects_insert_active_approved_dietitian on storage.objects;
${oldPolicy}
commit;`);
process.stdout.write('PASS: PRODUCTION_SHAPE_DEFECTIVE_POLICY_RESTORED\n');

psql(readFileSync(correctionPath, 'utf8'));
process.stdout.write('PASS: PRODUCTION_SHAPE_FORWARD_CORRECTION_APPLIED\n');

const verification = psql(readFileSync(verificationPath, 'utf8'));
const failed = verification.split(/\r?\n/).filter((line) => line.includes('|f'));
if (failed.length > 0 || !verification.includes('POLICY-03 real Storage INSERT contract|t')) {
  throw new Error(`Production-shape verification failed: ${failed.join(', ')}`);
}
process.stdout.write('PASS: PRODUCTION_SHAPE_VERIFICATION_12_OF_12\n');

execFileSync(process.execPath, [
  join(repoRoot, 'scripts', 'runDisposableMealPhotoStorageHttpHarness.mjs'),
  '--workdir', resolve(process.argv[workdirIndex + 1]),
], { cwd: repoRoot, stdio: 'inherit' });
process.stdout.write('PASS: PRODUCTION_SHAPE_REAL_STORAGE_HTTP_MATRIX\n');
