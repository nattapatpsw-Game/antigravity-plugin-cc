# Changelog

## 0.6.0

- `/antigravity:help` — a quick reference card for commands, task types, flags and model aliases, without leaving the session. Claude Code's own `/help` lists the commands but not the types and flags, which is where this plugin's surface actually lives. The task list is read from the plugin at runtime rather than written into the card, so it cannot drift.

## 0.5.0

- `/antigravity:ag` — the short alias now ships with the plugin, so it works for anyone who installs it rather than only on the author's machine.
- CI runs the smoke test on Linux, macOS and Windows for every push. That also gives the plugin its first cross-platform evidence: the suite never invokes `agy`, so it needs no install, no auth and no network anywhere. CI additionally checks that both manifests agree on the version.
- `.gitattributes` normalises line endings to LF in the repository. Without it, committing from Windows stored CRLF and anyone cloning on macOS or Linux saw the whole tree as modified.
- README split: the script API, outcome handling and design reasoning moved to [docs/internals.md](docs/internals.md), leaving the README for installing and using the plugin. 500 lines down to 375.

## 0.4.0

- Task framing is now composed from named, reusable prompt blocks instead of four hard-coded strings. Existing wording is preserved byte for byte — each sentence was arrived at by watching a specific headless failure, so the blocks were rearranged, never reworded.
- Added a **follow-through** block to every task type. `agy` has an `ask_question` tool and nothing can answer it in print mode, so a clarifying question silently burned the whole run. Tasks now act on the most reasonable interpretation instead.
- Added a **no-shell notice** to `ask`. Follow-through alone made it reach for the shell — "test this alias" became a `RunCommand` attempt, which `ask` denies — so it now knows to answer from knowledge and name the command it would have run.
- Model aliases: `flash`, `pro`, `sonnet`, `opus` resolve to full slugs. Raw slugs still work.
- `--fresh` forces a new conversation, overriding an inferred follow-up.
- A run that comes back empty is retried once, but only when nothing was denied and it failed in under 30 seconds — a permission denial repeats identically and a timeout burns the full budget, so neither is retried. Retries are reported as `retried: true`.
- Subagent and command rules now forbid substituting Claude's own work when a run fails. Quietly finishing the task and not mentioning that the delegation broke was the gap.
- Smoke test grown to 26 checks, including guards on the framing phrases that earlier fixes depend on.

## 0.3.0

- MIT licensed.
- Run duration and conversation id reported with every answer. Token counts deliberately excluded: `agy`'s total is dominated by its own system prompt, so a one-word answer still reports five figures.
- Removed the dead `--agent` passthrough — `agy agents` is empty on a stock install.

## 0.2.0

- Follow-up conversations via `--conversation <id>`, so a result can be refined without restating the task.
- Output verified against the filesystem (`filesCreated` / `filesModified`) rather than taken from Antigravity's prose.
- Offline smoke test suite and a `--dry-run` flag.
- Covers the removal of the `research` task type, a breaking change that had shipped under `0.1.1`.

## 0.1.1

- `/antigravity:task` with typed presets, and fixes to outcome handling: a timeout reported as success, a `--mode` that failed open, and `--model`/`--effort` being sent as an invalid pair.

## 0.1.0

- Initial release: `/antigravity:setup` and `/antigravity:rescue`.
