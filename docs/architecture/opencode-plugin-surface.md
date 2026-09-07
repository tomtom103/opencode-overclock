# OpenCode Plugin Surface Technical Map & Drift Tracking

Validated against `anomalyco/opencode` @ `8cbea4f` (2026-07-29, `@opencode-ai/plugin@1.18.9` = npm `latest`).

Source of truth: `packages/plugin/src/index.ts` (v1 hooks), `packages/plugin/src/tui.ts` (TUI plugin API), `packages/plugin/src/v2/` (v2 API), `packages/schema/src/event-manifest.ts` (events).

---

## Minimum Host Version Matrix

`engines.opencode` is `>=1.18.4`. Derived by probing every published `@opencode-ai/plugin` version for the surfaces Overclock touches, then typechecking + running the suite against each, then booting real `opencode serve` instances. Floors, in order:

| Surface Overclock Uses                               | First Host Release | Failure Mode if Missing                                    |
| :--------------------------------------------------- | :----------------- | :--------------------------------------------------------- |
| v1 hooks, dynamic tools, `session.promptAsync`, `kv` | `<= 1.14.20`       | Plugin fails to initialize                                 |
| `TuiPluginApi.attention.notify` (+ sound)            | `1.14.49`          | Audio alerts disabled                                      |
| `Hooks.dispose`                                      | `1.15.11`          | Host never calls dispose; background tasks & watchers leak |
| bundled `@opentui/solid >= 0.4.5` (buddy sprite)     | `1.18.4`           | Solid JSX compilation error                                |

So **1.15.11** is the floor for the server surface and **1.18.4** for the buddy; Overclock gates on the latter.

---

## Three Plugin Surfaces (Not One)

| Surface                 | Entry Point                                     | Runtime             | Status                                       |
| :---------------------- | :---------------------------------------------- | :------------------ | :------------------------------------------- |
| **v1 Server Hooks**     | `export default { id?, server }` -> `Hooks`     | `packages/opencode` | Operative, standard                          |
| **TUI Plugin**          | `export default { id?, tui }` -> `TuiPluginApi` | `packages/tui`      | Operative, statusline slots & commands       |
| **v2 Registration API** | `{ id, effect }` / `{ id, setup }` via `/v2/*`  | `packages/core`     | Domain transforms on agents/commands/catalog |

One npm package ships server + TUI via separate exports (`exports["./server"]`, `"./tui"`).

---

## OpenCode Lifecycle & Hook Mapping

| Lifecycle Stage         | OpenCode Hook / Event              | Overclock Integration                                                               |
| :---------------------- | :--------------------------------- | :---------------------------------------------------------------------------------- |
| **Session Created**     | `session.created` event            | Session initialization & state tracking                                             |
| **User Prompt Submit**  | `chat.message`                     | Inspects and mutates user prompts before LLM dispatch                               |
| **Pre-Tool Execution**  | `tool.execute.before`              | Intercepts destructive Git commands (`safety`)                                      |
| **Post-Tool Execution** | `tool.execute.after`               | Smart truncation (`truncator`), anti-bypass (`floorGuard`), quality gates (`guard`) |
| **Notification**        | `permission.asked`, toasts         | Audio chimes and desktop notifications                                              |
| **Turn Idle / Finish**  | `session.status { type: "idle" }`  | Injects deferred quality-gate failures and background task exits                    |
| **Session Disposal**    | `session.deleted` event, `dispose` | Terminates background processes, closes browser sessions                            |

---

## Critical Hook Semantics & Gotchas

1. **In-Place Mutation:** Mutation rule in hooks: "in place" = mutate properties and array elements directly. Reassigning `output.parts` is a no-op; mutate `output.message` or array elements.
2. **`permission.ask` is Dead Code:** In upstream OpenCode, `permission.ask` is declared in types but never invoked by the engine. Overclock hooks into `tool.execute.before` instead.
3. **Model Resolution in Prompt Injection:** `session.promptAsync` (`POST /session/:id/prompt_async`) without `body.model` runs injected turns on the config default model rather than the session's active model. Overclock inspects `session.messages` and passes explicit `providerID` and `modelID`.
4. **Tool ID Wire Mapping:** The `tool` hook return object keys are the literal tool IDs sent over the wire to LLM providers. Renaming and withholding occurs at hook registration time.

---

## Tracking Upstream Drift

Watchlist for upstream updates:

| File                                    | Upstream Risk                            |
| :-------------------------------------- | :--------------------------------------- |
| `packages/plugin/src/index.ts`          | v1 Hooks signature changes               |
| `packages/plugin/src/tui.ts`            | TUI plugin API additions                 |
| `packages/plugin/src/tool.ts`           | Custom tool contract                     |
| `packages/plugin/src/v2/**`             | New domain transforms appearing in v2    |
| `packages/schema/src/event-manifest.ts` | New event names or payload shape changes |
