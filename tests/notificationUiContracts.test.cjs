const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const buildDir = process.env.NOTIFICATION_UI_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('NOTIFICATION_UI_CONTRACT_BUILD_DIR is required.');

const formatter = require(path.join(buildDir, 'features', 'notifications', 'utils', 'notificationFormatter.js'));
const navigation = require(path.join(buildDir, 'features', 'notifications', 'utils', 'notificationNavigation.js'));
const visibility = require(path.join(buildDir, 'features', 'notifications', 'utils', 'notificationVisibility.js'));
const repoRoot = path.join(__dirname, '..');

const ids = {
  notification: '11111111-1111-4111-8111-111111111111',
  conversation: '22222222-2222-4222-8222-222222222222',
  relation: '33333333-3333-4333-8333-333333333333',
};

const notification = (overrides = {}) => ({
  id: ids.notification,
  recipientId: '44444444-4444-4444-8444-444444444444',
  category: 'chat_message',
  eventType: 'new_message',
  aggregationKey: `chat:${ids.conversation}`,
  actorId: null,
  actorDisplayName: 'Mebrure Kaya',
  conversationId: ids.conversation,
  appointmentId: null,
  dietitianClientId: null,
  summaryKey: 'chat_new_message',
  appointmentTitleSnapshot: null,
  appointmentDate: null,
  appointmentTime: null,
  appointmentStatus: null,
  relationshipFromStatus: null,
  relationshipToStatus: null,
  eventCount: 1,
  occurredAt: '2026-08-16T11:59:00.000Z',
  seenAt: null,
  readAt: null,
  createdAt: '2026-08-16T11:59:00.000Z',
  updatedAt: '2026-08-16T11:59:00.000Z',
  ...overrides,
});

const source = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('formatter keeps chat copy safe and supports singular, plural, and missing actors', () => {
  assert.equal(formatter.formatNotificationSummary(notification()), 'Mebrure Kaya size yeni bir mesaj gönderdi.');
  assert.equal(
    formatter.formatNotificationSummary(notification({ eventCount: 3 })),
    'Mebrure Kaya size 3 yeni mesaj gönderdi.',
  );
  assert.equal(
    formatter.formatNotificationSummary(notification({ actorDisplayName: null })),
    'Yeni mesajınız var.',
  );
});

test('formatter supports relationship, defensive appointment, and malformed fallback copy', () => {
  assert.equal(
    formatter.formatNotificationSummary(notification({
      category: 'relationship',
      eventType: 'accepted',
      actorDisplayName: 'Mebrure Kaya',
      conversationId: null,
      dietitianClientId: ids.relation,
      summaryKey: 'relationship_accepted',
      relationshipToStatus: 'active',
    })),
    'Mebrure Kaya bağlantı isteğinizi kabul etti.',
  );
  assert.equal(
    formatter.formatNotificationSummary(notification({
      category: 'relationship',
      eventType: 'rejected',
      actorDisplayName: 'Mebrure Kaya',
      conversationId: null,
      dietitianClientId: ids.relation,
      summaryKey: 'relationship_rejected',
    })),
    'Mebrure Kaya bağlantı isteğinizi reddetti.',
  );
  assert.equal(
    formatter.formatNotificationSummary(notification({
      category: 'appointment',
      eventType: 'updated',
      conversationId: null,
      appointmentId: ids.relation,
      summaryKey: 'appointment_updated',
    })),
    'Randevunuz güncellendi.',
  );
  assert.equal(
    formatter.formatNotificationSummary(notification({ category: 'future', eventType: 'future' })),
    'Yeni bir bildiriminiz var.',
  );
  assert.equal(
    formatter.formatNotificationSummary(notification({ actorDisplayName: '<img src=x onerror=alert(1)>' })),
    '<img src=x onerror=alert(1)> size yeni bir mesaj gönderdi.',
    'formatter returns text; React rendering remains responsible for escaping it',
  );
});

test('relative time uses Turkish-friendly notification timestamps', () => {
  const now = new Date('2026-08-16T12:00:00.000Z');
  assert.equal(formatter.formatNotificationRelativeTime('2026-08-16T11:59:30.000Z', now), 'Şimdi');
  assert.equal(formatter.formatNotificationRelativeTime('2026-08-16T11:55:00.000Z', now), '5 dk önce');
  assert.equal(formatter.formatNotificationRelativeTime('2026-08-16T10:00:00.000Z', now), '2 sa önce');
  assert.equal(formatter.formatNotificationRelativeTime('2026-08-15T12:00:00.000Z', now), 'Dün');
});

