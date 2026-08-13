'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const contract = require(path.join(
  buildDir,
  'features',
  'appointments',
  'utils',
  'appointmentContract.js',
));

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const VALID_DRAFT = {
  clientId: '11111111-1111-4111-8111-111111111111',
  title: ' Haftalık kontrol ',
  date: '2030-01-02',
  time: '09:30',
  duration: '45dk',
  type: 'Görüntülü Görüşme',
};

test('appointment validation normalizes a valid future draft', () => {
  const result = contract.validateAppointmentDraft(VALID_DRAFT, new Date(2029, 0, 1, 12, 0));
  assert.equal(result.success, true);
  assert.equal(result.value.title, 'Haftalık kontrol');
  assert.equal(result.value.duration, 45);
  assert.equal(result.value.time, '09:30');
});

test('appointment validation rejects non-UUID clients and past schedules', () => {
  const invalidClient = contract.validateAppointmentDraft(
    { ...VALID_DRAFT, clientId: '1' },
    new Date(2029, 0, 1),
  );
  assert.equal(invalidClient.success, false);

  const past = contract.validateAppointmentDraft(
    { ...VALID_DRAFT, date: '2026-01-01' },
    new Date(2026, 0, 2),
  );
  assert.equal(past.success, false);
});

test('appointment validation rejects invalid calendar days, time and duration', () => {
  assert.equal(contract.validateAppointmentDraft(
    { ...VALID_DRAFT, date: '2030-02-30' },
    new Date(2029, 0, 1),
  ).success, false);
  assert.equal(contract.validateAppointmentDraft(
    { ...VALID_DRAFT, time: '24:00' },
    new Date(2029, 0, 1),
  ).success, false);
  assert.equal(contract.validateAppointmentDraft(
    { ...VALID_DRAFT, duration: '31dk' },
    new Date(2029, 0, 1),
  ).success, false);
});

test('local appointment dates do not use UTC serialization', () => {
  assert.equal(contract.getLocalDateKey(new Date(2026, 7, 11, 0, 5)), '2026-08-11');
  assert.equal(contract.parseLocalDate('2026-08-11').getDate(), 11);
});

test('monthly calendar is Monday-first and maps 2026-08-13 to Thursday', () => {
  const days = contract.getMonthCalendarDays('2026-08');
  const selected = days.find((day) => day.date === '2026-08-13');
  assert.ok(selected);
  assert.equal(days.length, 42);
  assert.equal(days.indexOf(selected) % 7, 3);
  assert.equal(days[0].date, '2026-07-27');
  assert.equal(days[0].isCurrentMonth, false);
  assert.equal(days[5].date, '2026-08-01');
  assert.equal(days[5].isCurrentMonth, true);
});

test('calendar handles months beginning and ending mid-week', () => {
  const september = contract.getMonthCalendarDays('2026-09');
  assert.equal(september.length, 35);
  assert.equal(september[0].date, '2026-08-31');
  assert.equal(september[1].date, '2026-09-01');
  assert.equal(september[1].isCurrentMonth, true);
  assert.equal(september[30].date, '2026-09-30');
  assert.equal(september[31].date, '2026-10-01');
  assert.equal(september[31].isCurrentMonth, false);
});

test('calendar month navigation and Istanbul civil dates are deterministic', () => {
  assert.equal(contract.addCalendarMonths('2026-08', -1), '2026-07');
  assert.equal(contract.addCalendarMonths('2026-08', 1), '2026-09');
  assert.equal(contract.addCalendarDays('2026-08-13', 1), '2026-08-14');
  assert.equal(contract.getTodayDateKey(new Date('2026-08-12T21:30:00.000Z')), '2026-08-13');
  assert.equal(contract.getTodayDateKey(new Date('2026-08-13T20:59:59.000Z')), '2026-08-13');
  assert.equal(contract.getTodayDateKey(new Date('2026-08-13T21:00:00.000Z')), '2026-08-14');
});

test('new appointment form defaults to an editable weekly control title and clicked date', () => {
  const draft = contract.createAppointmentDraft('2026-08-13');
  assert.equal(draft.title, 'Haftalık kontrol');
  assert.equal(draft.date, '2026-08-13');

  const edited = contract.validateAppointmentDraft(
    { ...draft, clientId: VALID_DRAFT.clientId, title: 'İlk görüşme' },
    new Date(2026, 7, 1),
  );
  assert.equal(edited.success, true);
  assert.equal(edited.value.title, 'İlk görüşme');

  const rescheduled = contract.validateAppointmentDraft(
    { ...draft, clientId: VALID_DRAFT.clientId, date: '2026-08-14' },
    new Date(2026, 7, 1),
  );
  assert.equal(rescheduled.success, true);
  assert.equal(rescheduled.value.date, '2026-08-14');
});

test('appointment page preserves persisted titles for edits and uses the canonical create flow', () => {
  const source = read('pages/Appointments.tsx');
  assert.match(source, /setFormData\(createAppointmentDraft\(nextDate\)\)/);
  assert.match(source, /title: appointment\.title/);
  assert.match(source, /onChange=\{\(e\) => setFormData\(\{\.\.\.formData, date: e\.target\.value\}\)\}/);
  assert.doesNotMatch(source, /title: DEFAULT_APPOINTMENT_TITLE/);
});

