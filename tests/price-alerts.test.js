const assert = require('assert');
const alerts = require('../assets/price-alerts.js');

function point(observedAt, price, availability = 'in_stock') {
  return { observedAt, price, availability, currency: 'TRY' };
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

const base = {
  productId: 'B0TEST1234',
  targetPrice: 14000,
  dropPercent: 10,
  restock: true,
  enabled: true,
};

test('target price alert fires when latest price reaches threshold', () => {
  const result = alerts.evaluateAlert(base, [point('2026-09-10T10:00:00Z', 15000), point('2026-09-11T10:00:00Z', 14000)]);
  assert.deepStrictEqual(result.events.map((event) => event.type), ['target_price']);
  assert.strictEqual(result.events[0].currentPrice, 14000);
});

test('percentage drop alert fires against the previous observation', () => {
  const result = alerts.evaluateAlert({ ...base, targetPrice: null, dropPercent: 10 }, [point('2026-09-10T10:00:00Z', 20000), point('2026-09-11T10:00:00Z', 17500)]);
  assert.deepStrictEqual(result.events.map((event) => event.type), ['price_drop']);
  assert.strictEqual(result.events[0].changePercent, -12.5);
});

test('restock alert fires only when availability changes to in stock', () => {
  const result = alerts.evaluateAlert({ ...base, targetPrice: null, dropPercent: null }, [point('2026-09-10T10:00:00Z', 15000, 'out_of_stock'), point('2026-09-11T10:00:00Z', 15000, 'in_stock')]);
  assert.deepStrictEqual(result.events.map((event) => event.type), ['restock']);
});

test('disabled or insufficient data does not fire alerts', () => {
  assert.deepStrictEqual(alerts.evaluateAlert({ ...base, enabled: false }, [point('2026-09-11T10:00:00Z', 10000)]).events, []);
  assert.deepStrictEqual(alerts.evaluateAlert({ ...base, targetPrice: null, dropPercent: 10 }, [point('2026-09-11T10:00:00Z', 10000)]).events, []);
});

test('invalid thresholds are rejected instead of silently creating an alarm', () => {
  assert.throws(() => alerts.normalizeAlert({ ...base, targetPrice: -1 }), /targetPrice/);
  assert.throws(() => alerts.normalizeAlert({ ...base, dropPercent: 101 }), /dropPercent/);
});

test('same event key is deduplicated until a new observation arrives', () => {
  const first = alerts.evaluateAlert(base, [point('2026-09-11T10:00:00Z', 13000)]);
  const state = alerts.markNotified({}, first.events);
  const second = alerts.filterUnnotifiedEvents(first.events, state);
  assert.strictEqual(first.events.length, 1);
  assert.strictEqual(second.length, 0);
});

if (process.exitCode) process.exit(1);
