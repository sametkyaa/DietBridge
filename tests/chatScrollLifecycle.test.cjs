const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const {
  shouldPositionInitialChat,
  shouldFollowLatestChat,
  shouldAdjustInitialChatLayout,
} = require(path.join(buildDir, 'features', 'chat', 'utils', 'chatScrollLifecycle.js'));

const conversationA = 'conversation-a';
const conversationB = 'conversation-b';

test('initial chat positioning runs once for a loaded conversation', () => {
  assert.equal(shouldPositionInitialChat({
    conversationId: conversationA,
    isLoading: false,
    latestTimelineKey: 'server:a-latest',
    hasPendingImageLayout: false,
    hasPendingOlderLoad: false,
    positionedConversationId: null,
  }), true);

  assert.equal(shouldPositionInitialChat({
    conversationId: conversationA,
    isLoading: false,
    latestTimelineKey: 'server:a-latest',
    hasPendingImageLayout: false,
    hasPendingOlderLoad: false,
    positionedConversationId: conversationA,
  }), false);
});

test('conversation changes get a fresh initial positioning decision', () => {
  assert.equal(shouldPositionInitialChat({
    conversationId: conversationB,
    isLoading: false,
    latestTimelineKey: 'server:b-latest',
    hasPendingImageLayout: false,
    hasPendingOlderLoad: false,
    positionedConversationId: conversationA,
  }), true);
});

test('empty or still-loading conversations never request an invalid scroll', () => {
  assert.equal(shouldPositionInitialChat({
    conversationId: conversationA,
    isLoading: false,
    latestTimelineKey: null,
    hasPendingImageLayout: false,
    hasPendingOlderLoad: false,
    positionedConversationId: null,
  }), false);
  assert.equal(shouldPositionInitialChat({
    conversationId: conversationA,
    isLoading: true,
    latestTimelineKey: 'server:a-latest',
    hasPendingImageLayout: false,
    hasPendingOlderLoad: false,
    positionedConversationId: null,
  }), false);
});

test('ordinary rerenders do not follow a new message when history is being read', () => {
  assert.equal(shouldFollowLatestChat({
    conversationId: conversationA,
    latestTimelineKey: 'server:a-newer',
    previousTimelineKey: 'server:a-older',
    isNearBottom: false,
    hasPendingOlderLoad: false,
    positionedConversationId: conversationA,
  }), false);
  assert.equal(shouldFollowLatestChat({
    conversationId: conversationA,
    latestTimelineKey: 'server:a-newer',
    previousTimelineKey: 'server:a-older',
    isNearBottom: true,
    hasPendingOlderLoad: false,
    positionedConversationId: conversationA,
  }), true);
});

test('variable-height layout gets at most one guarded initial adjustment', () => {
  assert.equal(shouldAdjustInitialChatLayout({
    conversationId: conversationA,
    positionedConversationId: conversationA,
    distanceFromBottom: 0,
    adjustedConversationId: null,
    isNearBottom: true,
  }), false);
  assert.equal(shouldAdjustInitialChatLayout({
    conversationId: conversationA,
    positionedConversationId: conversationA,
    distanceFromBottom: 0,
    adjustedConversationId: conversationA,
    isNearBottom: true,
  }), false);
  assert.equal(shouldAdjustInitialChatLayout({
    conversationId: conversationA,
    positionedConversationId: conversationA,
    distanceFromBottom: 100,
    adjustedConversationId: null,
    isNearBottom: false,
  }), false);
  assert.equal(shouldAdjustInitialChatLayout({
    conversationId: conversationA,
    positionedConversationId: conversationA,
    distanceFromBottom: 100,
    adjustedConversationId: null,
    isNearBottom: true,
  }), true);
});
