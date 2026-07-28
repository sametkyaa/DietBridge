const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const supabaseClient = require(path.join(buildDir, 'lib', 'supabaseClient.js'));
const receipts = require(path.join(buildDir, 'features', 'chat', 'utils', 'receipts.js'));
const chatService = require(path.join(buildDir, 'features', 'chat', 'services', 'chatService.js'));

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
