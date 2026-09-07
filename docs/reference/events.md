# OpenCode Lifecycle & Events Reference

This document maps OpenCode's internal plugin hooks, lifecycle phases, and event bus architecture as validated against `@opencode-ai/plugin@1.18.9`.

---

## Plugin Lifecycles & Execution Order

OpenCode executes plugin hooks serially in load order:

| Lifecycle Phase         | OpenCode Hook / Event             | Execution Semantics & Capabilities                                                                                                             |
| :---------------------- | :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instance Boot**       | `config`                          | Runs once per instance boot. Mutates live config (injects agents, commands, skills). Errors are logged and ignored.                            |
| **Session Created**     | `session.created` event           | Session initialization. Payload includes `{ sessionID, info }`.                                                                                |
| **User Prompt Submit**  | `chat.message`                    | Inspects and mutates user prompt before LLM dispatch. Mutate `output.message` (persists) and `output.parts` in place.                          |
| **Pre-LLM Parameters**  | `chat.params`                     | Injected per LLM step. Can mutate temperature, maxOutputTokens, and provider options.                                                          |
| **Pre-Tool Execution**  | `tool.execute.before`             | Inspects and rewrites arguments (`output.args`) in place. Fires before permission prompts.                                                     |
| **Post-Tool Execution** | `tool.execute.after`              | Rewrites tool output, title, or metadata in place. Modifies what the model sees and what persists.                                             |
| **Step Completed**      | `session.next.step.ended`         | Delivers per-step telemetry: finish reason, cost, tokens, touched files.                                                                       |
| **Session Idle**        | `session.status { type: "idle" }` | Fires when assistant turn completes and model is waiting for user input. Primary trigger for deferred quality gates and background injections. |
| **Instance Disposal**   | `dispose`                         | Executed when OpenCode shuts down. Cleans up timers, background processes, and watchers.                                                       |

---

## Host Event Bus (88 Event Types)

OpenCode maintains an internal event bus with 88 distinct event types across major families:

- **`session.*`:** `created`, `updated`, `deleted`, `diff`, `error`, `status`, `idle`, `compacted`
- **`session.next.*` (32 types):** Step streaming, tool execution lifecycle (`tool.called`, `tool.success`, `tool.failed`), reasoning streaming, token telemetry
- **`message.*`:** `updated`, `removed`, `part.updated`, `part.removed`, `part.delta`
- **`permission.*`:** `asked`, `replied`, `permission.v2.*`
- **`question.*`:** `asked`, `replied`, `question.v2.*`
- **`file.*`:** `edited`, `watcher.updated`
- **`tui.*`:** UI control events (`toast.show`, `prompt.append`, `command.execute`, `session.select`)

---

## Critical Event Bus Gotchas

1. **Directory Filtering:** Event subscriptions in server plugins are directory-filtered. A plugin only receives events originating from its own project workspace directory.
2. **Frozen V1 SDK Types:** The legacy v1 SDK `Event` type declared in `@opencode-ai/plugin` is frozen and contains only 32 members, missing `session.next.*`, `permission.asked`, and payload fields like `sessionID`. Overclock uses robust runtime discrimination to access the complete 88-event surface.
3. **Turn Telemetry Source:** Rich token counts (input, output, cache read, cache write) and dollar costs ride exclusively on `session.next.step.ended`.
4. **Injection Target Model:** When injecting turns via `session.promptAsync` (`POST /session/:id/prompt_async`), failing to specify `body.model` causes OpenCode to fall back to the config default model rather than the session's active model. Overclock always inspects the last assistant message and passes the explicit model ID.
