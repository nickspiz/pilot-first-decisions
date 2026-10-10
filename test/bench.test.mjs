import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedLabels, buildChatPrompt, parseChatAnswers, chatDecide, summarize, renderReport } from '../bench.mjs';

const questions = {
  sentiment: { type: 'choice', instructions: 'Tone?', criteria: { positive: 'happy', neutral: 'plain', negative: 'upset' } },
  urgent: { type: 'noul', instructions: 'Urgent?' },
};

test('allowedLabels covers all types', () => {
  assert.deepEqual(allowedLabels(questions.sentiment), ['positive', 'neutral', 'negative']);
  assert.deepEqual(allowedLabels(questions.urgent), ['yes', 'no']);
  assert.deepEqual(allowedLabels({ type: 'score', criteria: ['low', 'high'] }), ['low', 'high']);
});
test('prompt lists every question', () => {
  const p = buildChatPrompt('hi there', questions);
  assert.match(p, /"sentiment"/);
  assert.match(p, /"urgent"/);
  assert.match(p, /hi there/);
});
test('parseChatAnswers tolerates fences, case, booleans and invalid labels', () => {
  const a = parseChatAnswers('```json\n{"sentiment":"Negative","urgent":true}\n```', questions);
  assert.deepEqual(a, { sentiment: 'negative', urgent: 'yes' });
  assert.deepEqual(parseChatAnswers('{"sentiment":"angry"}', questions), { sentiment: null, urgent: null });
  assert.deepEqual(parseChatAnswers('not json', questions), { sentiment: null, urgent: null });
});
test('chatDecide reads cost and answers (mock fetch)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"sentiment":"positive","urgent":"no"}' } }], usage: { cost: 0.001 } }) });
  const r = await chatDecide({ text: 'x', questions, model: 'm', apiKey: 'k', fetchImpl });
  assert.equal(r.cost, 0.001);
  assert.equal(r.answers.sentiment, 'positive');
});

const mk = (i, chat, dec, conf, expected) => ({
  index: i, text: `row ${i}`, row: { expected_sentiment: expected },
  chat: { answers: { sentiment: chat, urgent: 'no' }, cost: 0.002, latencyMs: 800 },
  decision: { answers: { sentiment: { label: dec, confidence: conf }, urgent: { label: 'no', confidence: 1 } }, cost: 0.0001, latencyMs: 300 },
});

test('summarize computes agreement, accuracy, hybrid and disagreements', () => {
  const results = [
    mk(1, 'negative', 'negative', 0.9, 'negative'),
    mk(2, 'negative', 'neutral', 0.3, 'negative'),
    mk(3, 'positive', 'positive', 0.95, 'positive'),
    mk(4, 'neutral', 'positive', 0.9, 'neutral'),
  ];
  const s = summarize(results, questions, { threshold: 0.8 });
  const q = s.perQuestion.sentiment;
  assert.equal(q.agreement.rate, 0.5);
  assert.equal(q.disagreements.length, 2);
  assert.equal(q.accuracy.chat.rate, 1);
  assert.equal(q.accuracy.decision.rate, 0.5);
  assert.equal(q.hybrid.routedRate, 0.25);
  assert.equal(q.hybrid.agreementWithChat.rate, 0.75);
  assert.equal(s.perQuestion.urgent.agreement.rate, 1);
  assert.ok(Math.abs(s.decisionCost - 0.0004) < 1e-12);
  assert.equal(s.chatMedianMs, 800);
  const md = renderReport(s, { decisionModel: 'd', chatModel: 'c', threshold: 0.8 });
  assert.match(md, /Confusion matrix: sentiment/);
  assert.match(md, /Disagreements/);
});
test('summarize counts failed rows', () => {
  const s = summarize([{ index: 1, text: 't', row: {}, chat: null, decision: null }], questions);
  assert.equal(s.errors, 1);
  assert.equal(s.perQuestion.sentiment.agreement.rate, null);
});
