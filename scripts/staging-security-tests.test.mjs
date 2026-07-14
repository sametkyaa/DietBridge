import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHarnessExitCode,
  evaluateDietitianMealUpdate,
  evaluateForeignMealSelection,
  evaluateOwnMealSelection,
} from './staging-security-test-assertions.mjs';

const ownMealId = 'own-meal';
const foreignMealId = 'foreign-meal';

test('SELECT-OWN-01: own meal is visible and foreign meal is hidden', () => {
  const result = evaluateOwnMealSelection({
    error: null,
    rows: [{ id: ownMealId }],
    ownMealId,
    foreignMealId,
    adminOwnMeal: { id: ownMealId },
    adminForeignMeal: { id: foreignMealId },
  });
  assert.equal(result.ok, true);
});

test('SELECT-OWN-02: missing own meal fails', () => {
  const result = evaluateOwnMealSelection({
    error: null,
    rows: [],
    ownMealId,
    foreignMealId,
    adminOwnMeal: { id: ownMealId },
    adminForeignMeal: { id: foreignMealId },
  });
  assert.equal(result.ok, false);
});

test('SELECT-CROSS-01: zero-row foreign result passes when admin fixture is unchanged', () => {
  const foreign = { id: foreignMealId, title: 'fixture' };
  const result = evaluateForeignMealSelection({
    error: null,
    rows: [],
    foreignMealId,
    adminBefore: foreign,
    adminAfter: { title: foreign.title, id: foreign.id },
  });
  assert.equal(result.ok, true);
});

test('SELECT-CROSS-02: a returned foreign row fails', () => {
  const foreign = { id: foreignMealId, title: 'fixture' };
  const result = evaluateForeignMealSelection({
    error: null,
    rows: [{ id: foreignMealId }],
    foreignMealId,
    adminBefore: foreign,
    adminAfter: { ...foreign },
  });
  assert.equal(result.ok, false);
});

test('DIETITIAN-UPDATE-01: persisted update and verified restore pass', () => {
  const result = evaluateDietitianMealUpdate({
    updateError: null,
    updatedRows: [{ id: ownMealId, title: 'test-title' }],
    targetMealId: ownMealId,
    testTitle: 'test-title',
    adminAfterUpdate: { id: ownMealId, title: 'test-title' },
    originalTitle: 'original-title',
    restoreError: null,
    restoredRows: [{ id: ownMealId, title: 'original-title' }],
    adminAfterRestore: { id: ownMealId, title: 'original-title' },
  });
  assert.equal(result.ok, true);
});

test('DIETITIAN-UPDATE-02: API success without a physical update fails', () => {
  const result = evaluateDietitianMealUpdate({
    updateError: null,
    updatedRows: [],
    targetMealId: ownMealId,
    testTitle: 'test-title',
    adminAfterUpdate: { id: ownMealId, title: 'original-title' },
    originalTitle: 'original-title',
    restoreError: null,
    restoredRows: [{ id: ownMealId, title: 'original-title' }],
    adminAfterRestore: { id: ownMealId, title: 'original-title' },
  });
  assert.equal(result.ok, false);
});

test('functional blockers produce a non-zero exit code', () => {
  assert.equal(classifyHarnessExitCode({ cleanupFailed: false, securityFailures: 0, deferredBlockers: 0, functionalBlockers: 1 }), 12);
});

test('cleanup failure remains the highest-priority exit code', () => {
  assert.equal(classifyHarnessExitCode({ cleanupFailed: true, securityFailures: 1, deferredBlockers: 1, functionalBlockers: 1 }), 20);
});
