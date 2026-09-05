import assert from 'node:assert/strict';
import test from 'node:test';
import { categoricalColorExpression, GDP_PALETTES, gdpFillExpression, stableBucket } from '../nativeStyles.js';

test('airport buckets are deterministic and stay in palette range', () => {
  assert.equal(stableBucket('RCTP'), stableBucket('RCTP'));
  assert.ok(stableBucket('EGLL') >= 0 && stableBucket('EGLL') < 5);
  assert.ok(new Set(['RCTP', 'RJTT', 'EGLL', 'KLAX'].map((id) => stableBucket(id))).size > 1);
  assert.deepEqual(categoricalColorExpression('color_index', 'missing'), categoricalColorExpression('color_index', 'spectrum'));
});

test('GDP expression preserves null as a separate no-data color', () => {
  const expression = gdpFillExpression('plum');
  assert.equal(expression[0], 'step');
  assert.deepEqual(expression.slice(1, 4), [['coalesce', ['get', 'gdp_usd'], -1], '#c9c9c9', 0]);
  assert.ok(JSON.stringify(expression).includes(String(3_000_000_000_000)));
  assert.deepEqual(gdpFillExpression('missing'), gdpFillExpression('blue'));
  assert.equal(Object.keys(GDP_PALETTES).length, 3);
});
