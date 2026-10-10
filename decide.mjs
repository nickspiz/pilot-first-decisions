#!/usr/bin/env node
// Tiny client for the OpenRouter decisions endpoint.
// Question types: noul (yes/no probability), choice (pick one), score (rate on a scale).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const DEFAULT_MODEL = 'typesafe/jev-1.13';
const TYPES = new Set(['noul', 'choice', 'score']);

export function validateQuestions(questions) {
  if (!questions || typeof questions !== 'object' || !Object.keys(questions).length) {
    throw new Error('questions must be a non-empty object');
  }
  for (const [name, q] of Object.entries(questions)) {
    if (!TYPES.has(q?.type)) throw new Error(`question "${name}": type must be noul, choice or score`);
    if (!q.instructions) throw new Error(`question "${name}": instructions are required`);
    if (q.type !== 'noul' && !q.criteria) throw new Error(`question "${name}": criteria are required for ${q.type}`);
  }
}

/**
 * Turn one raw answer into { type, label, value, confidence }.
 * noul:   label "yes"/"no", value = probability of yes, confidence = distance from a coin flip, scaled 0..1
 * choice: label = chosen key, confidence from the API
 * score:  label = nearest legend entry, value = raw score
 */
export function normalizeAnswer(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('empty answer');
  if (raw.type === 'noul') {
    const p = Number(raw.noul);
    if (!Number.isFinite(p)) throw new Error('noul answer without a probability');
    return { type: 'noul', label: p >= 0.5 ? 'yes' : 'no', value: p, confidence: Math.abs(p - 0.5) * 2 };
  }
  if (raw.type === 'choice') {
    if (typeof raw.choice !== 'string') throw new Error('choice answer without a choice');
    return { type: 'choice', label: raw.choice, value: raw.probabilities?.[raw.choice] ?? null, confidence: Number(raw.confidence ?? 0) };
  }
  if (raw.type === 'score') {
    const s = Number(raw.score);
    if (!Number.isFinite(s)) throw new Error('score answer without a number');
    const legend = raw.legend ?? {};
    const keys = Object.keys(legend);
    const idx = keys.length ? String(Math.min(Math.max(Math.round(s), 0), keys.length - 1)) : null;
    return { type: 'score', label: idx !== null ? legend[idx] ?? idx : String(s), value: s, confidence: Number(raw.confidence ?? 0) };
  }
  throw new Error(`unknown answer type "${raw.type}"`);
}

export function normalizeResponse(data) {
  if (!data?.answers) throw new Error('response has no answers');
  const answers = {};
  for (const [name, raw] of Object.entries(data.answers)) answers[name] = normalizeAnswer(raw);
  return { answers, cost: Number(data.usage?.cost ?? 0), model: data.model };
}

/**
 * Ask many questions about one piece of text in a single request.
 * Returns { answers, cost, latencyMs, model }.
 */
export async function decide({ state, questions, apiKey = process.env.OPENROUTER_API_KEY, model = DEFAULT_MODEL, url = DECISIONS_URL, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  validateQuestions(questions);
  const started = performance.now();
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, state, questions }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const latencyMs = Math.round(performance.now() - started);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `decisions endpoint returned HTTP ${res.status}`);
  return { ...normalizeResponse(data), latencyMs };
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  const text = get('--text');
  const specPath = get('--questions');
  if (!text || !specPath) {
    console.error('Usage: node decide.mjs --text "message" --questions questions.json [--model typesafe/jev-1.13]');
    process.exit(2);
  }
  const questions = JSON.parse(readFileSync(specPath, 'utf8'));
  const out = await decide({ state: text, questions, model: get('--model') ?? DEFAULT_MODEL });
  console.log(JSON.stringify(out, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
}
