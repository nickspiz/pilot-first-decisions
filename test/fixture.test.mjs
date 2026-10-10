import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

test('--fixture replays canned answers with no key and no network', () => {
  const out = mkdtempSync(join(tmpdir(), 'pfd-'));
  const env = { PATH: process.env.PATH, HOME: out }; // no OPENROUTER_API_KEY
  const stdout = execFileSync('node', [
    join(root, 'bench.mjs'), '--fixture', join(root, 'examples/fixture.json'),
    '--data', join(root, 'examples/support-messages.jsonl'),
    '--questions', join(root, 'examples/questions.json'),
    '--confidence-threshold', '0.8', '--limit', '60', '--out', out,
  ], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assert.match(stdout, /Fixture replay/);
  assert.match(stdout, /## Agreement/);
  assert.match(stdout, /Rows: 60 \(failed: 0\)/);
  assert.ok(existsSync(join(out, 'report.md')));
  assert.equal(JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')).summary.rows, 60);
});

test('fixture covers every example row', () => {
  const fx = JSON.parse(readFileSync(join(root, 'examples/fixture.json'), 'utf8'));
  assert.equal(Object.keys(fx.rows).length, 60);
});
