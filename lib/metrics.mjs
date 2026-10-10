// Pure metric helpers. No I/O, easy to test.

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const sum = (values) => values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

/** Share of pairs where a === b. Pairs with a null side are skipped. */
export function agreement(pairs) {
  const ok = pairs.filter(([a, b]) => a != null && b != null);
  if (!ok.length) return { n: 0, matches: 0, rate: null };
  const matches = ok.filter(([a, b]) => a === b).length;
  return { n: ok.length, matches, rate: matches / ok.length };
}

/** rows = labels of A (reference), cols = labels of B. */
export function confusionMatrix(pairs) {
  const ok = pairs.filter(([a, b]) => a != null && b != null);
  const labels = [...new Set(ok.flatMap(([a, b]) => [a, b]))].sort();
  const counts = Object.fromEntries(labels.map((r) => [r, Object.fromEntries(labels.map((c) => [c, 0]))]));
  for (const [a, b] of ok) counts[a][b]++;
  return { labels, counts };
}

export function formatConfusion({ labels, counts }, rowName = 'chat', colName = 'decision') {
  if (!labels.length) return '(no data)';
  const w = Math.max(...labels.map((l) => l.length), 6);
  const pad = (s) => String(s).padEnd(w);
  const head = `| ${rowName} \\ ${colName} | ${labels.map(pad).join(' | ')} |`;
  const sep = `|${'-'.repeat(rowName.length + colName.length + 5)}|${labels.map(() => '-'.repeat(w + 2)).join('|')}|`;
  const body = labels.map((r) => `| ${r.padEnd(rowName.length + colName.length + 3)} | ${labels.map((c) => pad(counts[r][c])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

/**
 * Hybrid routing: use the decision answer when its confidence >= threshold, otherwise the chat answer.
 * items: [{ decision: {label, confidence}, chat: label }]
 * Returns labels plus the share routed to the chat model.
 */
export function hybrid(items, threshold) {
  let routed = 0;
  const labels = items.map((it) => {
    if (it.decision == null) { routed++; return it.chat; }
    if (it.decision.confidence >= threshold) return it.decision.label;
    routed++;
    return it.chat;
  });
  return { labels, routed, routedRate: items.length ? routed / items.length : 0 };
}

export const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
export const usd = (x) => `$${x.toFixed(x < 0.01 ? 5 : 4)}`;
