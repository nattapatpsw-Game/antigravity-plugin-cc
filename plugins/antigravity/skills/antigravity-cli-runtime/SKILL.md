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
  "nextSteps": []
}
```

Checks authentication via `agy models` (fails fast with a clear message when signed out) rather than `agy -p`, which launches an interactive OAuth browser flow and hangs for up to 60 seconds. Never invoke `agy -p` just to probe auth state.

### `run`

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" run --prompt "<task text>" [--model <slug>] [--effort low|medium|high] [--agent <name>] [--timeout <duration>] [--skip-permissions]
```

Runs `agy -p "<task text>" --output-format json` under the hood and re-emits `agy`'s own JSON envelope:

```json
{
  "conversation_id": "...",
  "status": "OK",
  "response": "...",
  "error": "",
  "duration_seconds": 12.4,
  "num_turns": 3,
  "usage": { "input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "cache_read_tokens": 0, "total_tokens": 0 }
}
```

On failure, `status` is `"ERROR"` and `error` holds the reason. `--timeout` maps to `agy`'s own `--print-timeout` and defaults to `8m` — always pass one so a stuck run cannot hang past this plugin's control.

`--skip-permissions` maps to `agy`'s `--dangerously-skip-permissions`; only pass it when the caller explicitly asked for unattended tool approval.

## Notes

- The script always writes a bare JSON object with `console.log` — no other stdout noise. If a caller sees anything else on stdout, something upstream is broken.
- The script never needs a shell (`spawnSync` is called without `shell: true`), so prompts containing quotes, `$`, or backticks pass through safely.
