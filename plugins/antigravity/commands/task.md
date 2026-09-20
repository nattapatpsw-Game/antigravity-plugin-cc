---
description: Run a typed Antigravity (agy) task — image, ui, research, code, or a general question
argument-hint: '<image|ui|research|code|ask> [--out <dir>] [--model <slug>] [--effort low|medium|high] <what to do>'
allowed-tools: Bash(node:*), Agent
---

Invoke the `antigravity:antigravity-rescue` subagent via the `Agent` tool (`subagent_type: "antigravity:antigravity-rescue"`), telling it to make a **`task`** call and forwarding the raw user request as the prompt.

`antigravity:antigravity-rescue` is a subagent, not a skill — do not call `Skill(antigravity:antigravity-rescue)` (no such skill) or `Skill(antigravity:task)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope; forked general-purpose subagents do not expose it.

The final user-visible response must be Antigravity's output verbatim.

Raw user request:
$ARGUMENTS

Task types:

- `image` — generate image file(s) with agy's `generate_image` tool.
- `ui` — build a self-contained HTML artifact (chart, dashboard, diagram, widget).
- `research` — search the web and answer with sources. Writes nothing.
- `code` — write or modify code in the target directory.
- `ask` — general question or discussion. Writes nothing.

Operating rules:

- The first bare word of the request is the task type when it matches one of the five above. Otherwise there is no type word and the whole request is an `ask`.
- Strip the type word out of the text passed via `--prompt`; it is routing, not task content.
- `--out`, `--model` and `--effort` are routing flags too. Preserve them for the forwarded call, but do not treat them as part of the natural-language task text.
- Leave `--model` and `--effort` unset unless the user explicitly asks for a specific one. Note that `--effort` is ignored whenever `--model` is given, because every agy model slug either bakes the effort in or rejects the flag.
- `image`, `ui` and `code` write files. `--out` defaults to the current working directory — pass an explicit `--out` when the user names a destination, and make sure the directory already exists.
- For those three types, the response ends with the absolute path(s) of what was produced. Keep those paths in the final answer; they are the only way the user can find the output.
- If the helper reports that `agy` is missing or unauthenticated, stop and tell the user to run `/antigravity:setup`.
- If the user did not supply a request, ask what Antigravity should do.
