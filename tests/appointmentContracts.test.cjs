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

test('appointment week ranges are Monday-first across Sunday, month and year boundaries', () => {
  assert.deepEqual(contract.getMondayFirstWeekRange('2026-08-10'), {
    startDate: '2026-08-10',
    endDate: '2026-08-16',
  });
  assert.deepEqual(contract.getMondayFirstWeekRange('2026-08-16'), {
    startDate: '2026-08-10',
    endDate: '2026-08-16',
  });
  assert.deepEqual(contract.getMondayFirstWeekRange('2026-08-17'), {
    startDate: '2026-08-17',
    endDate: '2026-08-23',
  });
  assert.deepEqual(contract.getMondayFirstWeekRange('2026-08-31'), {
    startDate: '2026-08-31',
    endDate: '2026-09-06',
  });
  assert.deepEqual(contract.getMondayFirstWeekRange('2026-12-31'), {
    startDate: '2026-12-28',
    endDate: '2027-01-03',
  });
  assert.equal(contract.getMondayFirstWeekRange('2026-02-30'), null);
});

test('appointment sorting is chronological with deterministic ID tie-breaking', () => {
  const sorted = contract.sortAppointmentsChronologically([
    { id: 'b', date: '2026-08-13', time: '11:30' },
    { id: 'z', date: '2026-08-13', time: '09:00' },
    { id: 'a', date: '2026-08-13', time: '09:00' },
  ]);
  assert.deepEqual(sorted.map((appointment) => appointment.id), ['a', 'z', 'b']);
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
  const form = read('features/appointments/components/AppointmentFormModal.tsx');
  assert.match(source, /setFormData\(createAppointmentDraft\(nextDate < today \? today : nextDate\)\)/);
  assert.match(source, /title: appointment\.title/);
  assert.match(form, /onChange=\{\(event\) => onDraftChange\(\{ \.\.\.draft, date: event\.target\.value \}\)\}/);
  assert.doesNotMatch(source, /title: DEFAULT_APPOINTMENT_TITLE/);
});

