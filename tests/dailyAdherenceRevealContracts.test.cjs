'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.DAILY_ADHERENCE_REVEAL_BUILD_DIR;
if (!buildDir) throw new Error('DAILY_ADHERENCE_REVEAL_BUILD_DIR is required.');

const reveal = require(path.join(buildDir, 'features', 'analytics', 'utils', 'dailyAdherenceReveal.js'));
const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'Analytics.tsx'), 'utf8');

const makePoints = (count) => Array.from({ length: count }, (_, index) => {
  const day = String(index + 1).padStart(2, '0');
  return {
    periodStart: `2026-08-${day}`,
    periodEnd: `2026-08-${day}`,
    planned: 1,
    completed: index % 2,
    percentage: (index % 2) * 100,
  };
});

test('daily adherence starts with the latest seven rows in chronological order', () => {
  const points = makePoints(30);
  const result = reveal.getDailyAdherenceReveal(points);
  assert.equal(result.visiblePoints.length, 7);
  assert.deepEqual(result.visiblePoints.map(({ periodStart }) => periodStart), [
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30',
  ]);
  assert.equal(result.hasMore, true);
});

test('daily adherence expands by seven rows and stops at the total', () => {
  const points = makePoints(30);
  let visibleCount = reveal.DAILY_ADHERENCE_REVEAL_STEP;
  visibleCount = reveal.getNextDailyAdherenceVisibleCount(visibleCount, points.length);
  assert.equal(visibleCount, 14);
  assert.equal(reveal.getDailyAdherenceReveal(points, visibleCount).visiblePoints.length, 14);
  visibleCount = reveal.getNextDailyAdherenceVisibleCount(visibleCount, points.length);
  assert.equal(visibleCount, 21);
  visibleCount = reveal.getNextDailyAdherenceVisibleCount(visibleCount, points.length);
  assert.equal(visibleCount, 28);
  visibleCount = reveal.getNextDailyAdherenceVisibleCount(visibleCount, points.length);
  assert.equal(visibleCount, 30);
  assert.equal(reveal.getDailyAdherenceReveal(points, visibleCount).hasMore, false);
  assert.equal(reveal.getNextDailyAdherenceVisibleCount(visibleCount, points.length), 30);
});

test('daily adherence shows all rows and no control when fewer than seven exist', () => {
  const points = makePoints(5);
  const result = reveal.getDailyAdherenceReveal(points);
  assert.deepEqual(result.visiblePoints, points);
  assert.equal(result.hasMore, false);
  assert.equal(reveal.getNextDailyAdherenceVisibleCount(5, points.length), 5);
});

test('Analytics page preserves reveal amount across tabs and resets on client or range changes', () => {
  assert.match(page, /getDailyAdherenceReveal/);
  assert.match(page, /Daha Fazlasını Göster/);
  assert.match(page, /useEffect\(\(\) => \{[\s\S]*setDailyAdherenceVisibleCount\(DAILY_ADHERENCE_REVEAL_STEP\);[\s\S]*\}, \[analytics\.selectedClientId, analytics\.rangeKey\]\)/);
  assert.match(page, /dailyAdherenceVisibleCount[\s\S]*getNextDailyAdherenceVisibleCount/);
});
