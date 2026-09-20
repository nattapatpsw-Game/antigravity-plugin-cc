# antigravity-plugin-cc

A [Claude Code](https://claude.com/claude-code) plugin that lets you hand a task to Google's [Antigravity](https://antigravity.google/) agent (`agy`) without leaving your Claude Code session — and get the result back inline.

Useful when you want a second opinion from a different model, want to offload work that would otherwise fill up Claude's context, or want something Claude Code can't do itself, such as **generating an image**.

```
/antigravity:task image A flat illustration of a red fox reading a book
→ C:\Users\you\project\red_fox_reading.jpg
```

---

## Table of contents

- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Commands](#commands)
- [Task types](#task-types)
- [How the type is chosen](#how-the-type-is-chosen)
- [Refining a result](#refining-a-result)
- [Where output goes](#where-output-goes)
- [Choosing a model](#choosing-a-model)
- [What Antigravity can actually do](#what-antigravity-can-actually-do)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [`agy-companion.mjs` reference](#agy-companionmjs-reference)
- [Success and failure](#success-and-failure)
- [Tests](#tests)
- [Design notes](#design-notes)
- [Repo layout](#repo-layout)

---

## Quick start

```
/plugin marketplace add nattapatpsw-Game/antigravity-plugin-cc
/plugin install antigravity@antigravity-plugin-cc
/antigravity:setup
```

Once setup reports `ready: true`:

```
/antigravity:task image A watercolour of a lighthouse at dawn
/antigravity:task ui A bar chart of Q1-Q4 revenue: 120, 80, 400, 854
/antigravity:task code Add retry-with-backoff to the fetch helper in api.js
/antigravity:task How does write-through caching compare to write-back?
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| [Claude Code](https://claude.com/claude-code) | With plugin support. |
| [Node.js](https://nodejs.org/) on `PATH` | Runs `agy-companion.mjs`. No npm packages required — the script has zero dependencies. |
| [Antigravity CLI](https://antigravity.google/docs/cli/install/) (`agy`) | Installed **and signed in**. `/antigravity:setup` checks both and walks you through whatever is missing. |

---

## Installation

Add this repo as a plugin marketplace, then install the plugin from it.

**From GitHub:**

```
/plugin marketplace add nattapatpsw-Game/antigravity-plugin-cc
/plugin install antigravity@antigravity-plugin-cc
```

**From a local clone** (useful if you're modifying the plugin):

```
/plugin marketplace add /path/to/antigravity-plugin-cc
/plugin install antigravity@antigravity-plugin-cc
```

Claude Code will prompt you to enable it. You can also set it directly in `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "antigravity@antigravity-plugin-cc": true
  }
}
```

### Installing and signing in to `agy`

`/antigravity:setup` reports what's missing and how to fix it.

**If `agy` isn't installed**, it offers the official installer for your platform:

| Platform | Command |
|---|---|
| macOS / Linux | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` |
| Windows (PowerShell) | `irm https://antigravity.google/cli/install.ps1 \| iex` |
| Windows (cmd) | `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd` |

**If `agy` is installed but not signed in**, run `agy` with no arguments **in a normal terminal, outside Claude Code**. Sign-in opens a browser for OAuth, which can't be driven through Claude Code's shell tool.

For headless or CI environments, set `GEMINI_API_KEY` and add `{"modelProvider": "gemini"}` to `~/.gemini/antigravity-cli/settings.json` instead.

---

## Commands

| Command | What it does |
|---|---|
| `/antigravity:setup` | Checks that `agy` is installed and authenticated. Offers to install it, explains how to sign in, and lists the available task types. |
| `/antigravity:task [type] <task>` | Runs a task with the right flags, permissions and output handling for its kind. The main entry point. |
| `/antigravity:rescue <task>` | Raw passthrough — hands the task to Antigravity with no framing at all. Use when a preset gets in your way. |

---

## Task types

There are four. Each one applies its own `agy` flags and its own prompt framing.

### `image` — generate a picture

```
/antigravity:task image A flat illustration of an orange cat asleep on a tiled roof
```

Uses Antigravity's `generate_image` tool and saves a real image file (JPG/PNG). The reply ends with the file's absolute path.

### `ui` — build a chart, dashboard or diagram

```
/antigravity:task ui A bar chart of quarterly sales: Q1 120, Q2 80, Q3 400, Q4 854
```

Produces **one self-contained HTML file** that works with no network connection — all CSS and JavaScript inlined, charts drawn with inline SVG or canvas, system fonts only. Open it straight in a browser.

### `code` — write or edit code

```
/antigravity:task code Add a retry-with-backoff wrapper around the fetch helper in api.js
```

Edits files in place under `--out` (default: current directory). **Edits-only** — see [the permissions note](#a-note-on-permissions) below.

### `ask` — everything else

```
/antigravity:task How does write-through caching compare to write-back?
/antigravity:task Write a note.md summarising the three options we discussed
```

Answers questions in prose. **It also creates files when you ask it to** — it isn't read-only. A plain question writes nothing.

### A note on permissions

In headless mode nobody can click "approve", so each type gets the minimum permission it actually needs:

| type | `agy` flags | Can create/edit files | Can run shell commands |
|---|---|---|---|
| `ask` | `--mode accept-edits` | yes | no |
| `code` | `--mode accept-edits` | yes | no |
| `image` | `--dangerously-skip-permissions` | yes | yes |
| `ui` | `--dangerously-skip-permissions` | yes | yes |

`ask` and `code` stay on `accept-edits` because that turns out to be enough for creating and editing files, while leaving shell commands denied. The practical consequence: **`code` cannot run a build or a test loop.** A task like "run the tests and fix what fails" will be denied partway through.

`image` and `ui` need the blanket flag because those runs reach for `RunCommand`, which `accept-edits` does not cover.

---

## How the type is chosen

**1. If you name it, that wins.** Start the request with `image`, `ui`, `code` or `ask`:

```
/antigravity:task ui  a pie chart of these three numbers
```

**2. If you don't name one, it's inferred from what you asked for:**

| You asked for | Inferred type |
|---|---|
| a picture, illustration, drawing, photo | `image` |
| a chart, graph, dashboard, diagram, widget | `ui` |
| code written, edited, refactored, fixed | `code` |
| anything else | `ask` |

This matters if you don't work in English. A Thai request like `สร้างรูปแมวส้ม` has no leading English type word, and without inference it would fall back to `ask` — producing a written *description* of a cat picture and no actual file. When the type is inferred rather than typed, the reply tells you which one was picked, so you can correct it.

**3. A leading type word that's really part of the task is left alone.**

```
/antigravity:task image processing library ไหนดี
```

Here `image` is the subject, not routing — the rest ("processing library ไหนดี") doesn't stand on its own as a task. This is treated as a question about libraries, not a request to generate an image named "processing library ไหนดี".

---

## Refining a result

You don't have to restate a task to change it. Every result carries the Antigravity conversation it came from, so a follow-up picks up where the last one left off:

```
/antigravity:task image A flat illustration of a green triangle on white
→ ...\green_triangle.jpg

/antigravity:task make it purple instead
→ ...\purple_triangle.jpg
```

The second request never mentions a triangle. Antigravity still has the first turn's context, so it keeps the composition and changes only what you asked for. The same works for `ui` ("same chart but monthly"), `code` ("now add a test for it") and `ask` ("shorter").

Every answer ends with a line showing which conversation it belongs to and how long the run took:

```
[agy conversation: bab277a7-33cb-459b-86f3-4d92b31b4557 · 3.5s]
```

Token counts are deliberately left out: Antigravity's total is dominated by its own system prompt, so even a one-word answer reports five figures. That reads as alarming while saying nothing useful about your task. The raw `usage` object is still in the JSON if you want it.

Under the hood this resumes a specific conversation by id — never "the most recent conversation", which would attach to whatever you last ran in the Antigravity IDE or to a task running in parallel.

## Where output goes

Output lands in the **current working directory** unless you pass `--out`:

```
/antigravity:task image --out ./assets A flat illustration of a red fox
```

The directory must already exist — the plugin won't create it, and will tell you so rather than failing deep inside `agy`.

Every reply that produces files ends with their absolute paths. This is deliberate: in headless mode there's no file tree to click through, so a path you can copy is the only way to find the output.

Those paths are also **checked against the filesystem**, not just taken from what Antigravity says. The plugin lists the output directory before and after each run and reports what actually appeared or changed. If the reply claims a file that isn't there, you're told — which matters because image generation does occasionally fail a turn, and a confident-sounding reply is not evidence.

---

## Choosing a model

Leave `--model` unset and `agy` uses its configured default. To override:

```
/antigravity:task --model claude-sonnet-4-6 code Refactor this parser
```

Models available on a stock install (`agy models`):

| Family | Slugs |
|---|---|
| Gemini Flash | `gemini-3.8-flash-high` / `-medium` / `-low`, plus `3.7` and `3.6` variants |
| Gemini Pro | `gemini-3.1-pro-high`, `gemini-3.1-pro-low` |
| Claude | `claude-sonnet-4-6`, `claude-opus-4-6-thinking` |
| Open weights | `gpt-oss-120b-medium` |

**`--effort` is ignored whenever `--model` is set.** Every slug either bakes the effort level into its name (`gemini-3.8-flash-high`) or rejects the flag outright — `claude-sonnet-4-6` errors with `--effort is not supported for model`. Effort only picks a model when you haven't named one.

---

## What Antigravity can actually do

Worth stating plainly, because none of it is visible from `agy --help`:

**Images: yes.** `generate_image` is an agent *tool*, not a model or a CLI flag. Every entry in `agy models` is a text/reasoning model, so the capability is invisible until you simply ask the agent for a picture.

**Other tools:** `search_web`, `read_url_content`, `write_to_file`, `replace_file_content`, `view_file`, `run_command`, `call_mcp_tool`, `schedule`, `manage_task`, and subagent orchestration (`define_subagent`, `invoke_subagent`, `manage_subagents`).

**Built-in skills:** `generative_ui` (rich HTML artifacts), `antigravity_guide`, `agy-customizations`, `migrate-workflows`, `permissioned-github`. Antigravity's own slash commands — `/plan`, `/browser`, `/boost`, `/goal`, `/learn`, `/schedule` — expand inside `agy -p` by default, so you can pass them through `/antigravity:rescue`.

**MCP:** `agy` runs its own MCP servers, managed with `agy mcp add|list|remove`, separately from Claude Code's.

**Headless limits.** In print mode there's nobody to answer a permission prompt, so a denied tool call ends the turn with an empty response. Two denials show up on a stock setup:

- `RunCommand` — any shell command, unless the type passes `--dangerously-skip-permissions`.
- `ReadUrlContent` — fetching a specific web page. Web *search* still works; opening the resulting URLs does not.

The type presets are built around these limits rather than pretending they don't exist.

---

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| `agy ended the turn with no answer because these actions were denied in headless mode: RunCommand` | The task tried to run a shell command under a type that doesn't allow it. | Use `image`/`ui`, or do that step yourself in Claude Code. |
| `...denied in headless mode: ReadUrlContent` | The task tried to open a specific URL. | Ask for a web *search* instead, or fetch the page yourself and paste it in. |
| `agy returned an empty response — the run most likely hit --print-timeout` | The run genuinely ran out of time, and nothing was denied. | Retry with a longer `--timeout` (default `8m`). |
| `--out directory does not exist: ...` | The output directory isn't there. | Create it first, or drop `--out` to use the current directory. |
| `invalid --mode "..."` / `invalid --effort "..."` | Bad flag value, caught before `agy` runs. | Use `accept-edits\|plan`, or `low\|medium\|high`. |
| `unknown --type "..."` | Not one of the four types. | Use `image`, `ui`, `code` or `ask`. |
| Setup says not signed in | OAuth hasn't been completed. | Run `agy` in a terminal **outside** Claude Code. |
| A `ui` artifact renders blank | An older artifact that pulled a CDN. | Regenerate it — the current preset bans remote resources. |

---

## How it works

Claude Code never calls the `agy` binary directly. Everything goes through **`agy-companion.mjs`**, a dependency-free Node script that wraps `agy` and always prints exactly one JSON object to stdout — never a mix of exit codes and free-form text — so Claude can parse the result without string-matching.

```
User → /antigravity:task image "<task>"
     → antigravity-rescue subagent (thin forwarder, no independent work)
     → node agy-companion.mjs task --type image --prompt "<task>" --out <dir>
     → applies the type's preset: agy flags + prompt framing
     → spawns: agy -p "<framed task>" --output-format json --print-timeout 8m ...
     → agy-companion.mjs normalizes agy's JSON envelope
     → subagent returns the `response` field to the user as-is
```

The subagent does no investigation of its own — no reading files, no grepping. Its only job is to shape one call and relay the answer verbatim, so Antigravity's output is never paraphrased or second-guessed.

---

## `agy-companion.mjs` reference

### `setup`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup
```

```json
{
  "ready": true,
  "agy": { "available": true, "detail": "1.2.7" },
  "auth": { "loggedIn": true, "detail": "signed in" },
  "nextSteps": [],
  "taskTypes": { "ask": { "description": "...", "writes": true } }
}
```

Auth is checked with `agy models`, not `agy -p`. `agy -p` triggers an interactive OAuth browser flow and can hang for up to a minute; `agy models` fails fast with a clear "please sign in" message.

### `task`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task \
  --type <image|ui|code|ask> \
  --prompt "<task text>" \
  [--out <dir>] [--conversation <id>] \
  [--model <slug>] [--effort low|medium|high] [--timeout <duration>] [--dry-run]
```

Applies the type's preset — `agy` flags plus prompt framing — and runs. `--type` defaults to `ask`.

A run that reaches `agy` returns Antigravity's envelope plus four fields of its own: `taskType`, `outputDir`, and `filesCreated` / `filesModified`. A request rejected during validation — unknown type, missing prompt, bad `--mode`, missing `--out` — returns only `status` and `error`.

`filesCreated` and `filesModified` come from listing `--out` before and after the run and comparing names and mtimes. The scan is **shallow** — for a `code` task `--out` can be a whole repository, and walking it every time would cost more than it catches — so writes into subdirectories aren't reported.

The `ui` preset bans remote resources item by item rather than just asking for a "self-contained" file. Antigravity's `generative_ui` skill points at a Tailwind CDN, and left to itself it reads "self-contained" as "one file" — then pulls in Chart.js and Google Fonts, producing an artifact that renders blank offline.

### `run`

The raw escape hatch: no presets, no framing.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" run \
  --prompt "<task text>" \
  [--conversation <id>] [--model <slug>] [--effort low|medium|high] \
  [--mode accept-edits|plan] [--add-dir <dir>] \
  [--timeout <duration>] [--skip-permissions] [--dry-run]
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

Flag behaviour:

- **`--timeout`** maps to `agy`'s `--print-timeout` and defaults to `8m`. `agy`'s own default is `0s`, meaning "wait forever" — the plugin always passes a limit so a stuck run can't hang indefinitely.
- **`--mode`** is validated against `accept-edits|plan` *by the script*. `agy` only prints a warning for an unknown value and then runs in the default mode, so an unvalidated typo would silently run write-enabled.
- **`--effort`** is dropped whenever `--model` is set. See [Choosing a model](#choosing-a-model).
- **`--add-dir`** is repeatable, and is what lets `agy` write outside its default workspace.
- **`--skip-permissions`** maps to `--dangerously-skip-permissions`. Grants unattended tool approval, so it's only set where a preset genuinely needs it.
- **`--conversation`** resumes a specific conversation by id. The script never emits `agy`'s bare `-c`/`--continue`, which means "most recent conversation on this machine" and would attach to the Antigravity IDE or a parallel task.
- **`--dry-run`** returns the argv that *would* be passed to `agy` instead of spawning it — the cheap way to see what a preset actually does.
- There is deliberately **no `--agent` passthrough**. `agy agents` returns an empty list on a stock install, so the flag could never do anything useful.
- Prompts are passed with `spawnSync` **without** `shell: true`, so quotes, `$` and backticks in a prompt reach `agy` intact and can't be reinterpreted by a shell.

### `types`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" types
```

Lists the task types and whether each writes files. Never invokes `agy`.

---

## Success and failure

`agy` always exits 0 and reports the outcome in the JSON body, so the exit code tells you nothing. Its status enum is `SUCCESS`, `ERROR`, `CANCELLED`, `TIMEOUT`.

The script normalizes all of that down to one question — is `status` `"ERROR"`?

- `status: "SUCCESS"` **with a non-empty `response`** → success.
- Anything else → `status` becomes `"ERROR"`, `error` explains why, and the original value is preserved in `agyStatus`.

That normalization is load-bearing, because of one surprising behaviour: **a `--print-timeout` expiry comes back as `status: "SUCCESS"` with an empty `response`**, not as `TIMEOUT`. Without normalization, a run that died would be relayed to you as a valid empty answer.

A run blocked by a headless permission prompt looks identical from the outside, except that it also populates `denied_actions`. The script checks that list **first** and names the blocked tools — so an empty response is only blamed on a timeout when nothing was actually denied.

---

## Tests

```bash
node test/smoke.mjs
```

Plain Node, no dependencies, and **no `agy` invocations** — it runs anywhere in under a second, with no CLI install, auth or network. It covers the validation layer (every error string), the flag-building logic (`--effort` dropped when `--model` is set, `--conversation` forwarded, `-c`/`--continue` never emitted) and the per-type presets (`image`/`ui` carry unattended approval, `ask`/`code` don't). Exits non-zero on failure.

It can't cover what only a live run shows — whether a preset's *wording* actually gets Antigravity to do the right thing. For that, run the real commands.

## Design notes

- **Thin forwarding, not a smart wrapper.** The subagent shapes one call and relays the result. Nothing in between reinterprets Antigravity's answer.
- **JSON-only stdout contract.** Every invocation produces exactly one JSON object, so parsing never depends on scraping text.
- **Task types are data, not logic.** The presets live in one table in `agy-companion.mjs`. Adding a type is a data edit, not a change to any prompt.
- **Least privilege per type.** Only the types that genuinely need unattended tool approval get it — verified by testing, not assumed.
- **Auth checks never hang.** Sign-in status is probed with a command that fails fast instead of one that can open a browser.
- **Fail loudly, not quietly.** Where `agy` fails open — an unknown `--mode`, a timeout dressed up as success — the plugin converts it into an explicit error.
- **Check, don't trust.** Output paths are verified against the filesystem rather than read out of Antigravity's prose, so a claimed file and a real one are never confused.

---

## Repo layout

This repo is a **plugin marketplace** containing one plugin, `antigravity`.

```
.
├── LICENSE                            # MIT
├── .claude-plugin/
│   └── marketplace.json               # marketplace manifest
├── test/
│   └── smoke.mjs                      # offline test suite — never calls `agy`
└── plugins/
    └── antigravity/
        ├── .claude-plugin/
        │   └── plugin.json            # plugin manifest
        ├── agents/
        │   └── antigravity-rescue.md  # subagent: thin forwarder to the agy runtime
        ├── commands/
        │   ├── task.md                # /antigravity:task
        │   ├── rescue.md              # /antigravity:rescue
        │   └── setup.md               # /antigravity:setup
        ├── scripts/
        │   └── agy-companion.mjs      # the only thing that talks to `agy`
        └── skills/
            └── antigravity-cli-runtime/
                └── SKILL.md           # internal contract docs for the script
```

## Versioning

Marketplace and plugin are both at `0.3.0`. See `.claude-plugin/marketplace.json` and `plugins/antigravity/.claude-plugin/plugin.json`.

- **0.3.0** — MIT license, run duration and conversation id reported with every answer, dead `--agent` flag removed.
- **0.2.0** — follow-up conversations, filesystem-verified output, offline test suite. Also covered the removal of the `research` task type, a breaking change that had shipped under `0.1.1`.

## License

[MIT](LICENSE) — free to use, modify and redistribute, including commercially. The only condition is that the copyright notice travels with it.

It is provided **as is, with no warranty and no liability**, which is worth reading literally: the `image` and `ui` task types run Antigravity with unattended tool approval on your machine. That is what makes them work headlessly, and it means you are trusting Antigravity with whatever `--out` points at.

Not affiliated with or endorsed by Google. "Antigravity" and `agy` are Google's; this is an independent plugin that talks to their CLI, and installing it grants you no rights to Antigravity itself.