test('appointment modal close keeps page state isolated from form state', () => {
  const source = read('pages/Appointments.tsx');
  assert.match(source, /const openCreateModal = useCallback\(\(date\?: string\) => \{/);
  assert.match(source, /const nextDate = date \?\? selectedDate;/);
  assert.match(source, /options=\{\[\{ value: 'list', label: 'Liste' \}, \{ value: 'calendar', label: 'Takvim' \}\]\}/);
  assert.match(source, /viewMode === 'calendar' \?/);
  assert.equal((source.match(/onClick=\{\(\) => openCreateModal\(\)\}/g) ?? []).length, 1);
  assert.match(source, /onClick=\{\(\) => openCreateModal\(selectedDate\)\}/);
  const closeHandler = source.match(/const closeModal = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(closeHandler);
  assert.match(closeHandler[1], /setIsModalOpen\(false\)/);
  assert.match(closeHandler[1], /setEditingAppointment\(null\)/);
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
  assert.doesNotMatch(source, /\bCLIENTS\b|Date\.now\(\)|toISOString\(\)\.split|window\.confirm/);
  assert.match(source, /fetchActiveDietitianClientList/);
  assert.match(source, /await updateAppointment\(appointmentId, draft\)/);
  assert.match(source, /await addAppointment\(draft\)/);
  assert.match(source, /checkAppointmentBooking\(draft, appointmentId\)/);
  // Destructive and status changes are explicit confirmations.
  assert.match(source, /<ConfirmDialog/);
  assert.match(source, /await deleteAppointment\(appointment\.id\)/);
  assert.match(source, /await changeAppointmentStatus\(appointment\.id, kind === 'complete' \? 'completed' : 'cancelled'\)/);
  assert.match(source, /const actionsDisabled = pendingAction !== null;/);
});

test('appointment status changes only close upcoming appointments of the current dietitian', () => {
  const service = read('features/appointments/services/appointmentService.ts');
  const context = read('features/appointments/context/AppointmentContext.tsx');
  const actions = read('features/appointments/components/AppointmentRowActions.tsx');
  const body = service.slice(service.indexOf('export const setAppointmentStatus'));
  assert.match(body, /status !== 'completed' && status !== 'cancelled'/);
  assert.match(body, /\.update\(\{ status \}\)/);
  assert.match(body, /\.eq\('dietitian_id', dietitianId\)/);
  assert.match(body, /\.eq\('status', SLOT_BLOCKING_APPOINTMENT_STATUSES\[0\]\)/);
  assert.match(body, /if \(error \|\| !data\) throw/);
  assert.match(context, /`status:\$\{id\}`/);
  assert.match(actions, /appointment\.status === 'upcoming' &&/);
  assert.doesNotMatch(read('pages/Appointments.tsx'), /Katıl|video.?call|meeting link|toplantı bağlantısı/i);
});

test('appointment booking rules keep slot conflicts and same-week warnings separate', () => {
  const page = read('pages/Appointments.tsx');
  const form = read('features/appointments/components/AppointmentFormModal.tsx');
  const service = read('features/appointments/services/appointmentService.ts');
  const migration = read('supabase/migrations/20260814120000_appointment_slot_collision_and_booking_indexes.sql');
  assert.match(page, /const \[slotConflict, setSlotConflict\]/);
  assert.match(page, /const \[sameWeekCount, setSameWeekCount\]/);
  // The same-week notice requires a second explicit submit before saving.
  assert.match(page, /if \(sameWeekCount !== null && sameWeekCount > 0\) \{\s*await persistForm\(draft, appointmentId\);/);
  assert.match(page, /if \(check\.value\.sameWeekCount > 0\) \{\s*setSameWeekCount\(check\.value\.sameWeekCount\);\s*return;/);
  assert.match(form, /Yine de kaydet/);
  assert.match(form, /APPOINTMENT_SLOT_CONFLICT_ERROR/);
  assert.match(form, /Vazgeç/);
  assert.match(service, /\.eq\('status', SLOT_BLOCKING_APPOINTMENT_STATUSES\[0\]\)/);
  assert.match(service, /\.neq\('id', appointmentId\)/);
  assert.match(service, /sameWeekCount/);
  assert.match(migration, /create unique index appointments_dietitian_date_time_upcoming_unique/);
  assert.match(migration, /where status = 'upcoming'/);
  assert.doesNotMatch(migration, /drop table|delete from|update public\.appointments/i);
});

test('monthly appointment cells keep two entries and expose all overflow appointments', () => {
  const grid = read('features/appointments/components/AppointmentMonthGrid.tsx');
  const page = read('pages/Appointments.tsx');
  assert.match(grid, /dayAppointments\.slice\(0, 2\)/);
  assert.match(grid, /\+\{dayAppointments\.length - 2\} daha/);
  assert.match(grid, /onClick=\{\(\) => onSelectDate\(day\.date\)\}/);
  // Selecting a day lists every appointment of that day in the side panel.
  assert.match(page, /const selectedDayAppointments = appointmentsByDate\.get\(selectedDate\) \?\? \[\];/);
  assert.match(page, /selectedDayAppointments\.map/);
  assert.match(page, /appointment\.clientName[\s\S]*?appointment\.title/);
});

test('dashboard keeps appointment loading, error and empty states distinct using Istanbul dates', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  const schedule = read('features/dashboard/components/TodayScheduleCard.tsx');
  assert.match(source, /const today = getTodayDateKey\(now\);/);
  assert.doesNotMatch(source, /toISOString\(\)\.split/);
  assert.match(source, /loading=\{appointmentsLoading\}\s*error=\{Boolean\(appointmentsError\)\}/);
  assert.match(schedule, /loading \? \([\s\S]*?\) : error \? \([\s\S]*?\) : appointments\.length === 0 \?/);
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

const appointmentService = require(path.join(
  buildDir,
  'features',
  'appointments',
  'services',
  'appointmentService.js',
));
const supabaseStub = require(path.join(buildDir, 'lib', 'supabaseClient.js'));

const RANGE_DIETITIAN_ID = '99999999-9999-4999-8999-999999999999';
const appointmentRow = (index, date) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
  dietitian_id: RANGE_DIETITIAN_ID,
  client_id: VALID_DRAFT.clientId,
  title: 'Haftalık kontrol',
  date,
  time: `${String(8 + (index % 10)).padStart(2, '0')}:00:00`,
  duration: 30,
  type: 'online',
  status: 'upcoming',
  client: { full_name: 'Danışan', avatar_url: null },
});

/**
 * Query double that applies the filters it receives and enforces the
 * PostgREST max_rows cap (supabase/config.toml) on every response.
 */
const installAppointmentQueryStub = (rows, { maxRows = 1000 } = {}) => {
  const queries = [];
  supabaseStub.__setUserId(RANGE_DIETITIAN_ID);
  supabaseStub.__setFromHandler((table) => {
    assert.equal(table, 'appointments');
    const call = { filters: [], orders: [], range: null, limit: null, countMode: null };
    queries.push(call);
    const query = {
      select: (_columns, options) => { call.countMode = options?.count ?? null; return query; },
      eq: (column, value) => { call.filters.push(['eq', column, value]); return query; },
      gte: (column, value) => { call.filters.push(['gte', column, value]); return query; },
      lte: (column, value) => { call.filters.push(['lte', column, value]); return query; },
      gt: (column, value) => { call.filters.push(['gt', column, value]); return query; },
      order: (column, options) => { call.orders.push([column, options.ascending]); return query; },
      range: (from, to) => { call.range = [from, to]; return query; },
      limit: (value) => { call.limit = value; return query; },
      then: (resolve, reject) => {
        const matching = rows
          .filter((row) => call.filters.every(([operator, column, value]) => (
            operator === 'eq' ? row[column] === value
              : operator === 'gte' ? row[column] >= value
                : operator === 'lte' ? row[column] <= value
                  : row[column] > value
          )))
          .sort((left, right) => (
            `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`)
            || left.id.localeCompare(right.id)
          ));
        let page = call.range ? matching.slice(call.range[0], call.range[1] + 1) : matching;
        if (call.limit !== null) page = page.slice(0, call.limit);
        page = page.slice(0, maxRows);
        return Promise.resolve({
          data: page,
          error: null,
          count: call.countMode === 'exact' ? matching.length : null,
        }).then(resolve, reject);
      },
    };
    return query;
  });
  return queries;
};

test('appointment loading windows are Monday-first month grids in Istanbul civil dates', () => {
  assert.deepEqual(contract.getMonthCalendarRange('2026-08'), {
    startDate: '2026-07-27',
    endDate: '2026-09-06',
  });
  assert.deepEqual(contract.getAppointmentRangeForDate('2026-08-13'), {
    startDate: '2026-07-27',
    endDate: '2026-09-06',
  });
  assert.equal(contract.getAppointmentRangeForDate('2026-02-30'), null);
  assert.equal(contract.isAppointmentDateRange({ startDate: '2026-08-02', endDate: '2026-08-01' }), false);
  const august = contract.getMonthCalendarRange('2026-08');
  assert.equal(contract.appointmentRangeCovers(august, { startDate: '2026-08-13', endDate: '2026-08-13' }), true);
  assert.equal(contract.appointmentRangeCovers(august, contract.getMonthCalendarRange('2026-09')), false);
  assert.equal(contract.appointmentRangeCovers(null, august), false);
});

test('range appointment fetch is date-bounded and pages past the 1000-row cap without dropping the newest rows', async () => {
  const rows = [];
  for (let index = 0; index < 2300; index += 1) {
    rows.push(appointmentRow(index, index < 2250 ? '2026-08-13' : '2026-09-06'));
  }
  rows.push(appointmentRow(9001, '2026-07-26'));
  rows.push(appointmentRow(9002, '2026-09-07'));
  const queries = installAppointmentQueryStub(rows);

  const appointments = await appointmentService.fetchAppointmentsInRange(
    contract.getMonthCalendarRange('2026-08'),
  );

  assert.equal(appointments.length, 2300);
  assert.equal(appointments.filter((appointment) => appointment.date === '2026-09-06').length, 50);
  assert.equal(appointments.some((appointment) => appointment.date < '2026-07-27' || appointment.date > '2026-09-06'), false);
  assert.deepEqual(queries.map((query) => query.range), [[0, 999], [1000, 1999], [2000, 2999]]);
  queries.forEach((query) => {
    assert.equal(query.countMode, 'exact');
    assert.deepEqual(query.filters, [
      ['eq', 'dietitian_id', RANGE_DIETITIAN_ID],
      ['gte', 'date', '2026-07-27'],
      ['lte', 'date', '2026-09-06'],
    ]);
    assert.deepEqual(query.orders, [['date', true], ['time', true], ['id', true]]);
  });
});

test('range appointment fetch fails closed instead of returning a silently truncated list', async () => {
  const rows = Array.from({ length: 1500 }, (_, index) => appointmentRow(index, '2026-08-13'));
  installAppointmentQueryStub(rows, { maxRows: 0 });
  await assert.rejects(
    () => appointmentService.fetchAppointmentsInRange(contract.getMonthCalendarRange('2026-08')),
    (error) => error.userMessage === appointmentService.APPOINTMENT_LOAD_ERROR,
  );
  await assert.rejects(
    () => appointmentService.fetchAppointmentsInRange({ startDate: '2026-09-01', endDate: '2026-08-01' }),
    (error) => error.userMessage === appointmentService.APPOINTMENT_LOAD_ERROR,
  );
});

test('upcoming preview reads only the next appointments after the loaded range', async () => {
  const rows = [
    appointmentRow(1, '2026-09-06'),
    appointmentRow(2, '2026-12-01'),
    appointmentRow(3, '2027-03-01'),
  ];
  const queries = installAppointmentQueryStub(rows);
  const after = await appointmentService.fetchAppointmentsAfterDate('2026-09-06', contract.UPCOMING_APPOINTMENT_PREVIEW_LIMIT);
  assert.deepEqual(after.map((appointment) => appointment.date), ['2026-12-01', '2027-03-01']);
  assert.deepEqual(queries[0].filters, [
    ['eq', 'dietitian_id', RANGE_DIETITIAN_ID],
    ['gt', 'date', '2026-09-06'],
  ]);
  assert.equal(queries[0].limit, 5);
});

test('appointment screens request the date range they render instead of an unbounded list', () => {
  const service = read('features/appointments/services/appointmentService.ts');
  const context = read('features/appointments/context/AppointmentContext.tsx');
  const page = read('pages/Appointments.tsx');
  const dashboard = read('features/dashboard/pages/DashboardPage.tsx');
  assert.doesNotMatch(service, /export const fetchAppointments = /);
  assert.match(context, /fetchAppointmentsInRange\(range\)/);
  assert.match(context, /fetchAppointmentsAfterDate\(range\.endDate, UPCOMING_APPOINTMENT_PREVIEW_LIMIT\)/);
  assert.match(page, /getMonthCalendarRange\(visibleMonth\)/);
  assert.match(page, /requestAppointmentRange\(visibleRange\)/);
  assert.match(page, /appointmentsAfterRange\.filter\(\(appointment\) => appointment\.status === 'upcoming'\)/);
  assert.match(dashboard, /\[\.\.\.appointments, \.\.\.appointmentsAfterRange\]/);
  assert.match(dashboard, /requestAppointmentRange\(todayRange\)/);
  assert.match(dashboard, /getAppointmentRangeForDate\(today\)/);
});
