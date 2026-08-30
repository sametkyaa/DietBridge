'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const buildDir = process.env.CLIENT_METRICS_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('CLIENT_METRICS_CONTRACT_BUILD_DIR is required.');

const adherence = require(path.join(buildDir, 'shared/utils/adherenceContract.js'));
const percentageDisplay = require(path.join(buildDir, 'shared/utils/percentageDisplay.js'));
const clientMetrics = require(path.join(buildDir, 'features/clients/utils/clientMetricsContract.js'));
const clientExport = require(path.join(buildDir, 'features/clients/utils/clientExport.js'));
const exportService = require(path.join(buildDir, 'features/clients/services/clientExportService.js'));
const messageDeepLink = require(path.join(buildDir, 'features/chat/utils/messageDeepLink.js'));

const repoRoot = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const ids = {
  clientOne: '11111111-1111-4111-8111-111111111111',
  clientTwo: '22222222-2222-4222-8222-222222222222',
  relationOne: '33333333-3333-4333-8333-333333333333',
  relationTwo: '44444444-4444-4444-8444-444444444444',
  conversationOne: '55555555-5555-4555-8555-555555555555',
  conversationTwo: '66666666-6666-4666-8666-666666666666',
};

const measurement = (id, measuredAt, weight) => ({ id, measuredAt, weight });
const now = new Date('2026-08-27T20:30:00.000Z');

test('adherence contract is canonical and fails closed', () => {
  assert.equal(adherence.calculateAdherencePercentage(0, 0), null);
  assert.equal(adherence.calculateAdherencePercentage(0, 4), 0);
  assert.equal(adherence.calculateAdherencePercentage(2, 4), 50);
  assert.equal(adherence.calculateAdherencePercentage(4, 4), 100);
  assert.equal(adherence.calculateAdherencePercentage(Number.NaN, 4), null);
  assert.equal(adherence.calculateAdherencePercentage(1.5, 4), null);
  assert.equal(adherence.calculateAdherencePercentage(-1, 4), null);
  assert.equal(adherence.calculateAdherencePercentage(5, 4), null);
  assert.equal(clientMetrics.calculateClientMealAdherence(2, 4), 50);
});

test('percentage display rounds only visible labels and preserves raw metrics/export values', () => {
  assert.equal(percentageDisplay.formatPercentageDisplay(16.666666), '%17');
  assert.equal(percentageDisplay.formatPercentageDisplay(85.7), '%86');
  assert.equal(percentageDisplay.formatPercentageDisplay(50), '%50');
  assert.equal(percentageDisplay.formatPercentageDisplay(0), '%0');
  assert.equal(percentageDisplay.formatPercentageDisplay(100), '%100');
  assert.equal(percentageDisplay.formatPercentageDisplay(null), 'Veri yok');
  assert.equal(percentageDisplay.formatPercentageDisplay(Number.NaN), 'Veri yok');
  assert.equal(percentageDisplay.formatPercentageDisplay(Number.POSITIVE_INFINITY), 'Veri yok');
  assert.equal(adherence.calculateAdherencePercentage(1, 6), (1 / 6) * 100);
  assert.equal(clientMetrics.calculateClientMealAdherence(1, 6), (1 / 6) * 100);
  assert.equal(clientExport.mapClientsToExportRows([{
    name: 'Test Danışan', email: 'test@example.com', status: 'Aktif', goal: 'Kilo Verme',
    duration: null, currentWeight: '-', weeklyChange: null, compliance: 85.7,
  }])[0][7], 85.7);
});

test('client metric windows are inclusive Istanbul calendar windows', () => {
  assert.deepEqual(clientMetrics.getClientMetricWindows(now), {
    current: { startDate: '2026-08-21', endDate: '2026-08-27' },
    previous: { startDate: '2026-08-14', endDate: '2026-08-20' },
  });

  const afterIstanbulMidnight = new Date('2026-08-27T21:30:00.000Z');
  assert.deepEqual(clientMetrics.getClientMetricWindows(afterIstanbulMidnight), {
    current: { startDate: '2026-08-22', endDate: '2026-08-28' },
    previous: { startDate: '2026-08-15', endDate: '2026-08-21' },
  });
});

