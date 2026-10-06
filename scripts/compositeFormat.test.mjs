import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlaceholders, placeholders } from '../src/lib/compositeFormat.ts';

test('allows argument reordering and keeps numeric formatting', () => {
  assert.deepEqual(checkPlaceholders('Buy {0:N0} for {1}', '{1}：购买 {0:N0}'), { missing: [], extra: [] });
  assert.deepEqual(placeholders('Literal {{braces}}, {0:N0}'), ['0:N0']);
});
test('rejects changed formats, lost repeated arguments and malformed braces', () => {
  for (const target of ['{0} {0}', '{0:N0}', '{0:N0} {1}', '{0:N0} {0:N0} }']) {
    const check = checkPlaceholders('{0:N0} {0:N0}', target);
    assert.ok(check.missing.length || check.extra.length, target);
  }
});