test('navigation identifies chat by conversation and relationship by server-validated relation state', () => {
  assert.equal(
    navigation.getNotificationNavigationTarget(notification()),
    `/messages?conversationId=${ids.conversation}`,
  );
  assert.equal(
    navigation.getNotificationNavigationTarget(notification({ conversationId: 'not-a-uuid' })),
    null,
  );
  assert.equal(
    navigation.getNotificationNavigationTarget(notification({
      category: 'relationship',
      eventType: 'accepted',
      conversationId: null,
      dietitianClientId: ids.relation,
      summaryKey: 'relationship_accepted',
      relationshipToStatus: 'active',
    })),
    `/clients?notificationRelationshipId=${ids.relation}`,
  );
  assert.equal(
    navigation.getNotificationNavigationTarget(notification({
      category: 'relationship',
      eventType: 'rejected',
      conversationId: null,
      dietitianClientId: ids.relation,
      summaryKey: 'relationship_rejected',
    })),
    '/clients',
  );
});

test('visibility helper batches only visible unseen cards and skips repeats', () => {
  const notifications = [
    { id: 'a', seenAt: null },
    { id: 'b', seenAt: null },
    { id: 'c', seenAt: '2026-08-16T11:00:00.000Z' },
  ];
  const entries = [
    { id: 'a', isIntersecting: true, intersectionRatio: 0.75 },
    { id: 'b', isIntersecting: false, intersectionRatio: 0 },
    { id: 'c', isIntersecting: true, intersectionRatio: 1 },
    { id: 'missing', isIntersecting: true, intersectionRatio: 1 },
  ];
  assert.deepEqual(visibility.selectVisibleUnseenNotificationIds(entries, notifications, new Set()), ['a']);
  assert.deepEqual(visibility.selectVisibleUnseenNotificationIds(entries, notifications, new Set(['a'])), []);
  assert.deepEqual(
    visibility.selectVisibleUnseenNotificationIds(
      [{ id: 'a', isIntersecting: true, intersectionRatio: 0.49 }],
      notifications,
      new Set(),
    ),
    [],
  );
});

test('shared UI uses one provider, canonical actions, deterministic seen observation, and no direct Supabase access', () => {
  const provider = source('features/notifications/context/NotificationCenterContext.tsx');
  const bell = source('features/notifications/components/NotificationBell.tsx');
  const drawer = source('features/notifications/components/NotificationDrawer.tsx');
  const dashboardLayout = source('shared/components/DashboardLayout.tsx');
  assert.match(provider, /useNotifications\(\{[\s\S]*pageSize: 25[\s\S]*unreadOnly: activeTab === 'unread'/);
  assert.equal((dashboardLayout.match(/<NotificationCenterProvider>/g) ?? []).length, 1);
  assert.match(bell, /unseenCount >= 10 \? '9\+' : String\(unseenCount\)/);
  assert.match(bell, /aria-label=\{accessibleLabel\}/);
  assert.match(bell, /aria-expanded=\{isOpen\}/);
  assert.match(drawer, /markVisibleSeen\(ids\)/);
  assert.match(drawer, /new IntersectionObserver/);
  assert.match(drawer, /root: list/);
  assert.match(drawer, /threshold: \[0\.5\]/);
  assert.match(drawer, /markRead\(notification\.id\)/);
  assert.match(drawer, /markAllRead\(\)/);
  assert.match(drawer, /key=\{notification\.id\}/);
  assert.doesNotMatch(drawer, /supabase|notification\.body|message\.body/);
  assert.doesNotMatch(bell, /supabase|\.from\(|\.update\(|\.insert\(|\.delete\(/);
});

test('bell is exposed only in the approved Dashboard, Messages, and Clients headers', () => {
  const dashboard = source('features/dashboard/pages/DashboardPage.tsx');
  const messages = source('pages/Messages.tsx');
  const clients = source('features/clients/pages/ClientsPage.tsx');
  assert.match(dashboard, /Danışan ara\.\.\.[\s\S]*<\/div>[\s\S]*<NotificationBell \/>[\s\S]*Profil sayfasına git/);
  assert.match(messages, /<NotificationBell \/>/);
  assert.match(clients, /<NotificationBell className="hidden md:inline-flex" \/>/);
  assert.doesNotMatch(messages, /import \{[^}]*\bBell\b/);
  assert.doesNotMatch(clients, /import \{[^}]*\bBell\b/);
});

test('deep-link destinations validate existing authenticated chat and relationship boundaries', () => {
  const messages = source('pages/Messages.tsx');
  const clients = source('features/clients/pages/ClientsPage.tsx');
  const clientService = source('features/clients/services/clientService.ts');
  assert.match(messages, /useSearchParams\(\)/);
  assert.match(messages, /conversation\.conversationId === requestedConversationId/);
  assert.match(messages, /setActiveRelationId\(requestedConversation\.relationId\)/);
  assert.match(clients, /resolveClientIdByRelationId\(notificationRelationshipId\)/);
  assert.match(clientService, /\.eq\('id', relationId\)/);
  assert.match(clientService, /\.eq\('dietitian_id', user\.id\)/);
  assert.match(clientService, /\.eq\('status', 'active'\)/);
});
