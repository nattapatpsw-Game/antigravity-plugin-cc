---
description: Check whether the local Antigravity (agy) CLI is installed and authenticated
argument-hint: ''
allowed-tools: Bash(node:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup
```

If the result says `agy` is unavailable (`agy.available: false`):
- Use `AskUserQuestion` exactly once to ask whether Claude should install the Antigravity CLI now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Antigravity CLI (Recommended)`
  - `Skip for now`
- If the user chooses install, tell them the official installer command for their platform (do not run it without confirmation, since it downloads and executes a remote script):
  - macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
  - Windows (PowerShell): `irm https://antigravity.google/cli/install.ps1 | iex`
  - Windows (cmd): `curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd`
- After they confirm and run it, rerun:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup
```

If `agy.available` is true but `auth.loggedIn` is false:
- Tell the user to run `agy` with no arguments in a terminal **outside Claude Code** (it opens a browser for OAuth login — this cannot be driven through the `!` prefix or Bash tool here).
- Mention the alternative: set `GEMINI_API_KEY` and add `{"modelProvider": "gemini"}` to `~/.gemini/antigravity-cli/settings.json` for headless/CI auth.

Output rules:
- Present the final setup result (ready/agy/auth/nextSteps) to the user.
- Do not claim `ready: true` unless the JSON says so.
