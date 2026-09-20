---
name: antigravity-cli-runtime
description: Internal helper contract for calling the agy-companion runtime from Claude Code
---

# Antigravity CLI runtime contract

The `agy-companion.mjs` script is the only supported way this plugin talks to the Antigravity (`agy`) CLI. It always prints one JSON object to stdout and exits 0, even on failure — check the JSON body, not the exit code, for success/failure.

## Commands

### `setup`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup
```

Returns:

```json
{
  "ready": true,
  "agy": { "available": true, "detail": "1.2.7" },
  "auth": { "loggedIn": true, "detail": "signed in" },
  "nextSteps": [],
  "taskTypes": { "ask": { "description": "...", "writes": false } }
}
```

Checks authentication via `agy models` (fails fast with a clear message when signed out) rather than `agy -p`, which launches an interactive OAuth browser flow and hangs for up to 60 seconds. Never invoke `agy -p` just to probe auth state.

### `task`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task --type <image|ui|code|ask> --prompt "<task text>" [--out <dir>] [--conversation <id>] [--model <slug>] [--effort low|medium|high] [--timeout <duration>] [--dry-run]
```

Applies a per-type preset — agy flags plus prompt framing — on top of the `run` path. `--type` defaults to `ask`. A run that reaches agy returns agy's envelope plus `taskType`, `outputDir`, `filesCreated` and `filesModified`; a request rejected during validation returns only `status` and `error`.

| type | agy flags | framing | writes |
|---|---|---|---|
| `ask` | `--mode accept-edits`, `--add-dir <out>` | answer directly; if asked for a file, write it into `<out>` with file tools only and end with absolute paths | if asked |
| `image` | `--dangerously-skip-permissions`, `--add-dir <out>` | use `generate_image`, save to `<out>`, end with absolute paths | yes |
| `ui` | `--dangerously-skip-permissions`, `--add-dir <out>` | one HTML file in `<out>` with no network dependencies at all, end with absolute paths | yes |
| `code` | `--mode accept-edits`, `--add-dir <out>` | file-editing tools only, no shell, list changed files | yes |

`--out` defaults to the current working directory and must already exist.

`ask` and `code` stay on `accept-edits` rather than blanket auto-approval: that is enough for `write_to_file` to create new files (verified), while shell commands remain denied. `image` genuinely needs the blanket flag — `generate_image` reaches for `RunCommand`, which `accept-edits` does not cover.

### Output verification

`filesCreated` and `filesModified` come from comparing a listing of `--out` taken before the run with one taken after, by filename and mtime. They describe what is on disk, not what agy said it did, so they outrank the response text — a run that claims a file and reports an empty `filesCreated` produced nothing.

The scan is **shallow and non-recursive**. For a `code` task `--out` can be an entire repository, and walking it on every run would cost far more than it catches, so writes into subdirectories are not reported.

### The `metaLine` field

Every run that reaches agy also returns `metaLine`, a ready-formatted string:

```
[agy conversation: bab277a7-33cb-459b-86f3-4d92b31b4557 · 3.5s]
```

Append it verbatim as the final line of the answer. It is built in the script rather than composed by the caller, so the forwarding layer never has to format anything and the shape stays consistent. It carries the id needed to resume the conversation and the wall time the run took.

Token counts are deliberately excluded. agy's total is dominated by its own system prompt — a one-word answer still reports five figures — so it looks alarming while saying nothing about the task, and it only maps to money for `GEMINI_API_KEY` users rather than the default account auth. The raw `usage` object remains in the JSON for anyone who wants it.

### Follow-up conversations

Pass `--conversation <id>`, taken from an earlier result's `conversation_id` or its `metaLine`, to resume that conversation. Verified: a resumed turn keeps the earlier context, still honours `--add-dir` and `--dangerously-skip-permissions`, and can write files — a resumed `image` task asked only to "change the colour" reproduced the previous composition.

