# Internals

How the plugin works under the surface: the call path, the `agy-companion.mjs` API, how success and failure are decided, and the reasoning behind the design. For installing and using it, see the [README](../README.md).

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

A run that comes back empty is **retried once**, but only when nothing was denied and it failed in under 30 seconds — image generation does occasionally drop a turn and succeed on a re-run. A permission denial repeats identically and a timeout burns its full budget, so neither is retried. When a retry happens the result says `retried: true`.

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

## Design notes

- **Thin forwarding, not a smart wrapper.** The subagent shapes one call and relays the result. Nothing in between reinterprets Antigravity's answer.
- **JSON-only stdout contract.** Every invocation produces exactly one JSON object, so parsing never depends on scraping text.
- **Task types are data, not logic.** The presets live in one table in `agy-companion.mjs`. Adding a type is a data edit, not a change to any prompt.
- **Least privilege per type.** Only the types that genuinely need unattended tool approval get it — verified by testing, not assumed.
- **Auth checks never hang.** Sign-in status is probed with a command that fails fast instead of one that can open a browser.
- **Fail loudly, not quietly.** Where `agy` fails open — an unknown `--mode`, a timeout dressed up as success — the plugin converts it into an explicit error.
- **Check, don't trust.** Output paths are verified against the filesystem rather than read out of Antigravity's prose, so a claimed file and a real one are never confused.
- **Framing is built from named blocks.** Each task type composes its prompt from a small library of reusable, individually-named blocks. Every one of those sentences was written in response to a specific observed failure, so they get rearranged and reused but never casually reworded — and the smoke test asserts the load-bearing phrases are still present.
- **Never substitute your own work.** If a run fails, the plugin says so. Quietly finishing the task in Claude instead, and not mentioning that the delegation broke, is the failure mode these rules exist to prevent.

---

