#!/usr/bin/env node
// Compare a decision model with a chat model on the same rows and questions.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { decide, DEFAULT_MODEL, validateQuestions } from './decide.mjs';
import { loadRows } from './lib/io.mjs';
import { agreement, confusionMatrix, formatConfusion, hybrid, median, sum, pct, usd } from './lib/metrics.mjs';

export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Allowed labels for a question, as a list of strings. */
export function allowedLabels(q) {
  if (q.type === 'noul') return ['yes', 'no'];
  return Array.isArray(q.criteria) ? q.criteria.map(String) : Object.keys(q.criteria);
}

export function buildChatPrompt(text, questions) {
  const lines = Object.entries(questions).map(([name, q]) => {
    const labels = allowedLabels(q);
    let extra = '';
    if (q.type !== 'noul' && !Array.isArray(q.criteria)) {
      extra = ' Meanings: ' + Object.entries(q.criteria).map(([k, v]) => `${k} = ${v}`).join('; ') + '.';
    }
    return `- "${name}": ${q.instructions} Answer with exactly one of: ${labels.join(', ')}.${extra}`;
  });
  return `Read the text and answer each question.\n\nText:\n"""\n${text}\n"""\n\nQuestions:\n${lines.join('\n')}\n\nReply with one JSON object only, keys are the question names, values are the chosen labels. No other text.`;
}

/** Parse a chat reply into { name: label | null }. Labels outside the allowed set become null. */
export function parseChatAnswers(content, questions) {
  const out = Object.fromEntries(Object.keys(questions).map((k) => [k, null]));
  const m = String(content ?? '').match(/\{[\s\S]*\}/);
  if (!m) return out;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return out; }
  for (const [name, q] of Object.entries(questions)) {
    let v = obj?.[name];
    if (typeof v === 'boolean') v = v ? 'yes' : 'no';
    if (v == null) continue;
    v = String(v).trim().toLowerCase();
    const hit = allowedLabels(q).find((l) => l.toLowerCase() === v);
    if (hit) out[name] = hit;
  }
  return out;
}

export async function chatDecide({ text, questions, model, apiKey = process.env.OPENROUTER_API_KEY, fetchImpl = globalThis.fetch, url = CHAT_URL }) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const started = performance.now();
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 200, usage: { include: true }, messages: [{ role: 'user', content: buildChatPrompt(text, questions) }] }),
    signal: AbortSignal.timeout(60000),
  });
  const latencyMs = Math.round(performance.now() - started);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `chat endpoint returned HTTP ${res.status}`);
  return { answers: parseChatAnswers(data.choices?.[0]?.message?.content, questions), cost: Number(data.usage?.cost ?? 0), latencyMs };
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

/** Pure: turn per-row results into the report data. */
export function summarize(results, questions, { threshold = null } = {}) {
  const perQuestion = {};
  for (const name of Object.keys(questions)) {
    const usable = results.filter((r) => r.decision && r.chat);
    const pairs = usable.map((r) => [r.chat.answers[name], r.decision.answers[name]?.label ?? null]);
    const expectedKey = `expected_${name}`;
    const withExpected = results.filter((r) => r.row[expectedKey] != null && r.row[expectedKey] !== '');
    const acc = (side) => agreement(withExpected.filter((r) => r[side]).map((r) => [r.row[expectedKey], side === 'chat' ? r.chat.answers[name] : r.decision.answers[name]?.label ?? null]));
    const entry = {
      agreement: agreement(pairs),
      confusion: confusionMatrix(pairs),
      accuracy: withExpected.length ? { chat: acc('chat'), decision: acc('decision') } : null,
      disagreements: usable
        .filter((r) => r.chat.answers[name] !== (r.decision.answers[name]?.label ?? null))
        .map((r) => ({ index: r.index, text: r.text, chat: r.chat.answers[name], decision: r.decision.answers[name]?.label ?? null, confidence: r.decision.answers[name]?.confidence ?? null })),
    };
    if (threshold != null) {
      const items = usable.map((r) => ({ decision: r.decision.answers[name] ?? null, chat: r.chat.answers[name] }));
      const h = hybrid(items, threshold);
      entry.hybrid = { threshold, routedRate: h.routedRate, agreementWithChat: agreement(h.labels.map((l, i) => [items[i].chat, l])) };
      if (withExpected.length) {
        const hy = hybrid(usable.map((r) => ({ decision: r.decision.answers[name] ?? null, chat: r.chat.answers[name] })), threshold).labels;
        entry.hybrid.accuracy = agreement(usable.map((r, i) => [r.row[expectedKey], hy[i]]).filter(([e]) => e != null && e !== ''));
      }
    }
    perQuestion[name] = entry;
  }
  return {
    rows: results.length,
    errors: results.filter((r) => !r.decision || !r.chat).length,
    decisionCost: sum(results.map((r) => r.decision?.cost)),
    chatCost: sum(results.map((r) => r.chat?.cost)),
    decisionMedianMs: median(results.map((r) => r.decision?.latencyMs)),
    chatMedianMs: median(results.map((r) => r.chat?.latencyMs)),
    perQuestion,
  };
}

