#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const AGY_BIN = 'agy';
const AUTH_CHECK_TIMEOUT_MS = 15000;
const DEFAULT_PRINT_TIMEOUT = '8m';
const VALID_MODES = ['accept-edits', 'plan'];
const VALID_EFFORTS = ['low', 'medium', 'high'];

// Every agy model slug either bakes the effort in (gemini-3.8-flash-high) or refuses
// the flag outright (claude-sonnet-4-6 -> "--effort is not supported for model"). So
// --effort is only meaningful when no explicit model is given, and agy uses it to pick one.

// Observed in the agy binary's status enum. The CLI returns SUCCESS, not OK.
const SUCCESS_STATUSES = new Set(['SUCCESS', 'OK']);

const TASK_TYPES = {
  ask: {
    description: 'General question or discussion. Writes nothing.',
    writes: false,
    mode: null,
    skipPermissions: false,
    framing: null,
  },
  research: {
    description: 'Search the web and report findings with sources. Writes nothing.',
    writes: false,
    mode: null,
    skipPermissions: false,
    // Fetching a page (ReadUrlContent) is denied in headless print mode, so the framing
    // keeps research on search results, which come back with the search tool itself.
    framing: () =>
      'Research this using your web search tool, and answer from the search results themselves. Do not fetch or open individual URLs, do not run shell commands, and do not create or modify any files. Answer in prose and list the source URLs you relied on at the end.',
  },
  image: {
    description: 'Generate image file(s) using the generate_image tool.',
    writes: true,
    mode: null,
    skipPermissions: true,
    framing: (out) =>
      `Use your generate_image tool to produce the image described above, and save the result into the directory ${out}. End your reply with the absolute path of every file you created, one per line.`,
  },
  ui: {
    description: 'Build a self-contained HTML artifact (chart, dashboard, diagram, widget).',
    writes: true,
    mode: null,
    skipPermissions: true,
    // "Self-contained" alone is not enough — the generative_ui skill itself points at a
    // Tailwind CDN, so agy will happily pull Chart.js and Google Fonts and call it one
    // file. The ban has to be spelled out or the artifact breaks with no network.
    framing: (out) =>
      `Build this as a single HTML file and write it into the directory ${out}. It must work with no network access at all: no CDN script tags, no external stylesheets, no Google Fonts or other remote fonts, no remote images. Inline every bit of CSS and JavaScript, draw any chart with inline SVG or canvas instead of a charting library, use system font stacks only, and embed any image as a data URI. Before you finish, check the file and confirm it contains no http:// or https:// resource references. End your reply with the absolute path of every file you created, one per line.`,
  },
  code: {
    description: 'Write or modify code in the target directory.',
    writes: true,
    mode: 'accept-edits',
    skipPermissions: false,
    // Kept on accept-edits (file edits only) rather than blanket auto-approval. Shell
    // commands stay denied in headless mode, so the framing steers agy to its file tools.
    framing: (out) =>
      `Work inside the directory ${out}. Make the changes using your file editing tools only — do not run shell commands, do not run tests, and do not install anything. When you are done, list every file you created or modified with its absolute path.`,
  },
};

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

  return { ready, agy, auth, nextSteps, taskTypes: describeTaskTypes() };
}

function describeTaskTypes() {
  return Object.fromEntries(
    Object.entries(TASK_TYPES).map(([name, spec]) => [name, { description: spec.description, writes: spec.writes }])
  );
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const value = next !== undefined && !next.startsWith('--') ? (i++, next) : true;
      if (key in flags) {
        flags[key] = Array.isArray(flags[key]) ? [...flags[key], value] : [flags[key], value];
      } else {
        flags[key] = value;
      }
    } else {
      flags._.push(a);
    }
  }
  return flags;
}

function str(value) {
  return value !== undefined && value !== true ? String(Array.isArray(value) ? value[value.length - 1] : value) : null;
}

function list(value) {
  if (value === undefined || value === true) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v !== true).map(String);
}

function buildAgyArgs({ prompt, model, effort, agent, mode, addDirs, timeout, skipPermissions }) {
  const args = ['-p', prompt, '--output-format', 'json'];
  if (model) args.push('--model', model);
  if (effort && !model) args.push('--effort', effort);
  if (agent) args.push('--agent', agent);
  if (mode) args.push('--mode', mode);
  for (const dir of addDirs) args.push('--add-dir', dir);
  args.push('--print-timeout', String(timeout || DEFAULT_PRINT_TIMEOUT));
  if (skipPermissions) args.push('--dangerously-skip-permissions');
  return args;
}

