'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm test`.');

const contract = require(path.join(buildDir, 'features', 'meal-tracking', 'utils', 'mealTrackingContract.js'));

const meal = (id, overrides = {}) => ({
  id,
  planId: '22222222-2222-4222-8222-222222222222',
  date: '2026-08-14',
  type: 'breakfast',
  title: 'Yulaflı meyve kasesi',
  time: '08:30',
  sortOrder: 0,
  isCompleted: false,
  completedAt: null,
  photoPath: null,
  ...overrides,
});
test('meal tracking range keeps Istanbul civil-day boundaries', () => {
  const beforeMidnight = new Date('2026-08-14T20:59:59.999Z');
  const afterMidnight = new Date('2026-08-14T21:00:00.000Z');
  assert.deepEqual(contract.getMealTrackingRange('today', undefined, beforeMidnight), {
    startDate: '2026-08-14', endDate: '2026-08-14',
  });
  assert.deepEqual(contract.getMealTrackingRange('today', undefined, afterMidnight), {
    startDate: '2026-08-15', endDate: '2026-08-15',
  });
  assert.deepEqual(contract.getMealTrackingRange('7d', undefined, afterMidnight), {
    startDate: '2026-08-09', endDate: '2026-08-15',
  });
  assert.deepEqual(contract.getMealTrackingRange('date', '2026-02-28', afterMidnight), {
    startDate: '2026-02-28', endDate: '2026-02-28',
  });
});

test('meal tracking summary avoids divide-by-zero and reports all completion states', () => {
  const empty = contract.summarizeMealTrackingDay('2026-08-14', []);
  assert.equal(empty.plannedCount, 0);
  assert.equal(empty.completedCount, 0);
  assert.equal(empty.percentage, null);

  const meals = [
    meal('30000000-0000-4000-8000-000000000001', { isCompleted: true }),
    meal('30000000-0000-4000-8000-000000000002', { type: 'lunch', isCompleted: true, sortOrder: 1 }),
    meal('30000000-0000-4000-8000-000000000003', { type: 'snack', sortOrder: 2 }),
    meal('30000000-0000-4000-8000-000000000004', { type: 'dinner', sortOrder: 3 }),
  ];
  const partial = contract.summarizeMealTrackingDay('2026-08-14', meals);
  assert.deepEqual(
    { planned: partial.plannedCount, completed: partial.completedCount, percentage: partial.percentage },
    { planned: 4, completed: 2, percentage: 50 },
  );
  assert.equal(contract.getMealTrackingStatus(meals[0], '2026-08-14', '2026-08-14'), 'completed');
  assert.equal(contract.getMealTrackingStatus(meals[2], '2026-08-14', '2026-08-14'), 'pending');
  assert.equal(contract.getMealTrackingStatus(meals[2], '2026-08-13', '2026-08-14'), 'unmarked');
});

test('meal tracking groups historical days deterministically by meal order', () => {
  const plans = [
    { date: '2026-08-13', meals: [meal('30000000-0000-4000-8000-000000000002', { date: '2026-08-13', sortOrder: 1 })] },
    { date: '2026-08-14', meals: [meal('30000000-0000-4000-8000-000000000001', { sortOrder: 1 }), meal('30000000-0000-4000-8000-000000000003', { sortOrder: 0 })] },
  ];
  const days = contract.groupMealTrackingDays(plans);
  assert.deepEqual(days.map((day) => day.date), ['2026-08-14', '2026-08-13']);
  assert.deepEqual(days[0].meals.map((item) => item.id), [
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000001',
  ]);
});