export function renderReport(s, meta) {
  const L = [];
  L.push('# Decision model vs chat model', '');
  L.push(`Rows: ${s.rows} (failed: ${s.errors}). Decision model: ${meta.decisionModel}. Chat model: ${meta.chatModel}.`, '');
  if (meta.fixture) L.push('> Fixture replay. These answers are invented. The numbers show what a report looks like, not how any model performs.', '');
  L.push('## Cost and latency', '', '| | Total cost | Per 100 rows | Median latency |', '|---|---|---|---|');
  const per100 = (c) => (s.rows ? usd((c / s.rows) * 100) : 'n/a');
  L.push(`| Decision | ${usd(s.decisionCost)} | ${per100(s.decisionCost)} | ${s.decisionMedianMs ?? 'n/a'} ms |`);
  L.push(`| Chat | ${usd(s.chatCost)} | ${per100(s.chatCost)} | ${s.chatMedianMs ?? 'n/a'} ms |`, '');
  L.push('## Agreement', '', '| Question | Agreement | N |' + (meta.threshold != null ? ' Hybrid agreement | Routed to chat |' : ''), '|---|---|---|' + (meta.threshold != null ? '---|---|' : ''));
  for (const [name, e] of Object.entries(s.perQuestion)) {
    L.push(`| ${name} | ${pct(e.agreement.rate)} | ${e.agreement.n} |` + (e.hybrid ? ` ${pct(e.hybrid.agreementWithChat.rate)} | ${pct(e.hybrid.routedRate)} |` : ''));
  }
  L.push('');
  if (Object.values(s.perQuestion).some((e) => e.accuracy)) {
    L.push('## Accuracy against expected labels', '', '| Question | Chat | Decision |' + (meta.threshold != null ? ' Hybrid |' : ''), '|---|---|---|' + (meta.threshold != null ? '---|' : ''));
    for (const [name, e] of Object.entries(s.perQuestion)) {
      if (e.accuracy) L.push(`| ${name} | ${pct(e.accuracy.chat.rate)} | ${pct(e.accuracy.decision.rate)} |` + (e.hybrid?.accuracy ? ` ${pct(e.hybrid.accuracy.rate)} |` : ''));
    }
    L.push('');
  }
  for (const [name, e] of Object.entries(s.perQuestion)) {
    L.push(`## Confusion matrix: ${name}`, '', formatConfusion(e.confusion), '');
  }
  L.push('## Disagreements', '');
  for (const [name, e] of Object.entries(s.perQuestion)) {
    if (!e.disagreements.length) { L.push(`${name}: none`, ''); continue; }
    L.push(`### ${name}`, '');
    for (const d of e.disagreements) L.push(`- row ${d.index}: chat=${d.chat ?? 'invalid'}, decision=${d.decision ?? 'n/a'} (confidence ${d.confidence?.toFixed(2) ?? 'n/a'}) "${String(d.text).slice(0, 100).replace(/\s+/g, ' ')}"`);
    L.push('');
  }
  return L.join('\n');
}

