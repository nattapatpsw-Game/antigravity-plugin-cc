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
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task --type <image|ui|research|code|ask> --prompt "<task text>" [--out <dir>] [--model <slug>] [--effort low|medium|high] [--timeout <duration>]
```

Applies a per-type preset — agy flags plus prompt framing — on top of the `run` path. `--type` defaults to `ask`. The result is agy's envelope plus `taskType` and `outputDir`.

| type | agy flags | framing | writes |
|---|---|---|---|
| `ask` | — | — | no |
| `research` | — | search-only; no URL fetching, no shell, no files | no |
| `image` | `--dangerously-skip-permissions`, `--add-dir <out>` | use `generate_image`, save to `<out>`, end with absolute paths | yes |
| `ui` | `--dangerously-skip-permissions`, `--add-dir <out>` | one HTML file in `<out>` with no network dependencies at all, end with absolute paths | yes |
| `code` | `--mode accept-edits`, `--add-dir <out>` | file-editing tools only, no shell, list changed files | yes |

`--out` defaults to the current working directory and must already exist for the three writing types.

### `run`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" run --prompt "<task text>" [--model <slug>] [--effort low|medium|high] [--agent <name>] [--mode accept-edits|plan] [--add-dir <dir>] [--timeout <duration>] [--skip-permissions]
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
- `--skip-permissions` maps to agy's `--dangerously-skip-permissions`; the `image` and `ui` presets set it because `generate_image` and `write_to_file` are not edit-gated. `code` deliberately does not — `--mode accept-edits` covers file edits, and its framing steers agy away from shell commands.
- `--add-dir` is repeatable and is what allows agy to write outside its default workspace.

## Headless permission limits

In print mode nobody can answer a permission prompt, so denied tool calls end the turn with an empty response and a `denied_actions` list. Observed denials: `RunCommand` and `ReadUrlContent`. This is why the `code` and `research` presets explicitly steer agy away from those tools in their framing rather than relying on it to guess.

The `ui` preset carries a related workaround for a different reason: the built-in `generative_ui` skill tells agy to load Tailwind from a gstatic CDN, which is fine inside the Antigravity app but produces a file that renders blank offline. Asking for a "self-contained" file is not enough — agy reads that as "one file" and still pulls Chart.js and Google Fonts. The preset therefore bans remote resources item by item and asks agy to re-check the file before finishing.

## Notes

- The script always writes a bare JSON object with `console.log` — no other stdout noise. If a caller sees anything else on stdout, something upstream is broken.
- The script never needs a shell (`spawnSync` is called without `shell: true`), so prompts containing quotes, `$`, or backticks pass through safely.
- `--agent` is accepted but currently useless: `agy agents` returns an empty list on a stock install.