// agy exits 0 and reports terminal state in the envelope, so success/failure has to be
// read from the body. Two cases are collapsed to ERROR so a caller cannot relay a dead
// run as a real answer: a non-success status, and — the one agy does not label — a
// --print-timeout expiry, which comes back as SUCCESS with an empty response.
function normalizeOutcome(envelope) {
  const status = typeof envelope.status === 'string' ? envelope.status.toUpperCase() : '';
  const fail = (error) => ({ ...envelope, status: 'ERROR', agyStatus: status || null, error });

  if (!SUCCESS_STATUSES.has(status)) {
    return fail(envelope.error || `agy returned status ${status || '(missing)'}`);
  }
  if (!String(envelope.response || '').trim()) {
    const denied = (Array.isArray(envelope.denied_actions) ? envelope.denied_actions : [])
      .map((d) => d.display_name || d.action)
      .filter(Boolean);
    if (denied.length) {
      return fail(`agy ended the turn with no answer because these actions were denied in headless mode: ${denied.join(', ')}`);
    }
    return fail('agy returned an empty response — the run most likely hit --print-timeout; retry with a longer --timeout');
  }
  return envelope;
}

function executeAgy(args) {
  const r = runAgy(args, undefined);
  if (r.error) {
    return { status: 'ERROR', error: String(r.error.message || r.error) };
  }

  const stdout = (r.stdout || '').trim();
  if (!stdout) {
    return { status: 'ERROR', error: (r.stderr || 'no output from agy').trim() };
  }

  try {
    return normalizeOutcome(JSON.parse(stdout));
  } catch {
    return { status: 'ERROR', error: 'failed to parse agy output as JSON', raw: stdout.slice(0, 2000) };
  }
}

function resolveShared(flags) {
  const mode = str(flags.mode);
  if (mode && !VALID_MODES.includes(mode)) {
    // agy only warns on an unknown --mode and then runs in the default mode, so an
    // unvalidated typo would silently run write-enabled. Reject it here instead.
    return { error: `invalid --mode "${mode}" (valid: ${VALID_MODES.join(', ')})` };
  }
  const effort = str(flags.effort);
  if (effort && !VALID_EFFORTS.includes(effort)) {
    return { error: `invalid --effort "${effort}" (valid: ${VALID_EFFORTS.join(', ')})` };
  }
  return {
    mode,
    effort,
    model: str(flags.model),
    agent: str(flags.agent),
    timeout: str(flags.timeout),
    addDirs: list(flags['add-dir']).map((d) => resolve(d)),
  };
}

function cmdRun(flags) {
  const prompt = str(flags.prompt);
  if (!prompt) {
    return { status: 'ERROR', error: 'missing --prompt "<text>"' };
  }

  const shared = resolveShared(flags);
  if (shared.error) return { status: 'ERROR', error: shared.error };

  return executeAgy(
    buildAgyArgs({ ...shared, prompt, skipPermissions: Boolean(flags['skip-permissions']) })
  );
}

function cmdTask(flags) {
  const type = (str(flags.type) || 'ask').toLowerCase();
  const spec = TASK_TYPES[type];
  if (!spec) {
    return { status: 'ERROR', error: `unknown --type "${type}" (valid: ${Object.keys(TASK_TYPES).join(', ')})` };
  }

  const prompt = str(flags.prompt);
  if (!prompt) {
    return { status: 'ERROR', error: 'missing --prompt "<text>"' };
  }

  const shared = resolveShared(flags);
  if (shared.error) return { status: 'ERROR', error: shared.error };

  const out = resolve(str(flags.out) || process.cwd());
  if (spec.writes && !(existsSync(out) && statSync(out).isDirectory())) {
    return { status: 'ERROR', error: `--out directory does not exist: ${out}` };
  }

  const framing = spec.framing ? spec.framing(out) : null;
  const addDirs = spec.writes ? [...new Set([...shared.addDirs, out])] : shared.addDirs;

  const result = executeAgy(
    buildAgyArgs({
      ...shared,
      prompt: framing ? `${prompt}\n\n${framing}` : prompt,
      mode: shared.mode || spec.mode,
      addDirs,
      skipPermissions: Boolean(flags['skip-permissions']) || spec.skipPermissions,
    })
  );

  return { ...result, taskType: type, outputDir: spec.writes ? out : null };
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
    case 'task':
      result = cmdTask(flags);
      break;
    case 'types':
      result = { taskTypes: describeTaskTypes() };
      break;
    default:
      result = { error: `unknown command: ${command || '(none)'} (valid: setup, run, task, types)` };
  }

  console.log(JSON.stringify(result, null, 2));
}

main();
