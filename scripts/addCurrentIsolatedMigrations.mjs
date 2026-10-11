import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const isolatedMigrations = [
  '20260814214101_notification_core_backend.sql',
  '20260817084531_appointment_reminders_backend.sql',
  '20260817120000_push_registry_outbox_backend.sql',
  '20260901165402_client_account_deletion_backend.sql',
  '20260901193000_client_account_deletion_hardening.sql',
  '20260901200413_client_account_deletion_scope_tightening.sql',
  '20261005120000_realtime_publication_core_tables.sql',
  '20261005120100_save_active_client_weight_canonical.sql',
];

// Faz 2 migrations: applied after the 62-file current chain by the Faz 2
// runtime harness and the critical E2E gate.
export const FAZ2_MIGRATIONS = Object.freeze([
  '20261006090000_meal_change_request_security.sql',
  '20261006090100_dietitian_unread_message_counts.sql',
  '20261006090200_client_nutrition_targets.sql',
  '20261006090300_profile_legal_acceptance.sql',
  '20261006090400_dietitian_activity_notifications.sql',
  '20261006090500_meal_slot_label.sql',
  '20261006090600_application_result_email_outbox.sql',
]);

export const addFaz2Migrations = ({ repoRoot, tempRoot }) => {
  const sourceDirectory = join(repoRoot, 'supabase', 'migrations');
  const destinationDirectory = join(tempRoot, 'supabase', 'migrations');
  for (const migration of FAZ2_MIGRATIONS) {
    const destination = join(destinationDirectory, migration);
    if (existsSync(destination)) throw new Error(`Disposable migration already exists: ${migration}`);
    copyFileSync(join(sourceDirectory, migration), destination, 1);
  }
  const count = readdirSync(destinationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).length;
  if (count !== 62 + FAZ2_MIGRATIONS.length) throw new Error(`Faz 2 disposable migration count must be ${62 + FAZ2_MIGRATIONS.length}, received ${count}.`);
  return { total: count };
};

export const AUTOMATIC_TASK_DISMISSAL_MIGRATION = '20261006202442_automatic_task_dismissals.sql';

export const MEAL_REQUEST_CHAT_REPLY_MIGRATION = '20261010202019_meal_change_request_chat_replies.sql';

export const addMealRequestChatReplyMigration = ({ repoRoot, tempRoot }) => {
  const name = MEAL_REQUEST_CHAT_REPLY_MIGRATION;
  copyFileSync(join(repoRoot, 'supabase', 'migrations', name), join(tempRoot, 'supabase', 'migrations', name), 1);
};

export const addAutomaticTaskDismissalMigration = ({ repoRoot, tempRoot }) => {
  const name = AUTOMATIC_TASK_DISMISSAL_MIGRATION;
  copyFileSync(join(repoRoot, 'supabase', 'migrations', name), join(tempRoot, 'supabase', 'migrations', name), 1);
};

export const addCurrentIsolatedMigrations = ({ repoRoot, tempRoot }) => {
  const sourceDirectory = join(repoRoot, 'supabase', 'migrations');
  const destinationDirectory = join(tempRoot, 'supabase', 'migrations');
  for (const migration of isolatedMigrations) {
    const destination = join(destinationDirectory, migration);
    if (existsSync(destination)) throw new Error(`Disposable migration already exists: ${migration}`);
    copyFileSync(join(sourceDirectory, migration), destination, 1);
  }
  const count = readdirSync(destinationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).length;
  if (count !== 62) throw new Error(`Current disposable migration count must be 62, received ${count}.`);
  return { canonical: 61, localPrerequisite: 1, total: count };
};

// Remaining source migrations for the complete health-consent HTTP replay.
// Keep the list explicit so adding an omitted migration cannot silently pass.
export const HEALTH_RUNTIME_EXTRA_MIGRATIONS = Object.freeze([
  '20261005120859_dietitian_invite_codes.sql',
  '20261005124951_recipe_import_core.sql',
  '20261005132107_recipe_import_extraction_metrics.sql',
  '20261011103029_mobile_weight_istanbul_date.sql',
  '20261011191135_health_data_consent.sql',
  '20261011193450_health_consent_meal_paths.sql',
  '20261011195445_health_consent_chat_background_paths.sql',
]);

export const addHealthConsentRuntimeMigrations = ({ repoRoot, tempRoot }) => {
  const sourceDirectory = join(repoRoot, 'supabase', 'migrations');
  const destinationDirectory = join(tempRoot, 'supabase', 'migrations');
  const source = readdirSync(sourceDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const missing = source.filter((name) => !existsSync(join(destinationDirectory, name)));
  if (JSON.stringify(missing) !== JSON.stringify(HEALTH_RUNTIME_EXTRA_MIGRATIONS)) {
    throw new Error('Health runtime migration inventory changed; review the complete chain.');
  }
  for (const name of missing) copyFileSync(join(sourceDirectory, name), join(destinationDirectory, name), 1);
  const total = readdirSync(destinationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).length;
  if (total !== source.length + 1) throw new Error('Full source chain plus one local prerequisite expected.');
  return total;
};
