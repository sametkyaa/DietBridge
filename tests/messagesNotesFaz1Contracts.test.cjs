'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test:meal-plan`.');

const noteFormat = require(path.join(buildDir, 'features', 'notes', 'utils', 'noteFormat.js'));
const preview = require(path.join(buildDir, 'features', 'chat', 'utils', 'conversationPreview.js'));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('note formatting recognises only bold, bullet and numbered lines and keeps HTML as text', () => {
  const blocks = noteFormat.parseNoteContent('Haftalık değerlendirme\n**Uyum** iyi.\n\n- Su: 2 L\n- <b>kahve</b> azalt\n1. Bel ölçümü\n2. Kilo');
  assert.deepEqual(blocks.map((block) => block.kind), ['paragraph', 'bullets', 'numbers']);
  assert.deepEqual(blocks[0].lines[1], [{ text: 'Uyum', bold: true }, { text: ' iyi.', bold: false }]);
  assert.deepEqual(blocks[1].items[1], [{ text: '<b>kahve</b> azalt', bold: false }]);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(noteFormat.stripNoteFormatting('**Not**\n- madde'), 'Not\nmadde');
  assert.deepEqual(noteFormat.parseNoteContent('   \n\n'), []);
});

test('conversation preview marks the dietitian\'s own last message with "Siz:"', () => {
  const base = { lastMessageId: 'm1', lastMessageBody: 'Bu hafta nasıl gidiyor?', lastMessageKind: 'text', lastMessageSenderId: 'dietitian' };
  assert.equal(preview.getChatConversationPreviewLine(base, 'dietitian'), 'Siz: Bu hafta nasıl gidiyor?');
  assert.equal(preview.getChatConversationPreviewLine({ ...base, lastMessageSenderId: 'client' }, 'dietitian'), 'Bu hafta nasıl gidiyor?');
  assert.equal(preview.getChatConversationPreviewLine({ ...base, lastMessageKind: 'image', lastMessageBody: null }, 'dietitian'), 'Siz: Görsel');
  assert.equal(preview.getChatConversationPreviewLine({ ...base, lastMessageId: null }, 'dietitian'), 'Henüz mesajlaşma başlamadı');
});

test('Messages uses server unread counts, refreshes them after a read receipt and shows no presence', () => {
  const page = read('pages/Messages.tsx');
  const list = read('features/chat/components/ChatConversationList.tsx');
  const panel = read('features/chat/components/ChatClientSummaryPanel.tsx');
  assert.match(page, /useUnreadCounts\(\)/);
  assert.match(page, /commitConversationReceipt\(result\.relationId, result\);[\s\S]{0,120}void refreshUnreadCounts\(\);/);
  assert.match(page, /value: 'unread', label: 'Okunmamış'/);
  assert.match(list, /getChatConversationPreviewLine\(conversation, currentUserId\)/);
  for (const source of [page, list, panel]) {
    assert.doesNotMatch(source, /son görülme|çevrimiçi|online|last_seen|lastSeen/i);
    assert.doesNotMatch(source, /supabase\./);
  }
});
