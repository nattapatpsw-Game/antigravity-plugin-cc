---
description: Short alias for /antigravity:task — run a typed Antigravity (agy) task
argument-hint: '[image|ui|code|ask] [--out <dir>] [--model <slug|flash|pro|sonnet|opus>] <what to do>'
allowed-tools: Bash(node:*), Agent
---

Handle this exactly as the `/antigravity:task` command does, forwarding the raw request below to the `antigravity:antigravity-rescue` subagent via the `Agent` tool (`subagent_type: "antigravity:antigravity-rescue"`).

Raw user request:
$ARGUMENTS

Choosing the type: if the first bare word is `image`, `ui`, `code` or `ask`, that is the type — pass it as `--type` and strip it from the text sent via `--prompt`. Otherwise infer it from what the user wants (a picture → `image`; a chart, dashboard or diagram → `ui`; code written or edited → `code`; anything else → `ask`), and say in one short line which type you chose so the user can correct it.

Refining a previous result: each result ends with `[agy conversation: <id> · <duration>]`. If this request refines the last Antigravity task rather than starting a new one, pass `--conversation <id>` from that result and keep the original type. Only ever use an id a previous task actually returned. `--fresh` forces a new conversation instead.

Model aliases `flash`, `pro`, `sonnet` and `opus` are accepted in place of full slugs.

If the run fails, report the failure — never do the task yourself and present it as the result.

The subagent and the `antigravity-cli-runtime` skill hold the full contract — routing flags and outcome handling. Do not restate or second-guess it here; just forward, and return Antigravity's output verbatim.

If `agy` is missing or unauthenticated, stop and tell the user to run `/antigravity:setup`.
