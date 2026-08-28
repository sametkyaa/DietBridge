'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test:analytics`.');

const contract = require(path.join(buildDir, 'features', 'analytics', 'utils', 'goalProgressContract.js'));

const calculate = (startWeight, currentWeight, targetWeight) => contract.calculateGoalProgress({
  startWeight,
  currentWeight,
  targetWeight,
});

test('goal progress supports weight-loss goals', () => {
  const result = calculate(76.3, 74.2, 69.5);
  assert.ok(Math.abs(result.progressPercentage - 30.88235294117647) < 1e-10);
  assert.ok(Math.abs(result.remainingKg - 4.7) < 1e-10);
  assert.equal(result.hasData, true);
  assert.equal(result.isComplete, false);
});

test('goal progress supports weight-gain goals', () => {
  const result = calculate(60, 63, 65);
  assert.equal(result.progressPercentage, 60);
  assert.equal(result.remainingKg, 2);
});

test('goal progress floors when moving away from the target', () => {
  const result = calculate(76.3, 80, 69.5);
  assert.equal(result.progressPercentage, 0);
  assert.equal(result.remainingKg, 10.5);
});

test('goal progress caps at completion when target is reached or passed', () => {
  assert.deepEqual(calculate(76.3, 69.5, 69.5), {
    progressPercentage: 100,
    remainingKg: 0,
    isComplete: true,
    hasData: true,
  });
  assert.deepEqual(calculate(60, 67, 65), {
    progressPercentage: 100,
    remainingKg: 0,
    isComplete: true,
    hasData: true,
  });
});

test('goal progress fails closed for missing, equal or invalid weights', () => {
  const noData = {
    progressPercentage: null,
    remainingKg: null,
    isComplete: false,
    hasData: false,
  };
  assert.deepEqual(calculate(null, 74.2, 69.5), noData);
  assert.deepEqual(calculate(70, 70, 70), noData);
  assert.deepEqual(calculate(19, 74.2, 69.5), noData);
  assert.deepEqual(calculate(76.3, 501, 69.5), noData);
  assert.deepEqual(calculate(Number.NaN, 74.2, 69.5), noData);
});
