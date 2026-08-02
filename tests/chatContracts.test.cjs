const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const supabaseClient = require(path.join(buildDir, 'lib', 'supabaseClient.js'));
const receipts = require(path.join(buildDir, 'features', 'chat', 'utils', 'receipts.js'));
const chatService = require(path.join(buildDir, 'features', 'chat', 'services', 'chatService.js'));

const repoRoot = path.join(__dirname, '..');
const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const chatHardeningMigration = readRepoFile('supabase/migrations/20260802090000_chat_active_relationship_hardening.sql');
const harness = readRepoFile('supabase/tests/chat_security_harness.sql');
const productionRunbook = readRepoFile('docs/CHAT_PRODUCTION_SECURITY_HARNESS_RUNBOOK.md');
const stagingRunbook = readRepoFile('docs/CHAT_STAGING_APPLICATION_RUNBOOK.md');

const chatMigrationNames = [
  '20260726090000_chat_conversation_schema.sql',
  '20260726090100_chat_constraints_indexes.sql',
  '20260726090200_chat_rls.sql',
  '20260726090300_chat_rpc.sql',
  '20260727091215_chat_table_privilege_hardening.sql',
  '20260727094415_chat_realtime_publication.sql',
  '20260727131340_chat_legacy_message_text_compatibility.sql',
  '20260728103000_chat_delete_delivery_receipts.sql',
  '20260729090000_chat_image_schema.sql',
  '20260729090100_chat_image_rls_privileges.sql',
  '20260729090200_chat_image_rpc.sql',
  '20260729090300_chat_image_storage.sql',
  '20260729090400_chat_image_cleanup.sql',
  '20260730180636_chat_image_cleanup_scheduler.sql',
  '20260730180641_chat_image_rpc_activation.sql',
  '20260802090000_chat_active_relationship_hardening.sql',
];

const extractFunction = (source, functionName) => {
  const start = source.search(new RegExp(`(?:create|create or replace) function public\\.${functionName}\\b`, 'i'));
  assert.notEqual(start, -1, `Missing function definition: ${functionName}`);
  const end = source.indexOf('$function$;', start);
  assert.notEqual(end, -1, `Missing function body terminator: ${functionName}`);
  return source.slice(start, end + '$function$;'.length);
};

