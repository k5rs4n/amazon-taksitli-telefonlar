const assert = require('assert');
const analysis = require('../assets/history-analysis.js');

function point(observedAt, price, extra = {}) {
  return { observedAt, price, currency: 'TRY', ...extra };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

const now = '2026-09-11T20:00:00Z';
const points = [
  point('2026-09-01T10:00:00Z', 15000, { seller: 'Amazon.com.tr', availability: 'in_stock' }),
  point('2026-09-05T10:00:00Z', 14500, { seller: 'Amazon.com.tr', availability: 'in_stock' }),
  point('2026-09-10T10:00:00Z', 14000, { seller: 'Amazon.com.tr', availability: 'out_of_stock' }),
  point('2026-09-11T10:00:00Z', 13500, { seller: 'Amazon.com.tr', availability: 'in_stock' }),
];

test('period filter selects recent points and keeps all history for all', () => {
  assert.strictEqual(analysis.filterPointsByPeriod(points, '7', now).length, 3);
  assert.strictEqual(analysis.filterPointsByPeriod(points, '30', now).length, 4);
  assert.strictEqual(analysis.filterPointsByPeriod(points, 'all', now).length, 4);
});

test('summary calculates latest, min, max, average, absolute and percentage change', () => {
  const summary = analysis.summarizePoints(points, { now });
  assert.strictEqual(summary.count, 4);
  assert.strictEqual(summary.latest.price, 13500);
  assert.strictEqual(summary.minimum.price, 13500);
  assert.strictEqual(summary.maximum.price, 15000);
  assert.strictEqual(summary.average, 14250);
  assert.strictEqual(summary.changeValue, -1500);
  assert.strictEqual(summary.changePercent, -10);
  assert.strictEqual(summary.previousChangeValue, -500);
  assert.strictEqual(summary.previousChangePercent, -3.57);
});

test('summary classifies a meaningful decline with a high-confidence trend', () => {
  const summary = analysis.summarizePoints(points, { now });
  assert.strictEqual(summary.trend, 'down');
  assert.strictEqual(summary.trendLabel, 'Düşüş eğilimi');
  assert.strictEqual(summary.confidence, 'high');
  assert.strictEqual(summary.confidenceLabel, 'Yüksek güven');
});

test('summary reports insufficient data instead of inventing a trend', () => {
  const summary = analysis.summarizePoints([points[0]], { now });
  assert.strictEqual(summary.trend, 'insufficient');
  assert.strictEqual(summary.trendLabel, 'Veri yetersiz');
  assert.strictEqual(summary.confidence, 'low');
  assert.strictEqual(summary.changePercent, null);
});

test('summary classifies small movements as horizontal', () => {
  const summary = analysis.summarizePoints([
    point('2026-09-10T10:00:00Z', 10000),
    point('2026-09-11T10:00:00Z', 10100),
  ], { now });
  assert.strictEqual(summary.trend, 'flat');
  assert.strictEqual(summary.trendLabel, 'Yatay seyir');
});

test('summary exposes range and latest distance from average', () => {
  const summary = analysis.summarizePoints(points, { now });
  assert.strictEqual(summary.rangeValue, 1500);
  assert.strictEqual(summary.latestVsAverageValue, -750);
  assert.strictEqual(summary.latestVsAveragePercent, -5.26);
});

if (process.exitCode) process.exit(1);
