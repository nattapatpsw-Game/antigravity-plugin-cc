#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const AGY_BIN = 'agy';
const AUTH_CHECK_TIMEOUT_MS = 15000;
const DEFAULT_PRINT_TIMEOUT = '8m';
const VALID_MODES = ['accept-edits', 'plan'];
const VALID_EFFORTS = ['low', 'medium', 'high'];
// A genuine timeout reports the full budget (or 0); a dropped turn comes back in seconds.
const RETRY_MAX_DURATION_SECONDS = 30;

// Every agy model slug either bakes the effort in (gemini-3.8-flash-high) or refuses
// the flag outright (claude-sonnet-4-6 -> "--effort is not supported for model"). So
// --effort is only meaningful when no explicit model is given, and agy uses it to pick one.

// Observed in the agy binary's status enum. The CLI returns SUCCESS, not OK.
const SUCCESS_STATUSES = new Set(['SUCCESS', 'OK']);

// Friendly names for the model slugs. The raw slug is still accepted; nobody should have
// to remember `gemini-3.8-flash-high`.
const MODEL_ALIASES = {
  flash: 'gemini-3.8-flash-high',
  'flash-medium': 'gemini-3.8-flash-medium',
  'flash-low': 'gemini-3.8-flash-low',
  pro: 'gemini-3.1-pro-high',
  'pro-low': 'gemini-3.1-pro-low',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6-thinking',
  'gpt-oss': 'gpt-oss-120b-medium',
};

// Named prompt blocks, composed per task type below. Each string is load-bearing — the
// wording was arrived at by watching a specific headless failure — so blocks get
// rearranged and reused, never reworded.
const BLOCKS = {
  // agy has an ask_question tool and in print mode there is nobody to answer it, so a
  // clarifying question silently burns the whole run. Observed: an under-specified task
  // came back asking which of four things was meant, having done no work at all.
  followThrough:
    'Take the most reasonable low-risk interpretation of this request and carry it out. Do not ask a clarifying question — nobody is there to answer it. Stop only if a missing detail would change correctness or safety, and then say plainly what is missing.',

  // Pairs with followThrough. Told to stop asking and act, agy reaches for the shell —
  // observed: "test this alias" turned into a RunCommand attempt, which `ask` denies. It
  // has to know the shell is closed so it answers instead of dying on a denial.
  noShell:
    'Shell commands are not available to you in this run, so do not try to run one. If the request could be settled by running a command, answer from your own knowledge and say which command you would have run.',

  workIn: (out) => `Work inside the directory ${out}.`,

  reportPaths: 'End your reply with the absolute path of every file you created, one per line.',

  // agy names the files it writes, so this is the only way to influence the name.
  nameFile: (name) =>
    `Name the file you create "${name}", keeping an extension appropriate to its format. If the request produces more than one file, number them from "${name}".`,

  listChangedFiles: 'When you are done, list every file you created or modified with its absolute path.',

  fileToolsOnly:
    'Make the changes using your file editing tools only — do not run shell commands, do not run tests, and do not install anything.',

  answerOrWrite: (out) =>
    `If this request asks you to create or change a file, work inside the directory ${out}, use your file-editing tools rather than shell commands, and end your reply with the absolute path of every file you touched. If it is only a question, answer it directly and write nothing.`,

  generateImage: (out) =>
    `Use your generate_image tool to produce the image described above, and save the result into the directory ${out}.`,

  // "Self-contained" alone is not enough — the generative_ui skill itself points at a
  // Tailwind CDN, so agy will happily pull Chart.js and Google Fonts and call it one
  // file. The ban has to be spelled out or the artifact breaks with no network.
  offlineHtml: (out) =>
    `Build this as a single HTML file and write it into the directory ${out}. It must work with no network access at all: no CDN script tags, no external stylesheets, no Google Fonts or other remote fonts, no remote images. Inline every bit of CSS and JavaScript, draw any chart with inline SVG or canvas instead of a charting library, use system font stacks only, and embed any image as a data URI. Before you finish, check the file and confirm it contains no http:// or https:// resource references.`,
};