const assertActiveFunction = (source, functionName) => {
  const definition = extractFunction(source, functionName);
  assert.match(definition, /chat_has_active_relationship\s*\(/, `${functionName} must use the canonical active predicate`);
  return definition;
};

const ids = {
  conversation: '11111111-1111-4111-8111-111111111111',
  message: '22222222-2222-4222-8222-222222222222',
  sender: '33333333-3333-4333-8333-333333333333',
  clientMessage: '44444444-4444-4444-8444-444444444444',
};

const messageRow = (overrides = {}) => ({
  id: ids.message,
  conversation_id: ids.conversation,
  sender_id: ids.sender,
  client_message_id: ids.clientMessage,
  body: 'Merhaba',
  created_at: '2026-07-28T10:00:00.000Z',
  deleted_at: null,
  deleted_by: null,
  ...overrides,
});

test('chat forward hardening keeps one active relationship predicate across RLS and RPCs', () => {
  const helper = extractFunction(chatHardeningMigration, 'chat_has_active_relationship');
  assert.match(helper, /returns boolean/i);
  assert.match(helper, /security definer/i);
  assert.match(helper, /set search_path = pg_catalog, public/i);
  assert.match(helper, /dc\.status\s*=\s*'active'::public\.client_status/i);
  assert.match(helper, /auth\.uid\(\)/i);
  assert.match(chatHardeningMigration, /revoke all on function public\.chat_has_active_relationship\(uuid, uuid\) from public, anon, authenticated, service_role;/i);
  assert.match(chatHardeningMigration, /grant execute on function public\.chat_has_active_relationship\(uuid, uuid\) to authenticated;/i);

  const policyBlock = (source, policyName, endPattern) => {
    const match = source.match(new RegExp(`create policy "${policyName}"[\\s\\S]*?${endPattern}`, 'i'));
    assert.ok(match, `Missing policy block: ${policyName}`);
    return match[0];
  };

  assert.match(
    policyBlock(chatHardeningMigration, 'Chat participants can select conversations', '(?=\\r?\\n\\r?\\ncreate policy|\\r?\\n\\r?\\ncreate or replace function)'),
    /chat_has_active_relationship\s*\(/i,
  );
  assert.match(
    policyBlock(chatHardeningMigration, 'Chat participants can select canonical messages', '(?=\\r?\\n\\r?\\ncreate policy|\\r?\\n\\r?\\ncreate or replace function)'),
    /chat_has_active_relationship\s*\(/i,
  );
  const finalReadStatePolicy = policyBlock(
    chatHardeningMigration,
    'Chat participants can select read states',
    '(?=\\r?\\n\\r?\\ncreate or replace function)',
  );
  assert.match(finalReadStatePolicy, /chat_has_active_relationship\s*\(/i);
  assert.match(finalReadStatePolicy, /auth\.uid\(\)\s*\)\s*=\s*chat_read_states\.user_id/i);

  for (const [source, functionNames] of [
    [chatHardeningMigration, ['send_chat_message', 'delete_chat_message', 'mark_chat_conversation_delivered', 'mark_chat_conversation_read']],
  ]) {
    for (const functionName of functionNames) {
      const definition = assertActiveFunction(source, functionName);
      assert.match(definition, /set search_path = pg_catalog, public/i, `${functionName} must pin search_path`);
      assert.match(definition, /security definer/i, `${functionName} must remain SECURITY DEFINER`);
    }
  }

  assert.match(chatHardeningMigration, /revoke all on function public\.delete_chat_message\(uuid\) from public, anon, authenticated, service_role;/i);
  assert.match(chatHardeningMigration, /grant execute on function public\.delete_chat_message\(uuid\) to authenticated;/i);
  assert.match(chatHardeningMigration, /revoke all on function public\.mark_chat_conversation_delivered\(uuid, uuid\) from public, anon, authenticated, service_role;/i);
  assert.match(chatHardeningMigration, /grant execute on function public\.mark_chat_conversation_delivered\(uuid, uuid\) to authenticated;/i);
  assert.match(chatHardeningMigration, /revoke all on function public\.mark_chat_conversation_read\(uuid, uuid\) from public, anon, authenticated, service_role;/i);
  assert.match(chatHardeningMigration, /grant execute on function public\.mark_chat_conversation_read\(uuid, uuid\) to authenticated;/i);
});

test('chat runbooks and harness share the same canonical migration and PASS contract', () => {
  for (const runbook of [productionRunbook, stagingRunbook]) {
    let previousIndex = -1;
    for (const migrationName of chatMigrationNames) {
      const index = runbook.indexOf(migrationName);
      assert.notEqual(index, -1, `Runbook is missing ${migrationName}`);
      assert.ok(index > previousIndex, `Runbook migration order drifted at ${migrationName}`);
      previousIndex = index;
    }
  }

  const passLabels = [...harness.matchAll(/^\\echo PASS: (.+)$/gm)]
    .map((match) => match[1]);
  const uniquePassLabels = new Set(passLabels);
  assert.ok(passLabels.length > 0);
  assert.equal(passLabels.length, uniquePassLabels.size, 'Harness PASS labels must be unique');
  assert.equal((harness.match(/^\\echo CHAT_SECURITY_HARNESS_PASS$/gm) ?? []).length, 1);

  const expectedPassCount = uniquePassLabels.size;
  assert.match(productionRunbook, new RegExp(`Tam olarak ${expectedPassCount} farklı PASS:`));
  assert.match(stagingRunbook, new RegExp(`tam olarak ${expectedPassCount}\\s+benzersiz .*PASS:`));
  assert.doesNotMatch(productionRunbook, /42 farklı PASS/i);
  assert.doesNotMatch(stagingRunbook, /42 farklı PASS|42\\s+benzersiz/i);
});

const collectTextFiles = (relativeRoot) => {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  const entries = fs.readdirSync(absoluteRoot, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) return collectTextFiles(relativePath);
    return /\.(?:ts|tsx|js|cjs|sql)$/i.test(entry.name) ? [relativePath] : [];
  });
};

test('chat runtime has no dependency on deleted receipt model names', () => {
  const runtimeFiles = [
    ...collectTextFiles('features/chat'),
    'pages/Messages.tsx',
    ...collectTextFiles('shared'),
  ];
  const runtimeText = runtimeFiles.map((relativePath) => readRepoFile(relativePath)).join('\n');
  assert.doesNotMatch(runtimeText, /delivery_receipt|delivery_receipts|message_receipt|message_receipts/i);
});

test('receipt state uses created_at and id cursor ordering', () => {
  const message = {
    id: 'b',
    createdAt: '2026-07-28T10:00:00.000Z',
    conversationId: ids.conversation,
    senderId: ids.sender,
    clientMessageId: ids.clientMessage,
    body: 'Merhaba',
    deletedAt: null,
    deletedBy: null,
    isOwn: true,
    deliveryState: 'sent',
  };
  assert.equal(receipts.getChatReceiptState(message, null, null), 'sent');
  assert.equal(receipts.getChatReceiptState(message, { createdAt: message.createdAt, id: 'c' }, null), 'delivered');
  assert.equal(receipts.getChatReceiptState(message, { createdAt: message.createdAt, id: 'c' }, { createdAt: '2026-07-28T10:01:00.000Z', id: 'a' }), 'read');
});

test('delete RPC returns a tombstone and receipt RPCs use canonical cursor arguments', async () => {
  const calls = [];
  supabaseClient.__setRpcHandler(async (name, args) => {
    calls.push({ name, args });
    if (name === 'delete_chat_message') return { data: messageRow({ body: null, deleted_at: '2026-07-28T10:01:00.000Z', deleted_by: ids.sender }), error: null };
    return {
      data: {
        conversation_id: ids.conversation,
        user_id: ids.sender,
        last_delivered_message_id: ids.message,
        last_delivered_at: '2026-07-28T10:00:00.000Z',
        last_read_message_id: name === 'mark_chat_conversation_read' ? ids.message : null,
        last_read_at: name === 'mark_chat_conversation_read' ? '2026-07-28T10:00:00.000Z' : null,
      },
      error: null,
    };
  });

  const deleted = await chatService.deleteChatMessage({ messageId: ids.message });
  assert.equal(deleted.body, null);
  assert.equal(deleted.deletedBy, ids.sender);
  await chatService.markConversationDelivered({ conversationId: ids.conversation, lastDeliveredMessageId: ids.message });
  const read = await chatService.markConversationRead({ conversationId: ids.conversation, lastReadMessageId: ids.message });
  assert.equal(read.lastDeliveredMessageId, ids.message);
  assert.deepEqual(calls, [
    { name: 'delete_chat_message', args: { p_message_id: ids.message } },
    { name: 'mark_chat_conversation_delivered', args: { p_conversation_id: ids.conversation, p_last_delivered_message_id: ids.message } },
    { name: 'mark_chat_conversation_read', args: { p_conversation_id: ids.conversation, p_last_read_message_id: ids.message } },
  ]);
});
