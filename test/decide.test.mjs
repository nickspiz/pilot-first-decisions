import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, normalizeAnswer, normalizeResponse, validateQuestions } from '../decide.mjs';

const sample = {
  model: 'typesafe/jev-1.13-x',
  answers: {
    angry: { type: 'noul', noul: 0.9 },
    topic: { type: 'choice', choice: 'billing', probabilities: { bug: 0, billing: 1 }, confidence: 1 },
    urgency: { type: 'score', score: 1.72, legend: { 0: 'low', 1: 'medium', 2: 'high' }, probabilities: { 0: 0, 1: 0.28, 2: 0.72 }, confidence: 0.58 },
  },
  usage: { cost: 0.000015 },
};

test('normalizes noul', () => {
  assert.deepEqual(normalizeAnswer(sample.answers.angry), { type: 'noul', label: 'yes', value: 0.9, confidence: 0.8 });
  assert.equal(normalizeAnswer({ type: 'noul', noul: 0.2 }).label, 'no');
});
test('normalizes choice', () => {
  const a = normalizeAnswer(sample.answers.topic);
  assert.equal(a.label, 'billing');
  assert.equal(a.confidence, 1);
});
test('normalizes score to nearest legend entry', () => {
  const a = normalizeAnswer(sample.answers.urgency);
  assert.equal(a.label, 'high');
  assert.equal(a.value, 1.72);
});
test('rejects malformed answers', () => {
  assert.throws(() => normalizeAnswer(null));
  assert.throws(() => normalizeAnswer({ type: 'noul' }));
  assert.throws(() => normalizeAnswer({ type: 'wat' }));
  assert.throws(() => normalizeResponse({}));
});
test('validates question specs', () => {
  assert.throws(() => validateQuestions({}));
  assert.throws(() => validateQuestions({ a: { type: 'choice', instructions: 'x' } }));
  assert.throws(() => validateQuestions({ a: { type: 'nope', instructions: 'x' } }));
  validateQuestions({ a: { type: 'noul', instructions: 'x' } });
});
test('decide posts the right request and parses the reply (mock fetch)', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => sample };
  };
  const out = await decide({ state: 'hello', questions: { angry: { type: 'noul', instructions: 'Angry?' } }, apiKey: 'test-key', fetchImpl });
  assert.equal(seen.url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(seen.init.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'typesafe/jev-1.13');
  assert.equal(body.state, 'hello');
  assert.equal(out.cost, 0.000015);
  assert.equal(out.answers.topic.label, 'billing');
});
test('decide surfaces API errors and missing key', async () => {
  const q = { a: { type: 'noul', instructions: 'x' } };
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) });
  await assert.rejects(decide({ state: 's', questions: q, apiKey: 'k', fetchImpl }), /bad key/);
  const saved = process.env.OPENROUTER_API_KEY;
  const savedOpt = process.env.CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY;
  await assert.rejects(decide({ state: 's', questions: q, fetchImpl }), /OPENROUTER_API_KEY/);
  if (saved) process.env.OPENROUTER_API_KEY = saved;
  if (savedOpt) process.env.CLAUDE_PLUGIN_OPTION_OPENROUTER_API_KEY = savedOpt;
});