const TASK_TYPES = {
  ask: {
    description: 'General question or task. Answers in prose, and creates files when the request asks for them.',
    // accept-edits is enough for write_to_file on its own — verified. It deliberately
    // stops short of --dangerously-skip-permissions, so shell commands stay denied.
    writes: true,
    mode: 'accept-edits',
    skipPermissions: false,
    blocks: (out) => [BLOCKS.answerOrWrite(out), BLOCKS.noShell, BLOCKS.followThrough],
  },
  image: {
    description: 'Generate image file(s) using the generate_image tool.',
    writes: true,
    mode: null,
    skipPermissions: true,
    blocks: (out) => [BLOCKS.generateImage(out), BLOCKS.reportPaths, BLOCKS.followThrough],
  },
  ui: {
    description: 'Build a self-contained HTML artifact (chart, dashboard, diagram, widget).',
    writes: true,
    mode: null,
    skipPermissions: true,
    blocks: (out) => [BLOCKS.offlineHtml(out), BLOCKS.reportPaths, BLOCKS.followThrough],
  },
  code: {
    description: 'Write or modify code in the target directory.',
    writes: true,
    mode: 'accept-edits',
    skipPermissions: false,
    // Kept on accept-edits (file edits only) rather than blanket auto-approval. Shell
    // commands stay denied in headless mode, so the blocks steer agy to its file tools.
    blocks: (out) => [BLOCKS.workIn(out), BLOCKS.fileToolsOnly, BLOCKS.listChangedFiles, BLOCKS.followThrough],
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

function buildAgyArgs({ prompt, model, effort, mode, addDirs, timeout, skipPermissions, conversation }) {
  const args = ['-p', prompt, '--output-format', 'json'];
  // Always an explicit id, never -c/--continue: that means "most recent conversation
  // globally", which would silently attach to the Antigravity IDE or a parallel task.
  if (conversation) args.push('--conversation', conversation);
  if (model) args.push('--model', model);
  if (effort && !model) args.push('--effort', effort);
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

// Built here rather than left to the caller to compose, so the forwarding layer stays
// dumb and the formatting is in one place. The conversation id is what makes a follow-up
// possible; the duration says whether the run was light or heavy.
//
// Token counts are deliberately left out. agy's total is dominated by its own system
// prompt — a one-word answer still reports five figures — so it reads as alarming
// without saying anything about the task, and it only maps to money for GEMINI_API_KEY
// users rather than the default account auth. The raw `usage` object stays in the JSON
// for anyone who wants it.
function buildMetaLine(envelope) {
  const id = envelope.conversation_id;
  if (!id) return null;

  const parts = [`conversation: ${id}`];
  const seconds = envelope.duration_seconds;
  if (seconds) parts.push(`${Number(seconds).toFixed(1)}s`);

  return `[agy ${parts.join(' · ')}]`;
}

// A run can come back empty for two very different reasons, and only one is worth
// retrying: agy occasionally drops a turn and the identical prompt succeeds seconds
// later. A permission denial repeats identically, and a --print-timeout expiry burns the
// full budget, so retrying either just wastes the user's time.
function isTransientEmptyRun(envelope) {
  if (envelope.status !== 'ERROR') return false;
  if ((envelope.denied_actions || []).length) return false;
  if (String(envelope.response || '').trim()) return false;
  const seconds = Number(envelope.duration_seconds) || 0;
  return seconds > 0 && seconds < RETRY_MAX_DURATION_SECONDS;
}

function runAgyOnce(args) {
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

function executeAgy(args) {
  let outcome = runAgyOnce(args);
  let retried = false;

  if (isTransientEmptyRun(outcome)) {
    retried = true;
    outcome = runAgyOnce(args);
  }

  // Surfaced so a retry is never invisible — a task that needed two attempts is worth knowing about.
  return { ...outcome, metaLine: buildMetaLine(outcome), ...(retried && { retried: true }) };
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
  const rawModel = str(flags.model);
  return {
    mode,
    effort,
    model: rawModel ? MODEL_ALIASES[rawModel.toLowerCase()] || rawModel : null,
    timeout: str(flags.timeout),
    // --fresh forces a new conversation, overriding any id the caller inferred.
    conversation: flags.fresh ? null : str(flags.conversation),
    addDirs: list(flags['add-dir']).map((d) => resolve(d)),
  };
}

// Shallow on purpose: --out can be a whole repo for a `code` task, and recursing it on
// every run would cost more than it catches. Nested writes go unreported.
function snapshotDir(dir) {
  try {
    return new Map(
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => [entry.name, statSync(resolve(dir, entry.name)).mtimeMs])
    );
  } catch {
    return new Map();
  }
}

function diffSnapshots(dir, before, after) {
  const filesCreated = [];
  const filesModified = [];
  for (const [name, mtime] of after) {
    if (!before.has(name)) filesCreated.push(resolve(dir, name));
    else if (before.get(name) !== mtime) filesModified.push(resolve(dir, name));
  }
  return { filesCreated, filesModified };
}

function cmdRun(flags) {
  const prompt = str(flags.prompt);
  if (!prompt) {
    return { status: 'ERROR', error: 'missing --prompt "<text>"' };
  }

  const shared = resolveShared(flags);
  if (shared.error) return { status: 'ERROR', error: shared.error };

  const args = buildAgyArgs({ ...shared, prompt, skipPermissions: Boolean(flags['skip-permissions']) });
  if (flags['dry-run']) return { dryRun: true, argv: args };

  return executeAgy(args);
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

  const name = str(flags.name);
  const blocks = spec.blocks(out);
  if (name) blocks.push(BLOCKS.nameFile(name));
  const framing = blocks.join(' ');
  const addDirs = spec.writes ? [...new Set([...shared.addDirs, out])] : shared.addDirs;

  const args = buildAgyArgs({
    ...shared,
    prompt: framing ? `${prompt}\n\n${framing}` : prompt,
    mode: shared.mode || spec.mode,
    addDirs,
    skipPermissions: Boolean(flags['skip-permissions']) || spec.skipPermissions,
  });
  if (flags['dry-run']) return { dryRun: true, argv: args, taskType: type, outputDir: out };

  // Checked against the filesystem rather than taken from agy's prose, so a caller can
  // tell the difference between a file that was claimed and one that exists.
  const before = snapshotDir(out);
  const result = executeAgy(args);
  const changes = diffSnapshots(out, before, snapshotDir(out));

  return { ...result, taskType: type, outputDir: out, ...changes };
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
