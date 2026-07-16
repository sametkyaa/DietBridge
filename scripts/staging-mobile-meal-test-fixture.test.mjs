import assert from 'node:assert/strict';
import test from 'node:test';
import { EXIT, deleteExplicitFixtures, deleteFixtureAuthUser, foreignMealUnchangedStatus, isAlreadyDeletedAuthUser, isRetryableAuthDeleteError } from './staging-mobile-meal-test-fixture.mjs';

function fixtureManifest() {
  return { ids: { meals: ['meal-a'], plans: ['plan-a'], relations: ['relation-a'], users: ['fixture-a', 'fixture-b'] } };
}

function fixtureAdmin(calls) {
  return {
    from: (table) => ({
      delete: () => ({
        in: async (column, ids) => {
          calls.push({ table, column, ids: [...ids] });
          return { error: null };
        },
      }),
    }),
    auth: {
      admin: {
        deleteUser: async (id) => {
          calls.push({ table: 'auth.users', id });
          return { error: null };
        },
      },
    },
  };
}

test('CLEANUP-02: only the exact user_not_found 404 is already-clean', () => {
  assert.equal(isAlreadyDeletedAuthUser({ status: 404, code: 'user_not_found', message: 'User not found' }), true);
  assert.equal(isAlreadyDeletedAuthUser({ status: 404, code: 'other_error', message: 'User not found' }), false);
  assert.equal(isAlreadyDeletedAuthUser({ status: 500, code: 'user_not_found', message: 'User not found' }), false);
});

test('CLEANUP-03: retryable auth failures retry at most three times and remain failures', async () => {
  let calls = 0;
  const admin = {
    auth: {
      admin: {
        deleteUser: async () => {
          calls += 1;
          return { error: { name: 'AuthRetryableFetchError', status: 500, code: 'internal_error', message: '{}' } };
        },
      },
    },
  };

  await assert.rejects(
    () => deleteFixtureAuthUser(admin, 'fixture-user', { waitForRetry: async () => undefined }),
    (error) => error.exitCode === EXIT.CLEANUP,
  );
  assert.equal(calls, 3);
  assert.equal(isRetryableAuthDeleteError({ name: 'AuthRetryableFetchError' }), true);
  assert.equal(isRetryableAuthDeleteError({ status: 500 }), true);
  assert.equal(isRetryableAuthDeleteError({ status: 404 }), false);
});

test('CLEANUP-02: an already-deleted fixture user is idempotent without retry', async () => {
  let calls = 0;
  const admin = {
    auth: {
      admin: {
        deleteUser: async () => {
          calls += 1;
          return { error: { status: 404, code: 'user_not_found', message: 'User not found' } };
        },
      },
    },
  };

  await deleteFixtureAuthUser(admin, 'fixture-user', { waitForRetry: async () => undefined });
  assert.equal(calls, 1);
});

test('CLEANUP-01 and CLEANUP-05: cleanup targets only fixture daily logs before Auth users', async () => {
  const calls = [];
  await deleteExplicitFixtures(fixtureAdmin(calls), fixtureManifest());

  assert.deepEqual(calls.slice(0, 4), [
    { table: 'meals', column: 'id', ids: ['meal-a'] },
    { table: 'meal_plans', column: 'id', ids: ['plan-a'] },
    { table: 'dietitian_clients', column: 'id', ids: ['relation-a'] },
    { table: 'daily_logs', column: 'client_id', ids: ['fixture-a', 'fixture-b'] },
  ]);
  assert.deepEqual(calls.slice(4), [
    { table: 'auth.users', id: 'fixture-a' },
    { table: 'auth.users', id: 'fixture-b' },
  ]);
});

test('CLEANUP-04 and status normalization: repeated explicit cleanup is harmless and missing foreign rows are not violations', async () => {
  const firstCalls = [];
  const secondCalls = [];
  await deleteExplicitFixtures(fixtureAdmin(firstCalls), fixtureManifest());
  await deleteExplicitFixtures(fixtureAdmin(secondCalls), fixtureManifest());

  assert.deepEqual(secondCalls, firstCalls);
  assert.equal(foreignMealUnchangedStatus(null), 'NOT APPLICABLE — fixture row absent');
});
