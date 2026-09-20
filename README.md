# antigravity-plugin-cc

A [Claude Code](https://claude.com/claude-code) plugin marketplace that adds an **Antigravity (`agy`) CLI** integration. It lets Claude Code delegate a task to the [Antigravity](https://antigravity.google/) headless runtime — for a second opinion, an offloaded implementation, or research the main Claude thread doesn't need to burn its own context on — and bring the result back into the conversation.

## What's in this repo

This repo is a **plugin marketplace** (`.claude-plugin/marketplace.json`) containing one plugin, `antigravity`, at `plugins/antigravity/`.

```
.
├── .claude-plugin/
│   └── marketplace.json          # marketplace manifest (lists the "antigravity" plugin)
└── plugins/
    └── antigravity/
        ├── .claude-plugin/
        │   └── plugin.json        # plugin manifest (name, version, description)
        ├── agents/
        │   └── antigravity-rescue.md   # subagent: thin forwarder to the agy runtime
        ├── commands/
        │   ├── rescue.md           # /antigravity:rescue — delegate a task to Antigravity
        │   └── setup.md            # /antigravity:setup — check/install/auth the agy CLI
        ├── scripts/
        │   └── agy-companion.mjs   # Node helper that actually shells out to `agy`
        └── skills/
            └── antigravity-cli-runtime/
                └── SKILL.md        # internal contract docs for agy-companion.mjs
```

## How it works

Claude Code never calls the `agy` binary directly. Everything goes through **`agy-companion.mjs`**, a small Node script that wraps `agy` and always prints exactly one JSON object to stdout (never a mix of exit codes and free-form text), so Claude can parse the result reliably.

```
User → /antigravity:rescue "<task>"
     → antigravity-rescue subagent (thin forwarder, no independent work)
     → node agy-companion.mjs run --prompt "<task>"
     → spawns: agy -p "<task>" --output-format json --print-timeout 8m
     → agy-companion.mjs re-emits agy's JSON envelope verbatim
     → subagent returns the `response` field to the user as-is
```

Two entry points are exposed:

| Command | Purpose |
|---|---|
| `/antigravity:setup` | Checks whether `agy` is installed and authenticated; offers to install it and explains how to sign in. |
| `/antigravity:rescue [--model <slug>] [--effort low\|medium\|high] <task>` | Hands `<task>` off to Antigravity via the `antigravity-rescue` subagent and returns its answer verbatim. |

### `agy-companion.mjs` commands

**`setup`** — probes the environment and reports readiness:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup
```

```json
{
  "ready": true,
  "agy": { "available": true, "detail": "1.2.7" },
  "auth": { "loggedIn": true, "detail": "signed in" },
  "nextSteps": []
}
```

It checks auth with `agy models` rather than `agy -p`, because `agy -p` triggers an interactive OAuth browser flow and can hang for up to 60 seconds — `agy models` fails fast with a clear "please sign in" message instead.

**`run`** — executes a task and returns Antigravity's own response envelope:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" run \
  --prompt "<task text>" \
  [--model <slug>] \
  [--effort low|medium|high] \
  [--agent <name>] \
  [--timeout <duration>] \
  [--skip-permissions]
```

```json
{
  "conversation_id": "...",
  "status": "OK",
  "response": "...",
  "error": "",
  "duration_seconds": 12.4,
  "num_turns": 3,
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "thinking_tokens": 0,
    "cache_read_tokens": 0,
    "total_tokens": 0
  }
}
```

- `--timeout` maps to `agy`'s `--print-timeout` and defaults to `8m`, so a stuck run can't hang the plugin indefinitely.
- `--skip-permissions` maps to `agy`'s `--dangerously-skip-permissions` — only used when explicitly requested, since it grants unattended tool approval.
- The script calls `spawnSync` without `shell: true`, so prompts containing quotes, `$`, or backticks pass through to `agy` safely.
- On failure, `status` is `"ERROR"` with a human-readable `error` field — the script always exits 0 and encodes success/failure in the JSON body, not the process exit code.

## Prerequisites

- [Claude Code](https://claude.com/claude-code) with plugin support.
- [Node.js](https://nodejs.org/) available on `PATH` (used to run `agy-companion.mjs`).
- The [Antigravity CLI](https://antigravity.google/docs/cli/install/) (`agy`), installed and authenticated. `/antigravity:setup` will detect whether this is done and guide you through it if not.

## Installation

Add this repo as a plugin marketplace, then install the `antigravity` plugin from it.

**From a local clone:**

```
/plugin marketplace add /path/to/antigravity-plugin-cc
/plugin install antigravity@antigravity-plugin-cc
```

**Directly from GitHub:**

```
/plugin marketplace add nattapatpsw-Game/antigravity-plugin-cc
/plugin install antigravity@antigravity-plugin-cc
```

After installing, enable the plugin (Claude Code will prompt you, or set it explicitly in `~/.claude/settings.json`):

```json
{
  "enabledPlugins": {
    "antigravity@antigravity-plugin-cc": true
  }
}
```

## Usage

### 1. Check readiness

```
/antigravity:setup
```

This reports whether `agy` is installed and signed in, and:

- If `agy` is missing, it asks (once, via `AskUserQuestion`) whether to install it, then gives you the official installer command for your platform:
  - macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
  - Windows (PowerShell): `irm https://antigravity.google/cli/install.ps1 | iex`
  - Windows (cmd): `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd`
- If `agy` is installed but not signed in, it tells you to run `agy` with no arguments **in a terminal outside Claude Code** (sign-in opens a browser for OAuth and can't be driven through Claude Code's shell tool). For headless/CI auth, set `GEMINI_API_KEY` and add `{"modelProvider": "gemini"}` to `~/.gemini/antigravity-cli/settings.json` instead.

### 2. Delegate a task

```
/antigravity:rescue Summarize the tradeoffs between these two caching strategies
/antigravity:rescue --effort high --model <slug> Do a deep review of this module for race conditions
```

The command forwards your request to the `antigravity-rescue` subagent, which makes exactly one call into `agy-companion.mjs` and returns Antigravity's `response` field verbatim — no added commentary, except when `agy` is unavailable/unauthenticated (in which case it tells you to run `/antigravity:setup`) or the run errors out (in which case it reports the `error` field plainly, without retrying or inventing a result).

`--model` and `--effort` are routing flags, not part of the task text — they're stripped out before being sent to Antigravity as the prompt and passed through separately.

## Design notes

- **Thin forwarding, not a smart wrapper.** The `antigravity-rescue` subagent does no independent investigation (no reading files, no grepping) — its only job is to shape one `agy-companion.mjs` call and relay the result. This keeps behavior predictable and keeps Antigravity's output from being paraphrased or second-guessed.
- **JSON-only stdout contract.** `agy-companion.mjs` never mixes log lines into stdout; every invocation produces exactly one JSON object. This is what lets the subagent/command layer parse results without fragile string-matching.
- **Auth checks never hang.** Verifying sign-in status uses `agy models` (fails fast) instead of `agy -p` (which can silently open a browser and block for up to a minute).

## Versioning

Both the marketplace and the `antigravity` plugin are currently at `0.1.0`. See `.claude-plugin/marketplace.json` and `plugins/antigravity/.claude-plugin/plugin.json`.

## License

No license file has been added yet — all rights reserved by default. Add a `LICENSE` file if you intend to allow reuse.