function parseArgs(argv) {
  const o = { limit: 20, textField: 'text', concurrency: 4, out: 'bench-out', decisionModel: DEFAULT_MODEL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--data') o.data = v();
    else if (a === '--questions') o.questions = v();
    else if (a === '--chat-model') o.chatModel = v();
    else if (a === '--decision-model') o.decisionModel = v();
    else if (a === '--text-field') o.textField = v();
    else if (a === '--limit') { const x = v(); o.limit = x === 'all' ? Infinity : Number(x); }
    else if (a === '--confidence-threshold') o.threshold = Number(v());
    else if (a === '--concurrency') o.concurrency = Number(v());
    else if (a === '--out') o.out = v();
    else if (a === '--fixture') o.fixture = v();
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return o;
}

const USAGE = `Usage: node bench.mjs --data rows.jsonl|rows.csv --questions questions.json --chat-model <openrouter model id>
  [--limit 20|all] [--confidence-threshold 0.8] [--text-field text] [--concurrency 4] [--out bench-out]
Needs OPENROUTER_API_KEY in the environment. Default limit is 20 rows: pilot first.

Offline demo, no API key needed: node bench.mjs --fixture examples/fixture.json --data examples/support-messages.jsonl --questions examples/questions.json
It replays invented answers (see scripts/make-fixture.mjs). The numbers are not a measurement.`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.fixture) { o.chatModel ??= 'fixture/chat'; o.decisionModel = 'fixture/decision'; }
  if (o.help || !o.data || !o.questions || !o.chatModel) { console.error(USAGE); process.exit(o.help ? 0 : 2); }
  if (!Number.isFinite(o.limit) && o.limit !== Infinity) throw new Error('--limit must be a number or "all"');
  const questions = JSON.parse(readFileSync(o.questions, 'utf8'));
  validateQuestions(questions);
  const rows = loadRows(o.data).slice(0, o.limit);
  if (!rows.length) throw new Error('No rows to run');
  if (!rows.every((r) => r[o.textField])) throw new Error(`Every row needs a "${o.textField}" field (use --text-field)`);
  const fixture = o.fixture ? JSON.parse(readFileSync(o.fixture, 'utf8')) : null;
  console.error(fixture
    ? `Fixture replay: ${rows.length} rows of canned answers. No API calls are made.`
    : `Running ${rows.length} rows against ${o.decisionModel} and ${o.chatModel}...`);
  const results = await pool(rows, o.concurrency, async (row, i) => {
    const text = String(row[o.textField]);
    if (fixture) {
      const f = fixture.rows?.[String(i + 1)];
      if (!f) throw new Error(`fixture has no row ${i + 1}`);
      return { index: i + 1, row, text, decision: f.decision, chat: f.chat };
    }
    const [decision, chat] = await Promise.all([
      decide({ state: text, questions, model: o.decisionModel }).catch((e) => { console.error(`row ${i + 1} decision failed: ${e.message}`); return null; }),
      chatDecide({ text, questions, model: o.chatModel }).catch((e) => { console.error(`row ${i + 1} chat failed: ${e.message}`); return null; }),
    ]);
    return { index: i + 1, row, text, decision, chat };
  });
  const summary = summarize(results, questions, { threshold: o.threshold ?? null });
  const report = renderReport(summary, { decisionModel: o.decisionModel, chatModel: o.chatModel, threshold: o.threshold ?? null, fixture: Boolean(fixture) });
  mkdirSync(o.out, { recursive: true });
  writeFileSync(`${o.out}/report.md`, report);
  writeFileSync(`${o.out}/results.json`, JSON.stringify({ summary, results }, null, 2));
  console.log(report);
  console.error(`\nWrote ${o.out}/report.md and ${o.out}/results.json`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
}