test('weekly weight change selects the latest valid measurement in each seven-day window', () => {
  const measurements = [
    measurement('00000000-0000-4000-8000-000000000001', '2026-08-18', 80.4),
    measurement('00000000-0000-4000-8000-000000000002', '2026-08-20', 80),
    measurement('00000000-0000-4000-8000-000000000003', '2026-08-22', 79.5),
    measurement('00000000-0000-4000-8000-000000000004', '2026-08-27', 79.2),
  ];
  assert.equal(clientMetrics.calculateWeeklyWeightChange(measurements, now), -0.8);
  assert.equal(clientMetrics.calculateWeeklyWeightChange([
    measurement('00000000-0000-4000-8000-000000000005', '2026-08-20', 80),
    measurement('00000000-0000-4000-8000-000000000006', '2026-08-27', 80.4),
  ], now), 0.4);
  assert.equal(clientMetrics.calculateWeeklyWeightChange([
    measurement('00000000-0000-4000-8000-000000000007', '2026-08-20', 80),
    measurement('00000000-0000-4000-8000-000000000008', '2026-08-27', 80),
  ], now), 0);
});

test('weekly weight change ignores invalid weights and returns null for incomplete windows', () => {
  assert.equal(clientMetrics.calculateWeeklyWeightChange([
    measurement('00000000-0000-4000-8000-000000000011', '2026-08-20', 19),
    measurement('00000000-0000-4000-8000-000000000012', '2026-08-27', 79),
  ], now), null);
  assert.equal(clientMetrics.calculateWeeklyWeightChange([
    measurement('00000000-0000-4000-8000-000000000013', '2026-08-20', 80),
    measurement('00000000-0000-4000-8000-000000000014', '2026-08-27', 501),
  ], now), null);
  assert.equal(clientMetrics.calculateWeeklyWeightChange([
    measurement('00000000-0000-4000-8000-000000000015', '2026-08-20', 80),
    measurement('00000000-0000-4000-8000-000000000016', '2026-08-27', Number.NaN),
  ], now), null);
  assert.equal(clientMetrics.calculateWeeklyWeightChange([
    measurement('00000000-0000-4000-8000-000000000017', '2026-08-27', 79),
  ], now), null);
  assert.equal(clientMetrics.calculateWeeklyWeightChange([
    measurement('00000000-0000-4000-8000-000000000018', '2026-08-20', 80),
  ], now), null);
});

test('client export mapping preserves visible order, Turkish text, numeric metrics and blanks', () => {
  const clients = [
    {
      name: 'Şule Çalışkan', email: 'sule@example.com', status: 'Aktif', goal: 'Kilo Verme',
      duration: '3 ay', currentWeight: '79,2 kg', weeklyChange: -0.8, compliance: 85.7,
    },
    {
      name: 'Özge Yıldız', email: 'ozge@example.com', status: 'Onay Bekliyor', goal: 'Sağlıklı Yaşam',
      duration: null, currentWeight: '-', weeklyChange: null, compliance: null,
    },
  ];

  assert.deepEqual(clientExport.CLIENT_EXPORT_HEADERS, [
    'İsim', 'E-posta', 'Durum', 'Hedef', 'Diyet Süresi', 'Güncel Kilo (kg)',
    'Haftalık Değişim (kg)', 'Uyum - Son 7 Gün (%)',
  ]);
  assert.deepEqual(clientExport.mapClientsToExportRows(clients), [
    ['Şule Çalışkan', 'sule@example.com', 'Aktif', 'Kilo Verme', '3 ay', 79.2, -0.8, 85.7],
    ['Özge Yıldız', 'ozge@example.com', 'Onay Bekliyor', 'Sağlıklı Yaşam', null, null, null, null],
  ]);
  assert.equal(exportService.getClientExportFileName(new Date('2026-08-27T21:30:00.000Z')), 'DietBridge_Danisanlar_2026-08-28.xlsx');
});

