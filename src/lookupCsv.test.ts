import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLookupRowPatches, parseCsv } from './lookupCsv.ts';

test('parseCsv handles quotes, escaped quotes, and embedded newlines', () => {
  const { rows, lineEnding, trailingNewline } = parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\r\n');

  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  assert.equal(lineEnding, '\r\n');
  assert.equal(trailingNewline, true);
});

test('applyLookupRowPatches applies replaces, removes by descending row, then adds', () => {
  const csv = 'ip,level\n1.1.1.1,low\n2.2.2.2,medium\n3.3.3.3,high\n';
  const result = applyLookupRowPatches(csv, [
    { op: 'replace', rowId: 1, value: ['1.1.1.1', 'critical'] },
    { op: 'remove', rowId: 3 },
    { op: 'remove', rowId: 2 },
    { op: 'add', rowId: 4, value: ['4.4.4.4', 'needs, quoting'] },
  ]);

  assert.equal(result, 'ip,level\n1.1.1.1,critical\n4.4.4.4,"needs, quoting"\n');
});

test('applyLookupRowPatches rejects missing rows and wrong column counts', () => {
  const csv = 'ip,level\n1.1.1.1,low\n';

  assert.throws(() => applyLookupRowPatches(csv, [{ op: 'remove', rowId: 2 }]), /Row 2 does not exist/);
  assert.throws(() => applyLookupRowPatches(csv, [{ op: 'add', rowId: 2, value: ['only-one'] }]), /2 columns/);
});
