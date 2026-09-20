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
