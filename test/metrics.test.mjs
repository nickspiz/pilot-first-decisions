import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreement, confusionMatrix, formatConfusion, hybrid, median, sum } from '../lib/metrics.mjs';
import { parseCsv, parseJsonl } from '../lib/io.mjs';

test('median handles odd, even and empty', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});
test('sum ignores non-numbers', () => assert.equal(sum([1, undefined, 2, NaN]), 3));
test('agreement skips null sides', () => {
  const r = agreement([['a', 'a'], ['a', 'b'], [null, 'a'], ['b', 'b']]);
  assert.deepEqual(r, { n: 3, matches: 2, rate: 2 / 3 });
  assert.equal(agreement([]).rate, null);
});
test('confusion matrix counts rows as reference', () => {
  const m = confusionMatrix([['pos', 'pos'], ['neg', 'neutral'], ['neg', 'neutral'], ['neg', 'neg']]);
  assert.deepEqual(m.labels, ['neg', 'neutral', 'pos']);
  assert.equal(m.counts.neg.neutral, 2);
  assert.equal(m.counts.pos.pos, 1);
  assert.match(formatConfusion(m), /neutral/);
});
test('hybrid routes low confidence to chat', () => {
  const items = [
    { decision: { label: 'a', confidence: 0.9 }, chat: 'b' },
    { decision: { label: 'a', confidence: 0.4 }, chat: 'b' },
    { decision: null, chat: 'c' },
  ];
  const h = hybrid(items, 0.8);
  assert.deepEqual(h.labels, ['a', 'b', 'c']);
  assert.equal(h.routed, 2);
});
test('parseCsv handles quotes, commas and newlines', () => {
  const rows = parseCsv('id,text\n1,"hello, ""world"""\n2,"two\nlines"\n');
  assert.equal(rows[0].text, 'hello, "world"');
  assert.equal(rows[1].text, 'two\nlines');
});
test('parseJsonl reports bad lines', () => {
  assert.equal(parseJsonl('{"a":1}\n\n{"a":2}\n').length, 2);
  assert.throws(() => parseJsonl('{"a":1}\nnope'), /line 2/);
});
