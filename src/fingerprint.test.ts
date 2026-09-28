import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintContent } from './fingerprint.ts';

test('fingerprintContent ignores key order and Cribl bookkeeping fields', () => {
  const left = { id: 'main', conf: { functions: [{ id: 'eval', filter: 'true' }] }, __srcOverridden: true, mtime: 1 };
  const right = { conf: { functions: [{ filter: 'true', id: 'eval' }] }, id: 'main', mtime: 2 };

  assert.equal(fingerprintContent(left), fingerprintContent(right));
});

test('fingerprintContent changes when the definition changes', () => {
  const before = { id: 'main', conf: { functions: [{ id: 'eval', filter: 'true' }] } };
  const after = { id: 'main', conf: { functions: [{ id: 'eval', filter: 'false' }] } };

  assert.notEqual(fingerprintContent(before), fingerprintContent(after));
});

test('fingerprintContent treats array order as significant', () => {
  assert.notEqual(fingerprintContent({ routes: ['a', 'b'] }), fingerprintContent({ routes: ['b', 'a'] }));
});
