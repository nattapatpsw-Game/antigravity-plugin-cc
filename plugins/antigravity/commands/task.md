---
description: Run a typed Antigravity (agy) task — image, ui, code, or a general question
argument-hint: '[image|ui|code|ask] [--out <dir>] [--model <slug>] [--effort low|medium|high] <what to do>'
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
- `code` — write or modify code in the target directory.
- `ask` — anything else. Answers in prose, and creates files when the request asks for them.

## Choosing the type

1. If the first bare word of the request is `image`, `ui`, `code` or `ask`, that is the type. Strip it out of the text passed via `--prompt` — it is routing, not task content.
2. Otherwise **infer the type from what the user is asking for**, in any language:
   - wants a picture drawn or generated → `image`
   - wants a chart, graph, dashboard, diagram or interactive widget → `ui`
   - wants code written, edited, refactored or fixed in a directory → `code`
   - anything else → `ask`
3. When you infer rather than read the type, say which type you chose in one short line before Antigravity's output, so the user can correct you.

Do not treat a leading type word as routing when it is obviously part of the task text — for example "image processing library ไหนดี" is a question about libraries, not a request to generate an image named "processing library ไหนดี". When the rest of the request does not read as a task on its own, the leading word was content: keep it in the prompt and infer the type instead.

## Operating rules

- `--out`, `--model` and `--effort` are routing flags. Preserve them for the forwarded call, but do not treat them as part of the natural-language task text.
- Leave `--model` and `--effort` unset unless the user explicitly asks for a specific one. Note that `--effort` is ignored whenever `--model` is given, because every agy model slug either bakes the effort in or rejects the flag.
- Every type can write files. `--out` defaults to the current working directory — pass an explicit `--out` when the user names a destination, and make sure the directory already exists.
- When files are produced, the response ends with their absolute paths. Keep those paths in the final answer; they are the only way the user can find the output.
- If the helper reports that `agy` is missing or unauthenticated, stop and tell the user to run `/antigravity:setup`.
- If the user did not supply a request, ask what Antigravity should do.
