import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const isolatedMigrations = [
  '20260814214101_notification_core_backend.sql',
  '20260817084531_appointment_reminders_backend.sql',
  '20260817120000_push_registry_outbox_backend.sql',
  '20260901165402_client_account_deletion_backend.sql',
];

export const addCurrentIsolatedMigrations = ({ repoRoot, tempRoot }) => {
  const sourceDirectory = join(repoRoot, 'supabase', 'migrations');
  const destinationDirectory = join(tempRoot, 'supabase', 'migrations');
  for (const migration of isolatedMigrations) {
    const destination = join(destinationDirectory, migration);
    if (existsSync(destination)) throw new Error(`Disposable migration already exists: ${migration}`);
    copyFileSync(join(sourceDirectory, migration), destination, 1);
  }
  const count = readdirSync(destinationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).length;
  if (count !== 58) throw new Error(`Current disposable migration count must be 58, received ${count}.`);
  return { canonical: 57, localPrerequisite: 1, total: count };
};
