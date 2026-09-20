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
        │   ├── task.md             # /antigravity:task — typed task (image/ui/research/code/ask)
        │   ├── rescue.md           # /antigravity:rescue — raw passthrough to Antigravity
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
User → /antigravity:task image "<task>"
     → antigravity-rescue subagent (thin forwarder, no independent work)
     → node agy-companion.mjs task --type image --prompt "<task>" --out <dir>
     → applies the type's preset: agy flags + prompt framing
     → spawns: agy -p "<framed task>" --output-format json --print-timeout 8m ...
     → agy-companion.mjs normalizes agy's JSON envelope
     → subagent returns the `response` field to the user as-is
```

Three entry points are exposed:

| Command | Purpose |
|---|---|
| `/antigravity:setup` | Checks whether `agy` is installed and authenticated; offers to install it and explains how to sign in. |
| `/antigravity:task <type> <task>` | Runs a **typed** task — `image`, `ui`, `research`, `code` or `ask` — applying the right flags, permissions and output handling for that type. |
| `/antigravity:rescue <task>` | Raw passthrough: hands `<task>` to Antigravity with no framing and returns its answer verbatim. |

### What Antigravity can actually do

Worth stating plainly, because it is not visible from `agy --help`:

- **Images: yes.** `generate_image` is an agent *tool*, not a model or a CLI flag. None of the models in `agy models` are image models — they are all text/reasoning models — so the capability is invisible until you ask the agent for it.
- **Other tools**: `search_web`, `read_url_content`, `write_to_file`, `replace_file_content`, `view_file`, `run_command`, `call_mcp_tool`, `schedule`, `manage_task`, and subagent orchestration (`define_subagent`, `invoke_subagent`, `manage_subagents`).
- **Built-in skills**: `generative_ui` (self-contained HTML artifacts), `antigravity_guide`, `agy-customizations`, `migrate-workflows`, `permissioned-github`. Slash commands such as `/plan`, `/browser` and `/boost` expand inside `agy -p` by default.
- **Headless limits**: in print mode nobody can answer a permission prompt, so some tools get denied and end the turn empty. `RunCommand` and `ReadUrlContent` are denied on a stock setup — which is exactly what the task presets work around.

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

**`task`** — applies a per-type preset (agy flags + prompt framing) and then runs:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task \
  --type <image|ui|research|code|ask> \
  --prompt "<task text>" \
  [--out <dir>] [--model <slug>] [--effort low|medium|high] [--timeout <duration>]
```

| type | what it does | agy flags added | writes files |
|---|---|---|---|
| `ask` *(default)* | general question or discussion | — | no |
| `research` | web search, answers with sources | — | no |
| `image` | generates image file(s) via `generate_image` | `--dangerously-skip-permissions`, `--add-dir <out>` | yes |
| `ui` | builds one self-contained HTML artifact | `--dangerously-skip-permissions`, `--add-dir <out>` | yes |
| `code` | edits code in place | `--mode accept-edits`, `--add-dir <out>` | yes |

`--out` defaults to the current working directory and must already exist for the three writing types. For those types the framing requires Antigravity to end its reply with the absolute path of every file it produced — headless output is useless if you cannot find it.

`code` deliberately runs on `--mode accept-edits` rather than blanket auto-approval: file edits are approved, shell commands are not, and the framing steers Antigravity to its file-editing tools instead. That makes it **edits-only** — it cannot run a build or a test loop, so a task like "run the tests and fix what fails" will be denied partway through.

**`run`** — the raw escape hatch, with no presets or framing. Returns Antigravity's own response envelope:

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
  "status": "SUCCESS",
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
- `--mode` is validated against `accept-edits|plan` by the script. `agy` only *warns* on an unknown value and then runs in the default mode, so an unvalidated typo would silently run write-enabled.
- `--effort` is dropped whenever `--model` is set. Every model slug either bakes the effort in (`gemini-3.8-flash-high`) or rejects the flag outright (`claude-sonnet-4-6`), so effort only selects a model when none is named.
- The script calls `spawnSync` without `shell: true`, so prompts containing quotes, `$`, or backticks pass through to `agy` safely.

### Success and failure

`agy`'s status enum is `SUCCESS`, `ERROR`, `CANCELLED`, `TIMEOUT`. The script always exits 0 and encodes the outcome in the JSON body, normalizing it so a caller only has to check one field:

- `status: "SUCCESS"` with a non-empty `response` → success.
- Anything else → `status` becomes `"ERROR"`, `error` explains why, and the original value is kept in `agyStatus`.

That normalization is load-bearing: **a `--print-timeout` expiry comes back from `agy` as `status: "SUCCESS"` with an empty `response`**, not as `TIMEOUT`. A run blocked by a headless permission prompt looks the same and additionally populates `denied_actions`. Without this, a dead run would be relayed as a valid empty answer.

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

### 2. Run a typed task

```
/antigravity:task image A flat illustration of a red fox reading a book
/antigravity:task ui A bar chart comparing Q1-Q4 revenue: 120, 190, 70, 240
/antigravity:task research What changed in HTTP/3 congestion control this year?
/antigravity:task code Add retry-with-backoff to the fetch helper in api.js
/antigravity:task How does this caching strategy compare to write-through?
```

The first word picks the type. Leave it out and the request is treated as `ask`.

For `image`, `ui` and `code` the output goes to the current directory unless you pass `--out <dir>`, and the reply ends with the absolute path of everything produced:

```
/antigravity:task image --out ./assets A flat illustration of a red fox
```

### 3. Or hand over a raw task

```
/antigravity:rescue Summarize the tradeoffs between these two caching strategies
/antigravity:rescue --model claude-sonnet-4-6 Review this module for race conditions
```

Either command forwards to the `antigravity-rescue` subagent, which makes exactly one call into `agy-companion.mjs` and returns Antigravity's `response` field verbatim — no added commentary, except when `agy` is unavailable/unauthenticated (in which case it tells you to run `/antigravity:setup`) or the run fails (in which case it reports the `error` field plainly, without retrying or inventing a result).

`--type`, `--out`, `--model`, `--effort` and `--timeout` are routing flags, not part of the task text — they're stripped out before the prompt is sent to Antigravity and passed through separately.

## Design notes

- **Thin forwarding, not a smart wrapper.** The `antigravity-rescue` subagent does no independent investigation (no reading files, no grepping) — its only job is to shape one `agy-companion.mjs` call and relay the result. This keeps behavior predictable and keeps Antigravity's output from being paraphrased or second-guessed.
- **JSON-only stdout contract.** `agy-companion.mjs` never mixes log lines into stdout; every invocation produces exactly one JSON object. This is what lets the subagent/command layer parse results without fragile string-matching.
- **Auth checks never hang.** Verifying sign-in status uses `agy models` (fails fast) instead of `agy -p` (which can silently open a browser and block for up to a minute).
- **Task types are data, not logic.** The presets live in one table in `agy-companion.mjs`, so adding a type is a data edit rather than a change to the command or agent prompts. The Claude-side layer stays a dumb forwarder.
- **Least privilege per type.** Only the types that genuinely need unattended tool approval get it. `code` runs on `--mode accept-edits` and is steered to file-editing tools instead, and `research` is steered to search results instead of URL fetching — both avoid blanket `--dangerously-skip-permissions`.

## Versioning

Both the marketplace and the `antigravity` plugin are currently at `0.1.0`. See `.claude-plugin/marketplace.json` and `plugins/antigravity/.claude-plugin/plugin.json`.

## License

No license file has been added yet — all rights reserved by default. Add a `LICENSE` file if you intend to allow reuse.
