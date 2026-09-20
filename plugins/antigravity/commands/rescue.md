---
description: Delegate a task to the Antigravity (agy) CLI through the shared runtime
argument-hint: '[--model <slug>] [--effort low|medium|high] [what Antigravity should do]'
allowed-tools: Bash(node:*), Agent
---

Invoke the `antigravity:antigravity-rescue` subagent via the `Agent` tool (`subagent_type: "antigravity:antigravity-rescue"`), forwarding the raw user request as the prompt.

`antigravity:antigravity-rescue` is a subagent, not a skill — do not call `Skill(antigravity:antigravity-rescue)` (no such skill) or `Skill(antigravity:rescue)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope; forked general-purpose subagents do not expose it.

The final user-visible response must be Antigravity's output verbatim.

Raw user request:
$ARGUMENTS

Operating rules:

- `--model` and `--effort` are runtime-selection flags. Preserve them for the forwarded call, but do not treat them as part of the natural-language task text.
- Leave `--effort` and `--model` unset unless the user explicitly asks for a specific one.
- If the helper reports that `agy` is missing or unauthenticated, stop and tell the user to run `/antigravity:setup`.
- If the user did not supply a request, ask what Antigravity should do.