test('message deep-link selection waits for loading and resolves the requested client', () => {
  const conversations = [
    { relationId: ids.relationOne, conversationId: ids.conversationOne, clientId: ids.clientOne },
    { relationId: ids.relationTwo, conversationId: ids.conversationTwo, clientId: ids.clientTwo },
  ];

  assert.deepEqual(
    messageDeepLink.resolveConversationSelection([], null, ids.clientTwo, { isLoading: true, hasLoaded: false }),
    { status: 'pending', hasQuery: true },
  );
  assert.deepEqual(
    messageDeepLink.resolveConversationSelection([], null, ids.clientTwo, { isLoading: false, hasLoaded: false }),
    { status: 'pending', hasQuery: true },
  );
  assert.deepEqual(
    messageDeepLink.resolveConversationSelection(conversations, null, ids.clientTwo, { isLoading: false, hasLoaded: true }),
    { status: 'resolved', source: 'clientId', conversation: conversations[1] },
  );
});

test('message deep-link selection safely falls back after an unresolved request', () => {
  const conversations = [
    { relationId: ids.relationOne, conversationId: ids.conversationOne, clientId: ids.clientOne },
    { relationId: ids.relationTwo, conversationId: ids.conversationTwo, clientId: ids.clientTwo },
  ];

  assert.deepEqual(
    messageDeepLink.resolveConversationSelection(conversations, null, '77777777-7777-4777-8777-777777777777', { isLoading: false, hasLoaded: true }),
    { status: 'fallback', hasQuery: true, conversation: conversations[0] },
  );
  assert.deepEqual(
    messageDeepLink.resolveConversationSelection(conversations, 'not-a-uuid', null, { isLoading: false, hasLoaded: true }),
    { status: 'fallback', hasQuery: true, conversation: conversations[0] },
  );
});

test('message deep-link resolution prioritizes a valid conversation then client and preserves defaults', () => {
  const conversations = [
    { relationId: ids.relationOne, conversationId: ids.conversationOne, clientId: ids.clientOne },
    { relationId: ids.relationTwo, conversationId: ids.conversationTwo, clientId: ids.clientTwo },
  ];

  assert.equal(
    messageDeepLink.resolveConversationSelection(conversations, ids.conversationOne, ids.clientTwo, { isLoading: false, hasLoaded: true }).conversation.relationId,
    ids.relationOne,
  );
  assert.equal(
    messageDeepLink.resolveConversationSelection(conversations, null, ids.clientTwo, { isLoading: false, hasLoaded: true }).conversation.relationId,
    ids.relationTwo,
  );
  assert.equal(
    messageDeepLink.resolveConversationSelection(conversations, ids.conversationTwo, ids.clientOne, { isLoading: false, hasLoaded: true }).conversation.relationId,
    ids.relationTwo,
  );
  assert.equal(
    messageDeepLink.resolveConversationSelection(conversations, null, null, { isLoading: false, hasLoaded: true }).conversation.relationId,
    ids.relationOne,
  );
  assert.equal(
    messageDeepLink.resolveConversationFromQuery(conversations, ids.conversationOne, ids.clientTwo).relationId,
    ids.relationOne,
  );
  assert.equal(
    messageDeepLink.resolveConversationFromQuery(conversations, null, ids.clientTwo).relationId,
    ids.relationTwo,
  );
  assert.equal(
    messageDeepLink.resolveConversationFromQuery(conversations, 'not-a-uuid', ids.clientTwo).relationId,
    ids.relationTwo,
  );
  assert.equal(messageDeepLink.resolveConversationFromQuery(conversations, ids.conversationOne, null).relationId, ids.relationOne);
  assert.equal(messageDeepLink.resolveConversationFromQuery(conversations, ids.conversationOne, ids.clientOne).relationId, ids.relationOne);
  assert.equal(messageDeepLink.resolveConversationFromQuery(conversations, ids.conversationTwo, ids.clientOne).relationId, ids.relationTwo);
  assert.equal(messageDeepLink.resolveConversationFromQuery(conversations, null, 'not-a-uuid'), null);
});