test('appointment modal close keeps page state isolated from form state', () => {
  const source = read('pages/Appointments.tsx');
  assert.match(source, /const openCreateModal = \(date\?: string\) => \{/);
  assert.match(source, /const nextDate = typeof date === 'string' \? date : selectedDate;/);
  assert.match(source, /setViewMode\('list'\)/);
  assert.match(source, /setViewMode\('calendar'\)/);
  assert.match(source, /viewMode === 'calendar' \?/);
  assert.doesNotMatch(source, /onClick=\{openCreateModal\}/);
  assert.equal((source.match(/onClick=\{\(\) => openCreateModal\(\)\}/g) ?? []).length, 2);
  assert.match(source, /const closeModal = \(\) => \{[\s\S]*?setIsModalOpen\(false\);[\s\S]*?setEditingAppointment\(null\);[\s\S]*?setFormData\(createAppointmentDraft\(\)\);[\s\S]*?\}/);
  assert.equal((source.match(/onClick=\{closeModal\}/g) ?? []).length, 2);
  const closeHandler = source.match(/const closeModal = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(closeHandler);
  assert.doesNotMatch(closeHandler[1], /addAppointment|updateAppointment|deleteAppointment|refreshAppointments|setSelectedDate|setVisibleMonth/);
});

test('appointment calendar does not render implementation timezone guidance', () => {
  const source = read('pages/Appointments.tsx');
  assert.doesNotMatch(source, /Takvim saatleri Europe\/Istanbul yerel tarihine göre gösterilir\./);
});

test('legacy supported appointment types normalize explicitly', () => {
  assert.equal(contract.normalizeAppointmentType('online'), 'Görüntülü Görüşme');
  assert.equal(contract.normalizeAppointmentType('in_person'), 'Yüzyüze');
  assert.equal(contract.normalizeAppointmentType('phone'), 'Telefon Görüşmesi');
  assert.equal(contract.normalizeAppointmentType('unknown'), null);
});

test('appointment service is fail-closed and verifies owned mutation rows', () => {
  const source = read('features/appointments/services/appointmentService.ts');
  assert.doesNotMatch(source, /APPOINTMENTS|enableMockData|getMockAppointments|return false/);
  assert.match(source, /\.eq\('dietitian_id', dietitianId\)/);
  assert.match(source, /\.eq\('status', 'active'\)/);
  assert.match(source, /\.delete\(\)[\s\S]*?\.select\('id'\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(source, /data\?\.id !== id/);
  assert.match(source, /mode === 'create'[\s\S]*?status: 'upcoming'/);
  const basePayload = source.match(/const basePayload = \{([\s\S]*?)\n  \};/);
  assert.ok(basePayload);
  assert.doesNotMatch(basePayload[1], /status:/);
});

test('appointment context has no local persistence fallback and refreshes canonical state', () => {
  const source = read('features/appointments/context/AppointmentContext.tsx');
  assert.doesNotMatch(source, /mock-|Date\.now|yerel gösterim|prev\.filter|\.\.\.prev, appointment/iu);
  assert.match(source, /await mutation\(\);\s*const refreshSucceeded = await refreshAppointments\(\);/);
  assert.match(source, /success: true, refreshSucceeded/);
  assert.match(source, /accessState\.status === 'allowed'/);
  assert.match(source, /if \(pendingActionRef\.current\) return \{ success: false \}/);
  assert.match(source, /pendingActionRef\.current = actionKey;[\s\S]*?setPendingAction\(actionKey\)/);
});

test('appointment page uses active linked clients and awaits CRUD outcomes', () => {
  const source = read('pages/Appointments.tsx');
  assert.doesNotMatch(source, /\bCLIENTS\b|Date\.now\(\)|toISOString\(\)\.split/);
  assert.match(source, /fetchActiveDietitianClientList/);
  assert.match(source, /await updateAppointment\(editingAppointment\.id, formData\)/);
  assert.match(source, /await addAppointment\(formData\)/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /disabled=\{pendingAction !== null/);
});

test('dashboard keeps appointment loading, error and empty states distinct using local dates', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  assert.match(source, /getLocalDateKey\(\)/);
  assert.doesNotMatch(source, /toISOString\(\)\.split/);
  assert.match(source, /appointmentsLoading[\s\S]*appointmentsError[\s\S]*todaysAppointments\.length/);
  assert.match(source, /refreshAppointments\(\)/);
});

test('disposable appointment runtime harness is loopback-only and owns cleanup', () => {
  const source = read('scripts/runDisposableAppointmentRuntimeHarness.mjs');
  assert.match(source, /127\\\.0\\\.0\\\.1\|localhost/);
  assert.match(source, /SUPABASE_ACCESS_TOKEN: _accessToken/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY: _serviceRole/);
  assert.match(source, /stop', '--project-id', projectId, '--no-backup'/);
  assert.match(source, /TEMPORARY_APPOINTMENTS_ZERO/);
  assert.match(source, /DISPOSABLE_DOCKER_RESIDUE_ZERO/);
  assert.match(source, /compileAppointmentService/);
  assert.match(source, /service\.createAppointment/);
  assert.match(source, /service\.updateAppointment/);
  assert.match(source, /service\.deleteAppointmentService/);
  assert.match(source, /pending[\s\S]*rejected[\s\S]*missing-profile[\s\S]*anonymous/);
});