Never use agy's `-c`/`--continue`. It means "the most recent conversation on this machine", which will silently attach to a conversation started in the Antigravity IDE or by a task running in parallel. The script only ever emits an explicit `--conversation <id>`.

### `run`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" run --prompt "<task text>" [--conversation <id>] [--model <slug>] [--effort low|medium|high] [--mode accept-edits|plan] [--add-dir <dir>] [--timeout <duration>] [--skip-permissions] [--dry-run]
```

The raw escape hatch — no presets, no framing. Runs `agy -p "<task text>" --output-format json` and re-emits agy's own JSON envelope:

```json
{
  "conversation_id": "...",
  "status": "SUCCESS",
  "response": "...",
  "error": "",
  "duration_seconds": 12.4,
  "num_turns": 3,
  "usage": { "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cache_read_tokens": 0, "total_tokens": 0 }
}
```

### `types`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" types
```

Lists the task types and whether each writes files. No agy invocation.

## Outcome handling

agy's status enum is `SUCCESS`, `ERROR`, `CANCELLED`, `TIMEOUT` — **not** `OK`. The script normalizes every outcome so callers only ever need to check one thing:

- `status: "SUCCESS"` with a non-empty `response` → success.
- Anything else → `status` is rewritten to `"ERROR"`, `error` carries the reason, and the original value is preserved in `agyStatus`.

The case that forces this: **a `--print-timeout` expiry is reported by agy as `status: "SUCCESS"` with an empty `response`**, not as `TIMEOUT`. Without normalization a timed-out run would be relayed as a valid empty answer.

A run blocked by a headless permission denial looks identical, except that it also populates `denied_actions`. The script checks that list first and names the blocked tools in `error`, so the two are never confused — an empty response is only attributed to a timeout when nothing was denied.

## Flag rules

- `--timeout` maps to agy's own `--print-timeout` and defaults to `8m` — always pass one so a stuck run cannot hang past this plugin's control.
- `--mode` is validated against `accept-edits|plan` **by this script**. agy only prints `warning: unrecognized --mode value` for a bad value and then runs in the default mode, so an unvalidated typo would silently run write-enabled.
- `--effort` is dropped whenever `--model` is set. Every agy model slug either bakes the effort in (`gemini-3.8-flash-high`) or rejects the flag outright (`claude-sonnet-4-6` → `--effort is not supported for model`). Effort only selects a model when no model is named.
- `--skip-permissions` maps to agy's `--dangerously-skip-permissions`; only the `image` and `ui` presets set it, because those runs reach for `RunCommand`, which `accept-edits` does not cover.
- `--add-dir` is repeatable and is what allows agy to write outside its default workspace.
- `--dry-run` returns the argv that would be passed to agy instead of spawning it. Nothing runs, so it is the cheap way to check what a preset actually does.

## Headless permission limits

In print mode nobody can answer a permission prompt, so denied tool calls end the turn with an empty response and a `denied_actions` list. Observed denials: `RunCommand` and `ReadUrlContent`. This is why the `ask` and `code` presets explicitly steer agy to its file tools and away from the shell rather than relying on it to guess.

The `ui` preset carries a related workaround for a different reason: the built-in `generative_ui` skill tells agy to load Tailwind from a gstatic CDN, which is fine inside the Antigravity app but produces a file that renders blank offline. Asking for a "self-contained" file is not enough — agy reads that as "one file" and still pulls Chart.js and Google Fonts. The preset therefore bans remote resources item by item and asks agy to re-check the file before finishing.

## Notes

- The script always writes a bare JSON object with `console.log` — no other stdout noise. If a caller sees anything else on stdout, something upstream is broken.
- The script never needs a shell (`spawnSync` is called without `shell: true`), so prompts containing quotes, `$`, or backticks pass through safely.
- There is deliberately no `--agent` passthrough. `agy agents` returns an empty list on a stock install, so the flag could never do anything useful.
