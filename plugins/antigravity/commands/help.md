---
description: Quick reference for the Antigravity plugin — commands, task types, flags and model aliases
argument-hint: ''
allowed-tools: Bash(node:*)
---

First run this, so the task list comes from the plugin itself rather than from this file:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" types
```

Then show the user the reference below, with the task-type table filled in from that output. Keep it as a compact card — this is an in-session cheat sheet, not the manual. Do not add commentary, and do not run any other command.

---

**Commands**

| Command | What it does |
|---|---|
| `/antigravity:task [type] <task>` | Run a task. The main entry point. |
| `/antigravity:ag [type] <task>` | Same thing, less typing. |
| `/antigravity:rescue <task>` | Raw passthrough, no framing applied. |
| `/antigravity:setup` | Check that `agy` is installed and signed in. |
| `/antigravity:help` | This card. |

**Task types** — from the `types` output above. Name one as the first word, or leave it out and it is inferred from what you asked for.

**Flags**

| Flag | Effect |
|---|---|
| `--out <dir>` | Where files go. Defaults to the current directory, and must already exist. |
| `--name <name>` | What the file is called. Without it, Antigravity picks the name. |
| `--conversation <id>` | Continue an earlier task. The id is on the `[agy conversation: …]` line of its reply. |
| `--fresh` | Force a new conversation instead of continuing one. |
| `--model <name>` | `flash`, `pro`, `sonnet`, `opus`, or any full slug from `agy models`. |
| `--timeout <duration>` | Default `8m`. |

**Worth knowing**

- Refine instead of restarting: after an image, "make it purple" keeps the original composition.
- Ask for several variants in one request — "three variants of …" returns three files from one run.
- `code` edits files but cannot run shell commands. Ask Claude Code to run the tests instead.
- Tasks run on your own Antigravity account and count against its usage limits.

Full documentation: https://github.com/nattapatpsw-Game/antigravity-plugin-cc
