#!/usr/bin/env node
// Offline smoke test for agy-companion.mjs. Never invokes `agy`, so it runs anywhere
// in under a second — no CLI install, no auth, no network.
//
//   node test/smoke.mjs
//
// Exits non-zero on the first failing assertion group.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../plugins/antigravity/scripts/agy-companion.mjs');
const TYPES = ['ask', 'image', 'ui', 'code'];
const MISSING_DIR = resolve(tmpdir(), `agy-smoke-missing-${Date.now()}`);

let failed = 0;

function call(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`script exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) {
      failed++;
      console.error(`FAIL  ${name}\n      ${problem}`);
    } else {
      console.log(`ok    ${name}`);
    }
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      threw: ${err.message}`);
  }
}

function argvOf(...args) {
  const result = call(...args, '--dry-run');
  if (!result.dryRun) throw new Error(`expected a dry run, got ${JSON.stringify(result).slice(0, 120)}`);
  return result.argv;
}

function expectError(actual, expected) {
  return actual === expected ? null : `expected error ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

// --- the task type table -----------------------------------------------------

check('types lists exactly the four task types', () => {
  const names = Object.keys(call('types').taskTypes);
  const same = names.length === TYPES.length && TYPES.every((t) => names.includes(t));
  return same ? null : `expected ${TYPES.join(', ')} — got ${names.join(', ')}`;
});

check('every task type declares a description', () => {
  const entries = Object.entries(call('types').taskTypes);
  const bad = entries.filter(([, spec]) => typeof spec.description !== 'string' || !spec.description);
  return bad.length ? `missing description: ${bad.map(([n]) => n).join(', ')}` : null;
});

// --- validation, all of it before agy is ever spawned ------------------------

check('unknown --type is rejected', () =>
  expectError(call('task', '--type', 'zzz', '--prompt', 'x').error, 'unknown --type "zzz" (valid: ask, image, ui, code)')
);

check('missing --prompt is rejected', () =>
  expectError(call('task', '--type', 'ask').error, 'missing --prompt "<text>"')
);

check('invalid --mode is rejected rather than forwarded', () =>
  expectError(
    call('task', '--type', 'ask', '--prompt', 'x', '--mode', 'bogus').error,
    'invalid --mode "bogus" (valid: accept-edits, plan)'
  )
);

check('invalid --effort is rejected', () =>
  expectError(
    call('task', '--type', 'ask', '--prompt', 'x', '--effort', 'bogus').error,
    'invalid --effort "bogus" (valid: low, medium, high)'
  )
);

check('a missing --out directory is caught before the run', () => {
  const { error } = call('task', '--type', 'image', '--prompt', 'x', '--out', MISSING_DIR);
  return error === `--out directory does not exist: ${MISSING_DIR}`
    ? null
    : `got ${JSON.stringify(error)}`;
});

check('validation failures report status ERROR', () => {
  const { status } = call('task', '--type', 'zzz', '--prompt', 'x');
  return status === 'ERROR' ? null : `got status ${JSON.stringify(status)}`;
});

// --- flag building -----------------------------------------------------------

check('--effort is dropped when --model is set', () => {
  const argv = argvOf('task', '--type', 'ask', '--prompt', 'x', '--model', 'gemini-3.8-flash-high', '--effort', 'high');
  return argv.includes('--effort') ? `--effort leaked into: ${argv.join(' ')}` : null;
});

check('--effort is kept when no --model is named', () => {
  const argv = argvOf('task', '--type', 'ask', '--prompt', 'x', '--effort', 'high');
  return argv.includes('--effort') ? null : `--effort missing from: ${argv.join(' ')}`;
});

check('--conversation is forwarded', () => {
  const argv = argvOf('task', '--type', 'ask', '--prompt', 'x', '--conversation', 'abc-123');
  const i = argv.indexOf('--conversation');
  return i !== -1 && argv[i + 1] === 'abc-123' ? null : `not forwarded: ${argv.join(' ')}`;
});

check('-c / --continue is never used', () => {
  for (const type of TYPES) {
    const argv = argvOf('task', '--type', type, '--prompt', 'x', '--conversation', 'abc-123');
    if (argv.includes('-c') || argv.includes('--continue')) return `${type} emitted a bare continue: ${argv.join(' ')}`;
  }
  return null;
});

check('--agent is never forwarded', () => {
  // agy agents is empty on a stock install, so the flag is intentionally unsupported.
  const argv = argvOf('run', '--prompt', 'x', '--agent', 'whatever');
  return argv.includes('--agent') ? `--agent leaked into: ${argv.join(' ')}` : null;
});

check('model aliases resolve to full slugs', () => {
  const expected = {
    flash: 'gemini-3.8-flash-high',
    'flash-medium': 'gemini-3.8-flash-medium',
    'flash-low': 'gemini-3.8-flash-low',
    pro: 'gemini-3.1-pro-high',
    'pro-low': 'gemini-3.1-pro-low',
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-6-thinking',
    'gpt-oss': 'gpt-oss-120b-medium',
  };
  for (const [alias, slug] of Object.entries(expected)) {
    const argv = argvOf('task', '--type', 'ask', '--prompt', 'x', '--model', alias);
    const got = argv[argv.indexOf('--model') + 1];
    if (got !== slug) return `${alias} resolved to ${got}, expected ${slug}`;
  }
  return null;
});

check('a raw model slug is passed through untouched', () => {
  const argv = argvOf('task', '--type', 'ask', '--prompt', 'x', '--model', 'gemini-3.6-flash-low');
  const got = argv[argv.indexOf('--model') + 1];
  return got === 'gemini-3.6-flash-low' ? null : `got ${got}`;
});

check('--fresh suppresses --conversation', () => {
  const argv = argvOf('task', '--type', 'ask', '--prompt', 'x', '--conversation', 'abc-123', '--fresh');
  return argv.includes('--conversation') ? `conversation survived --fresh: ${argv.join(' ')}` : null;
});

check('every task type carries the follow-through block', () => {
  // agy cannot be asked a clarifying question in headless mode, so this block must never
  // be dropped from a preset.
  for (const type of TYPES) {
    const prompt = argvOf('task', '--type', type, '--prompt', 'x')[1];
    if (!prompt.includes('Do not ask a clarifying question')) return `${type} is missing it`;
  }
  return null;
});

check('every writing type still states its output contract', () => {
  for (const type of TYPES) {
    const prompt = argvOf('task', '--type', type, '--prompt', 'x')[1];
    if (!/absolute path/.test(prompt)) return `${type} never asks for absolute paths`;
  }
  return null;
});

check('the ui preset still bans remote resources', () => {
  const prompt = argvOf('task', '--type', 'ui', '--prompt', 'x')[1];
  for (const phrase of ['no CDN script tags', 'no Google Fonts', 'no network access at all']) {
    if (!prompt.includes(phrase)) return `missing phrase: ${phrase}`;
  }
  return null;
});

check('the code preset still forbids shell commands', () => {
  const prompt = argvOf('task', '--type', 'code', '--prompt', 'x')[1];
  return prompt.includes('do not run shell commands') ? null : 'the no-shell steer is gone';
});

check('ask is told the shell is unavailable', () => {
  // Without this, follow-through turns "test X" into a RunCommand attempt that `ask`
  // denies, and the run dies empty instead of answering.
  const prompt = argvOf('task', '--type', 'ask', '--prompt', 'x')[1];
  return prompt.includes('Shell commands are not available') ? null : 'the no-shell notice is gone';
});

check('--name reaches the prompt', () => {
  const prompt = argvOf('task', '--type', 'image', '--prompt', 'x', '--name', 'hero')[1];
  return prompt.includes('Name the file you create "hero"') ? null : `not in prompt: ${prompt.slice(-160)}`;
});

check('omitting --name leaves the prompt untouched', () => {
  // The naming block is appended, so its absence must change nothing at all.
  for (const type of TYPES) {
    const withName = argvOf('task', '--type', type, '--prompt', 'x', '--name', 'hero')[1];
    const without = argvOf('task', '--type', type, '--prompt', 'x')[1];
    if (!withName.startsWith(without)) return `${type}: the base prompt changed when --name was added`;
    if (without.includes('Name the file')) return `${type}: naming text leaked in without --name`;
  }
  return null;
});

check('--add-dir is forwarded and repeatable', () => {
  const argv = argvOf('run', '--prompt', 'x', '--add-dir', '.', '--add-dir', '..');
  const count = argv.filter((a) => a === '--add-dir').length;
  return count === 2 ? null : `expected 2 --add-dir, got ${count}: ${argv.join(' ')}`;
});

check('every run asks for JSON output and a print timeout', () => {
  const argv = argvOf('run', '--prompt', 'x');
  if (!argv.includes('--output-format') || argv[argv.indexOf('--output-format') + 1] !== 'json') {
    return `missing --output-format json: ${argv.join(' ')}`;
  }
  return argv.includes('--print-timeout') ? null : `missing --print-timeout: ${argv.join(' ')}`;
});

// --- per-type presets, as documented ----------------------------------------

check('image and ui carry unattended approval', () => {
  for (const type of ['image', 'ui']) {
    const argv = argvOf('task', '--type', type, '--prompt', 'x');
    if (!argv.includes('--dangerously-skip-permissions')) return `${type} is missing it: ${argv.join(' ')}`;
  }
  return null;
});

check('ask and code stay on accept-edits without unattended approval', () => {
  for (const type of ['ask', 'code']) {
    const argv = argvOf('task', '--type', type, '--prompt', 'x');
    if (argv.includes('--dangerously-skip-permissions')) return `${type} should not auto-approve: ${argv.join(' ')}`;
    const i = argv.indexOf('--mode');
    if (i === -1 || argv[i + 1] !== 'accept-edits') return `${type} is not on accept-edits: ${argv.join(' ')}`;
  }
  return null;
});

check('every type gets its output directory on --add-dir', () => {
  for (const type of TYPES) {
    const argv = argvOf('task', '--type', type, '--prompt', 'x');
    if (!argv.includes('--add-dir')) return `${type} is missing --add-dir: ${argv.join(' ')}`;
  }
  return null;
});

// -----------------------------------------------------------------------------

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
