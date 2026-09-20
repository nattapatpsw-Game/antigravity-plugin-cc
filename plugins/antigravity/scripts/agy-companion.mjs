#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const AGY_BIN = 'agy';
const AUTH_CHECK_TIMEOUT_MS = 15000;
const DEFAULT_PRINT_TIMEOUT = '8m';

function runAgy(args, timeoutMs) {
  return spawnSync(AGY_BIN, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
}

function checkAgyAvailable() {
  const r = runAgy(['--version'], 10000);
  if (r.error) {
    return {
      available: false,
      detail: r.error.code === 'ENOENT' ? 'agy not found on PATH' : String(r.error.message || r.error),
    };
  }
  if (r.status !== 0) {
    return { available: false, detail: (r.stderr || r.stdout || 'agy --version failed').trim() };
  }
  return { available: true, detail: (r.stdout || '').trim() };
}

function checkAuth() {
  // `agy models` fails fast with a clear "please sign in" message when unauthenticated,
  // unlike `agy -p`, which launches an interactive OAuth browser flow and hangs ~60s.
  const r = runAgy(['models'], AUTH_CHECK_TIMEOUT_MS);
  if (r.error) {
    return {
      loggedIn: false,
      detail: r.error.code === 'ETIMEDOUT' ? 'timed out checking auth' : String(r.error.message || r.error),
    };
  }
  if (r.status === 0) {
    return { loggedIn: true, detail: 'signed in' };
  }
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (/sign in/i.test(out)) {
    return { loggedIn: false, detail: 'not signed in' };
  }
  return { loggedIn: false, detail: out.trim() || 'auth check failed' };
}

function cmdSetup() {
  const agy = checkAgyAvailable();
  const auth = agy.available ? checkAuth() : { loggedIn: false, detail: 'agy not installed' };
  const ready = agy.available && auth.loggedIn;

  const nextSteps = [];
  if (!agy.available) {
    nextSteps.push('Install the Antigravity CLI: see https://antigravity.google/docs/cli/install/ for your platform.');
  } else if (!auth.loggedIn) {
    nextSteps.push('Run `agy` with no arguments in a terminal outside Claude Code to sign in (opens a browser).');
    nextSteps.push(
      'Or set GEMINI_API_KEY and add {"modelProvider":"gemini"} to ~/.gemini/antigravity-cli/settings.json for headless auth.'
    );
  }

  return { ready, agy, auth, nextSteps };
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      flags._.push(a);
    }
  }
  return flags;
}

function cmdRun(flags) {
  const prompt = flags.prompt;
  if (!prompt || prompt === true) {
    return { status: 'ERROR', error: 'missing --prompt "<text>"' };
  }

  const args = ['-p', prompt, '--output-format', 'json'];
  if (flags.model && flags.model !== true) args.push('--model', flags.model);
  if (flags.effort && flags.effort !== true) args.push('--effort', flags.effort);
  if (flags.agent && flags.agent !== true) args.push('--agent', flags.agent);
  const printTimeout = flags.timeout && flags.timeout !== true ? flags.timeout : DEFAULT_PRINT_TIMEOUT;
  args.push('--print-timeout', String(printTimeout));
  if (flags['skip-permissions']) args.push('--dangerously-skip-permissions');

  const r = runAgy(args, undefined);
  if (r.error) {
    return { status: 'ERROR', error: String(r.error.message || r.error) };
  }

  const stdout = (r.stdout || '').trim();
  if (!stdout) {
    return { status: 'ERROR', error: (r.stderr || 'no output from agy').trim() };
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return { status: 'ERROR', error: 'failed to parse agy output as JSON', raw: stdout.slice(0, 2000) };
  }
}

function main() {
  const [, , command, ...rest] = process.argv;
  const flags = parseFlags(rest);

  let result;
  switch (command) {
    case 'setup':
      result = cmdSetup();
      break;
    case 'run':
      result = cmdRun(flags);
      break;
    default:
      result = { error: `unknown command: ${command || '(none)'}` };
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
