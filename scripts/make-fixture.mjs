#!/usr/bin/env node
// Builds examples/fixture.json: canned answers for the 60 example rows, so
// `node bench.mjs --fixture examples/fixture.json ...` runs with no network and no cost.
// The answers are INVENTED from the expected labels plus seeded noise. They show the
// shape of a run. They are not a measurement of any model.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadRows } from '../lib/io.mjs';

let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const rows = loadRows('examples/support-messages.jsonl');
const questions = JSON.parse(readFileSync('examples/questions.json', 'utf8'));
const other = (labels, not) => labels.filter((l) => l !== not)[Math.floor(rnd() * (labels.length - 1))];

const out = { _note: 'Invented answers for offline demos. Not a measurement of any model.', rows: {} };
rows.forEach((row, i) => {
  const dec = {}; const chat = {};
  for (const [name, q] of Object.entries(questions)) {
    const labels = Object.keys(q.criteria);
    const truth = row[`expected_${name}`];
    // chat model: right about 92% of the time
    const chatLabel = rnd() < 0.92 ? truth : other(labels, truth);
    chat[name] = chatLabel;
    // decision model: right about 85%; when it is wrong it leans to "neutral" and is less sure
    let label = truth; let confidence = 0.8 + rnd() * 0.19;
    if (rnd() > (name === 'sentiment' ? 0.82 : 0.9)) {
      label = name === 'sentiment' && truth !== 'neutral' ? 'neutral' : other(labels, truth);
      confidence = 0.35 + rnd() * 0.3;
    }
    dec[name] = { label, confidence: Number(confidence.toFixed(2)) };
  }
  out.rows[i + 1] = {
    decision: { answers: dec, cost: 0.00003, latencyMs: Math.round(300 + rnd() * 160) },
    chat: { answers: chat, cost: Number((0.0002 + rnd() * 0.00012).toFixed(5)), latencyMs: Math.round(700 + rnd() * 450) },
  };
});
writeFileSync('examples/fixture.json', JSON.stringify(out, null, 1) + '\n');