test('active source chain uses real metrics, actions, export and functional settings', () => {
  const clientService = read('features/clients/services/clientService.ts');
  const clientsPage = read('features/clients/pages/ClientsPage.tsx');
  const clientDetails = read('pages/ClientDetails.tsx');
  const dashboard = read('features/dashboard/pages/DashboardPage.tsx');
  const sidebar = read('shared/components/Sidebar.tsx');
  const progressService = read('features/clients/services/clientProgressService.ts');
  const exportServiceSource = read('features/clients/services/clientExportService.ts');
  const analyticsContract = read('features/analytics/utils/analyticsContract.ts');
  const messagesPage = read('pages/Messages.tsx');
  const settingsPage = read('features/settings/pages/SettingsPage.tsx');
  const authService = read('features/auth/services/authService.ts');

  assert.doesNotMatch(clientService, /compliance_score/);
  assert.match(clientService, /fetchClientProgressMetrics\(activeClientIds\)/);
  assert.match(clientService, /includeProgress/);
  assert.match(progressService, /CLIENT_PROGRESS_BATCH_SIZE = 50/);
  assert.match(progressService, /for \(const clientIdBatch of chunk\(uniqueClientIds, CLIENT_PROGRESS_BATCH_SIZE\)\)/);
  assert.match(progressService, /\.select\('client_id, plan_date, meals \(is_eaten\)'\)/);
  assert.match(progressService, /\.select\('id, client_id, measured_at, weight'\)/);
  assert.match(progressService, /\.in\('client_id', clientIdBatch\)/);
  assert.match(clientsPage, /handleExport/);
  assert.match(clientsPage, /exportClientsToXlsx\(filteredClients\)/);
  assert.match(clientsPage, /filteredClients: \[\.\.\.searched\]\.sort\(compareClients\)/);
  assert.match(clientsPage, /Uyum \(7 Gün\)/);
  assert.match(clientsPage, /formatPercentageDisplay\(value\)/);
  assert.doesNotMatch(clientsPage, /maximumFractionDigits: 1/);
  assert.match(clientsPage, /disabled=\{filteredClients\.length === 0 \|\| isExporting\}/);
  assert.match(clientsPage, /clientMessagesPath/);
  assert.match(clientsPage, /role="menu"/);
  assert.match(clientsPage, /Escape/);
  assert.match(exportServiceSource, /write-excel-file\/browser/);
  assert.match(exportServiceSource, /sheet: 'Danışanlar'/);
  assert.match(exportServiceSource, /\.toFile\(getClientExportFileName\(now\)\)/);
  assert.doesNotMatch(clientDetails, /compliance_score/);
  assert.match(clientDetails, /formatPercentageDisplay\(client\.compliance\)/);
  assert.doesNotMatch(clientDetails, /maximumFractionDigits: 1/);
  assert.match(dashboard, /formatPercentageDisplay\(client\.compliance\)/);
  assert.doesNotMatch(dashboard, /%\{client\.compliance\}/);
  assert.match(sidebar, /<NavLink[\s\S]*to="\/"[\s\S]*aria-label="Kontrol Paneline git"[\s\S]*APP_LOGO[\s\S]*DietBridge/);
  assert.match(sidebar, /label: 'Kontrol Paneli', path: '\/'/);
  assert.match(clientDetails, /Son 7 gündeki planlanan öğünlerin tamamlanma oranı\./);
  assert.match(clientDetails, /client\.compliance === null/);
  assert.match(analyticsContract, /calculateAdherencePercentage/);
  assert.match(messagesPage, /requestedClientId/);
  assert.match(messagesPage, /resolveConversationSelection/);
  assert.match(messagesPage, /hasLoaded/);
  assert.match(messagesPage, /requestedConversationId.*requestedClientId/s);
  assert.match(settingsPage, /<SubscriptionPanel \/>/);
  assert.match(settingsPage, /navigate\('\/profile'\)/);
  assert.match(settingsPage, /navigate\('\/profile\/edit'\)/);
  assert.match(settingsPage, /requestCurrentUserPasswordReset/);
  assert.match(settingsPage, /Şifre Yenileme Bağlantısı Gönder/);
  assert.match(settingsPage, /Çıkış Yap/);
  assert.match(authService, /resetPasswordForEmail/);
  assert.match(authService, /window\.location\.origin\}\/reset-password/);
  assert.doesNotMatch(settingsPage, /bildirim|2FA|two-factor|theme selector|language selector|account deletion/i);
});
