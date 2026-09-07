# Opencode Plugin Surface Exploration

Validated against `anomalyco/opencode` @ `8cbea4f` (2026-07-29, `@opencode-ai/plugin@1.18.9` = npm `latest`).

Source of truth: `packages/plugin/src/index.ts` (v1 hooks), `packages/plugin/src/tui.ts` (TUI plugin API), `packages/plugin/src/v2/` (v2 API), `packages/schema/src/event-manifest.ts` (events). Docs pages undersell badly — several hooks and the whole TUI/v2 surfaces are undocumented.

## Minimum host version

`engines.opencode` is `>=1.18.4`. Derived by probing every published `@opencode-ai/plugin` version for the surfaces we touch, then typechecking + running the suite against each, then booting real `opencode serve` instances. Floors, in order:

| Surface we use                                                                                                                        | First release                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| v1 hooks, dynamic tools, `session.promptAsync`/`messages`/`create`/`revert`/`unrevert`, `tui.showToast`, `*_prompt_right` slots, `kv` | <= 1.14.20 (oldest published) |
| `TuiPluginApi.attention.notify` (+ sound)                                                                                             | 1.14.49                       |
| `Hooks.dispose` — below this the host never calls it, so our timers/watchers leak                                                     | 1.15.11                       |
| bundled `@opentui/solid >= 0.4.5`, matching our declared peer, for the buddy sprite                                                   | 1.18.4                        |

So 1.15.11 is the floor for the server surface and 1.18.4 for the buddy; we gate on the latter. Re-derive on bump: the `dispose` check is behavioural, not type-level — a plugin returning `{ dispose }` that writes a marker file, then `POST /instance/dispose`.

## Three plugin surfaces (not one)

| Surface             | Entry                                              | Runtime             | Status                    |
| ------------------- | -------------------------------------------------- | ------------------- | ------------------------- |
| v1 server hooks     | `export default { id?, server }` -> `Hooks` object | `packages/opencode` | operative, not deprecated |
| TUI plugin          | `export default { id?, tui }` -> `TuiPluginApi`    | `packages/tui`      | operative, undocumented   |
| v2 registration API | `{ id, effect }` / `{ id, setup }` via `/v2/*`     | `packages/core`     | wired in core, incoming   |

One npm package can ship server + tui via separate exports (`exports["./server"]`, `"./tui"`); a single module can't have both (`tui?: never`).

## OpenCode Lifecycle & Hook Mapping

| Lifecycle Stage     | opencode hook / event                                    | Description            |
| ------------------- | -------------------------------------------------------- | ---------------------- |
| Session Created     | `session.created` event + inject on first `chat.message` | Session initialization |
| User Prompt Submit  | `chat.message`                                           | Mutate user prompt     |
| Pre-Tool Execution  | `tool.execute.before` (`permission.ask` is dead code)    | Inspect/rewrite args   |
| Post-Tool Execution | `tool.execute.after`                                     | Inspect/modify output  |
| Notification        | `permission.asked` event + `client.tui.*` toasts         | User attention/toasts  |
| Turn Idle / Finish  | `session.status {idle}`                                  | Idle loop / feedback   |
| Pre-Compact         | `experimental.session.compacting`                        | Compaction context     |
| Session Disposal    | `session.deleted` event, `dispose`                       | Resource cleanup       |

Notes per row:

- **Session Created** — `session.created` payload is `{sessionID, info}` (runtime includes `sessionID`; frozen v1 SDK type omits it).
- **User Prompt Submit** — mutate `output.message` (persists) and `output.parts` **in place**; reassigning `output.parts` is a no-op. Does not fire for the compaction auto-continue message.
- **Pre-Tool Execution** — the `permission.ask` hook is **declared in types but never invoked** (zero call sites; the permission service never consults plugins). Gate instead via the `permission.asked` event + SDK reply, or throw from `tool.execute.before` (becomes a fiber defect — crashes the step, ugly). Arg rewrites: mutate `output.args` in place; fires before the permission prompt.
- **Post-Tool Execution** — mutate `title`/`output`/`metadata` in place; affects what the model sees AND what persists. Caveats: MCP-proxied tools receive the raw `CallToolResult` (mutate `content`; `title` ignored); the task-tool path may pass `output === undefined`.
- **Notification** — toasts and TUI control from server plugins via `client.tui.showToast()` / `client.tui.publish()` (`tui.toast.show`, `tui.prompt.append`, `tui.command.execute`, `tui.session.select`). TUI plugins additionally get `api.attention.notify()` = OS notification + sound packs.
- **Turn Idle** — subscribe `session.status` and match `{status:{type:"idle"}}` (preferred; `session.idle` still fires but is marked deprecated upstream), then check and `client.session.prompt()` to continue. Per-assistant-turn granularity: `session.next.step.ended` (finish reason, cost, tokens). Disambiguate abort/error via `session.error`. End-of-turn order: `step.ended` -> `message.updated` (assistant, `time.completed` set) -> `session.status{idle}` -> `session.idle`.
- **Injection caveat (found live 2026-07-29)** — `session.promptAsync` (`POST /session/:id/prompt_async`) without `body.model` runs the injected turn on the **config default model**, not the session's model. Wrong model + unreachable default = turn hangs forever, later injections pile up QUEUED behind it. Always resolve the session's model (last assistant message `providerID`/`modelID` via `session.messages`) and pass it explicitly. Same applies to `session.prompt`. Fires while a turn is running queue server-side and drain at turn end — for periodic injection, skip fires while target is busy (track via `session.status`).
- **Pre-Compact** — `output.context.push()` appends to the default prompt; `output.prompt =` replaces it entirely (discards previous-summary handling).
- **Session Disposal** — `dispose` runs when the instance scope closes.

Execution semantics: hooks run **serially in plugin load order**, same `output` object passed by reference to each. A throwing hook is a defect (kills the fiber) except `config` (logged + ignored) and `event` (fire-and-forget, unhandled rejection). Internal plugins load before user plugins.

## v1 hooks — full inventory

Mutation rule: "in place" = mutate properties/array elements; reassigning `output.x` is a no-op unless noted otherwise.

- **`chat.message`** — mutate user msg before model. `message` mutations persist; `parts` in place only.
- **`chat.params`** — temperature/topP/topK/maxOutputTokens/provider `options` per request. Reassignment works. Fires per LLM step, incl. title/summary calls. `temperature` can be `undefined` despite its type.
- **`chat.headers`** — HTTP headers per request. Plugin headers win over built-ins and model headers. Reassignment works.
- **`permission.ask`** — **dead, never invoked.** Do not build on it.
- **`tool.execute.before`** — rewrite args in place. Fires for registry tools, MCP tools, code-mode child tools, subtask task-tool. Exception: `list_mcp_*` / `read_mcp_resource` parse args _before_ the hook — mutation ineffective there.
- **`tool.execute.after`** — rewrite output/title/metadata in place (see PostToolUse caveats above).
- **`tool.definition`** — rewrite built-in tool description/params. Output has an undocumented third field `jsonSchema` (wins if set; replacing `parameters` alone re-derives it). `description` gets suffixes appended (task agent list, code-mode catalog). Fires per agent-loop step, per tool.
- **`command.execute.before`** — intercept slash commands. `parts` in place only. Fires before `chat.message`.
- **`shell.env`** — env injection. Seed is `{}` (additive; can't see existing env). Plugin values **win over `process.env`**. Fires on: every bash tool call, user `!cmd` (TERM forced), PTY create (cwd only, no sessionID).
- **`config`** — mutate resolved config (inject agents/commands/MCP/instructions). Receives the live config state object; runs **once per instance boot, before everything**; not re-run on invalidate. Errors ignored.
- **`tool: {...}`** — custom JS tools: Zod raw-shape args, `ctx.ask()`, `ctx.metadata()`, file attachments, `directory`/`worktree`/`abort`. Appended after built-ins; a duplicate id **overrides** the built-in in the final tool map.
- **`auth`** — custom auth methods (oauth/api prompts) per provider. Last plugin per provider id wins; `loader` merges credentials into provider options.
- **`provider`** — replace a provider's model list. Only works if the provider id exists in the models.dev db — cannot introduce a brand-new provider.
- **`experimental.chat.system.transform`** — rewrite system prompt. In-place array only; post-processing collapses entries 1..n so max 2 survive. Also fires (without sessionID) for agent-scaffold generation.
- **`experimental.chat.messages.transform`** — rewrite full history. In place only; input is literally `{}` (no session/model context). Also fires on compaction input (a deep clone there).
- **`experimental.provider.small_model`** — override small-model choice. Only consulted when `small_model` config is unset. Reassignment works.
- **`experimental.session.compacting`** — compaction context/prompt (see PreCompact).
- **`experimental.compaction.autocontinue`** — `enabled = false` skips the synthetic "continue" turn. Input includes `overflow`.
- **`experimental.text.complete`** — post-process assistant text at `text-end` per part. Rewrites stored/rendered text, but streamed deltas already went out.
- **`event`** — subscribe to the full bus (see below). Receive-only, directory-filtered.
- **`dispose`** — cleanup at instance shutdown.

Plugin ctx (`PluginInput`): `client` (full SDK — spawn sessions, prompt, TUI control), `$` (Bun shell; `undefined` off-Bun), `project`, `directory`, `worktree`, `serverUrl` (lazy), and `experimental_workspace.register(type, adapter)` — workspace adapters (`configure/create/remove/target` -> local dir or remote URL; powers the `experimental.workspace.*` HTTP routes; overrides the built-in `worktree` adapter by type).

Plugin options: `plugin: ["name", {options}]` tuples in config arrive as the plugin function's second argument.

## Event bus

88 event types in the manifest (`packages/schema/src/event-manifest.ts`; count asserted in `packages/opencode/test/event-manifest.test.ts`).

Families: `session.*` (created/updated/deleted/diff/error/status/idle/compacted) · `session.next.*` (32 types: step/text/reasoning/tool-input streaming, tool.called/success/failed, compaction, revert, prompted, shell) · `message.*` (updated/removed/part.updated/part.removed/part.delta) · `permission.{asked,replied}` + `permission.v2.*` · `question.*` + `question.v2.*` · `file.{edited,watcher.updated}` · `tui.*` (4 control events) · `todo.updated` · `lsp.updated` · `mcp.*` · `command.executed` · `project.*` · `pty.*` · `vcs.branch.updated` · `catalog.updated` · `plugin.added` · `installation.*` · `workspace.*` / `worktree.*` · `server.connected` · `global.disposed`.

Gotchas:

- **The v1 SDK `Event` type (what `Hooks.event` declares) is frozen and wrong**: 32 members vs 88 delivered. Phantom types that never fire: `permission.updated`, `lsp.client.diagnostics`. Missing: all `session.next.*`, `permission.asked`, `question.*`, `mcp.*`, and more. Payload drift: runtime `session.*` / `message.updated` include `sessionID`; `permission.replied` is `{sessionID, requestID, reply}`, not `{permissionID, response}`. Use `@opencode-ai/sdk/v2` types (generated from `packages/sdk/openapi.json`) for anything real.
- Events are **directory-filtered** — a plugin only sees events for its own instance directory. GlobalBus-only events **never reach server plugins**: `installation.*`, `worktree.ready/failed`, `workspace.status`, `global.disposed`, `server.connected`/`heartbeat` (SSE-only).
- Plugins **cannot publish** bus events. Only publish path: `client.tui.publish()` (the 4 `tui.*` types) plus sugar endpoints (`showToast`, `appendPrompt`, `executeCommand`, `submitPrompt`, `clearPrompt`, `selectSession`, …). Side-effect publishing via SDK calls works.
- Rich turn telemetry rides `session.next.step.ended`: finish reason, cost, tokens (incl. cache read/write), files touched, snapshot id.

## TUI plugin API (undocumented, huge — overclock goldmine)

`export default { id?, tui: async (api, options, meta) => {} }` from `@opencode-ai/plugin/tui`. Loaded from the same plugin specs (file/npm), managed at runtime (`api.plugins.list/activate/deactivate/add/install`), state persists via `api.kv`.

`TuiPluginApi` members:

- `ui` — Dialog/Alert/Confirm/Prompt/Select components, `toast()`, dialog stack
- `slots.register` — inject Solid JSX into named host slots: `app`, `app_bottom`, `home_logo`, `home_prompt*`, `session_prompt*`, `home_footer`, `sidebar_title/content/footer` (statusline/sidebar customization is possible, contrary to the old doc)
- `route` — register whole screens + navigate
- `keymap` — register layers (commands + keybindings), dispatch commands
- `mode` — push modal input modes
- `attention` — OS notifications, sound packs (register/activate)
- `theme` — read/set/install themes
- `state` — reactive read: sessions, messages, parts, todos, diffs, permissions, questions, lsp, mcp
- `event.on` — typed bus subscribe
- `client` — full SDK
- `kv`, `renderer` (opentui CliRenderer), `lifecycle` (abort signal + onDispose), prompt refs (read/set/submit the input box)

Themes can also ship in a plugin package via `package.json` `oc-themes`.

## v2 plugin API (packages/core — incoming, plan against it)

Types-only in `@opencode-ai/plugin/v2/{effect,promise}` (promise = thin adapter over effect). Model shift: no returned Hooks object — `setup(ctx)` imperatively registers **transforms** on domains; registrations are scope-owned, individually disposable, with batched reloads.

`PluginContext` domains: `agent` (list/get/update/remove/default) · `command` · `skill` (contribute sources: directory/url/embedded) · `catalog` (providers + models + default model) · `integration` (auth: oauth/key/env methods, credential resolution) · `reference` · `aisdk` (`sdk`/`language` — swap the AI-SDK instance or LanguageModel per model: middleware injection point) · `plugin` (nested add/remove) · `options`.

**Not in v2 yet**: tool execution hooks, events, session/permission/chat hooks (drafts exist unwired: `event.ts`, `npm.ts`, `filesystem.ts`, `location.ts`, `path.ts`). v1 remains the only way to intercept tools/events. Config key: v2 uses `plugins` (v1 `plugin` auto-migrates in `packages/core/src/v1/config/migrate.ts` — succession signal). Loading: `plugins: [{package, options}]` + `{plugin,plugins}/*.{ts,js}` config dirs; broken v2 plugins are silently skipped.

### The Hybrid V1/V2 Bridge (`src/core/bridge.ts`, re-exported via `src/bridge.ts`)

Because V1 provides execution-level power (`tool`, `tool.execute.before/after`, `event`) while V2 provides domain transforms (`agent`, `command`, `catalog`, `aisdk`), Overclock provides a hybrid bridge (`createHybridPlugin`) that is dual-conforming:

- **Callable function**: satisfies the V1 loader (`plugin(input, options) => Promise<Hooks>`).
- **`{ id, server }`**: satisfies the V1 module export specification.
- **`{ id, setup }`**: satisfies the V2 module export specification (`setup(context)`).

`FeatureModule` supports both lifecycles:

- `init(ctx, options, shared)`: runs in V1 to contribute tools and hook into events.
- `setup(context, options)`: runs in V2 to register domain transforms.

### Concurrent V1 + V2 Plugin Hosting on V1 (`src/v2/`)

On an OpenCode V1 runtime, external V2 plugins cannot be loaded natively by the host (which expects a function or `{ server: Function }`). Overclock embeds a complete in-process V2 Host engine (`src/v2/host.ts`, `src/v2/context.ts`, `src/v2/loader.ts`):

- **Synthetic `PluginContext`**: Instantiates a spec-conforming `PluginContext` backed by in-memory domain transforms.
- **V1 Hook Adaptation**:
  - `agent.transform` / `command.transform` / `catalog.transform` $\rightarrow$ applied to the live OpenCode config in V1's `config(cfg)` hook.
  - `reference.transform` $\rightarrow$ injected into the system prompt via `experimental.chat.system.transform`.
  - `aisdk.sdk` $\rightarrow$ executed during `chat.params` before LLM calls (`aisdk.language` transforms registered in draft state).
  - `plugin.add` / `plugin.remove` $\rightarrow$ supports dynamic nested V2 plugin loading with scope-owned resource disposal.
- **Polyglot V2 Plugin Loading**: Loads promise-based (`setup`) and effect-based (`effect`) V2 plugins from local files, file URLs, or package specifiers via `options.plugins`.
- **Concurrent Execution**: Runs full V1 tools and event subscriptions side-by-side with V2 domain transforms in the exact same OpenCode session.

## Plugin loading (v1)

- Discovery: `plugin` config array (string or `[spec, options]`; relative specs resolve against the declaring config file) + auto-glob `{plugin,plugins}/*.{ts,js}` in every config dir (`~/.config/opencode`, each `.opencode` cwd->worktree, `~/.opencode`, `OPENCODE_CONFIG_DIR`).
- npm specs: installed to `~/.cache/opencode/packages/<spec>/node_modules/` (one npm project per spec, **not** a flat `~/.cache/opencode/node_modules` — corrected empirically 2026-07-29), bare name -> `@latest`, `engines.opencode` semver-gated, dedupe last-declaration-wins by package name (version-insensitive). Entrypoint: `exports["./server"]`, then `main`.
- **`plugin` entries resolve by npm name from the public registry only.** A directory path, a `.tgz` path, a path to `src/index.ts`, and a copy pre-installed into `.opencode/node_modules` are all ignored by the runtime loader. Local code loads only via the auto-glob (`{plugin,plugins}/*.{ts,js}`). Verified 2026-07-29 on 1.18.9.
- **A registry miss is silent.** Unknown name -> cache dir created, `npm install` 404s, plugin skipped, nothing logged at any level. Symptom is only the absence of the plugin's tools. Corollary: the runtime load path cannot be tested before publishing (`scripts/verify-pack.sh --published` covers it after).
- Manifest target detection (`opencode plugin <dir>`) reports `Detected server + tui targets` and writes **two** config entries: `opencode.json` (server) and `tui.json` (TUI). An `opencode.json` entry alone loads only the server half.
- Module shapes: modern `export default { id?, server }`; legacy: every named export treated as a plugin fn. File plugins must export `id`.
- Kill switches: `OPENCODE_PURE` (no external plugins), `OPENCODE_DISABLE_DEFAULT_PLUGINS` (no built-ins: codex/copilot/gitlab/poe/cloudflare/azure/digitalocean/snowflake/xai auth plugins).

## Tool ids on the wire (gateway whitelists)

Verified live on 1.18.4 by reading the host's own registry at `GET /experimental/tool/ids`, which is what gets serialized to the provider.

- The `tool` hook is `{[key: string]: ToolDefinition}` and **the key is the id sent to the provider**. Renaming is therefore a pure config concern — no feature module needs to know. overclock folds explicit renames + allowlist into one policy in `src/core/policy.ts` (re-exported via `src/tools.ts`) and applies it in the single `mergeHooks` chokepoint.
- Host built-ins observed on 1.18.4: `apply_patch bash edit glob grep invalid question read skill task todowrite webfetch websearch write`. A plugin tool registered under one of these **replaces** it in the final map (documented upstream behaviour, "a duplicate id overrides the built-in"). A name differing only by case (`Task` vs `task`) does not collide host-side — the host offers both — but a case-insensitive gateway sees one name twice.
- There is no per-request tool filter hook. `tool.definition` rewrites description/params of an existing tool but cannot rename or remove one, so withholding has to happen at registration.
- Permission ids (`ctx.ask({permission})`) are independent of the wire id and are deliberately left unrenamed: they key the user's opencode permission config.

## OpenCode Customization Surface

| Capability           | opencode native mechanism                      | Plugin / Extension role |
| -------------------- | ---------------------------------------------- | ----------------------- |
| Instructions         | `AGENTS.md`, `instructions` config             | hook injection          |
| Skills               | native skills directory discovery              | custom tool exposure    |
| Slash commands       | native `commands/**/*.md`                      | TUI command API         |
| Subagents            | native `agents/**/*.md`                        | agent execution hooks   |
| Event Interception   | plugin `event` hook                            | full event bus tap      |
| MCP Integration      | native `mcp` config                            | dynamic server tool use |
| Permission Rules     | native `permission` config                     | bash / tool gating      |
| Output Styles        | `experimental.chat.system.transform`           | system prompt rewriting |
| Statusline / Prompts | TUI plugin slots                               | custom slot rendering   |
| Memory               | none built-in                                  | external plugins        |
| Checkpoints          | native shadow-git snapshots + revert endpoints | native (core opencode)  |
| Sandboxing           | codemode sandboxing (JS only)                  | native permissions      |
| Custom Tools (JS/TS) | plugin `tool:{}` + `{tool,tools}/*.ts`         | full custom tools       |
| TUI Configuration    | separate `tui.json` + themes dirs              | `tui` plugin surface    |

Notes per capability:

- **Instructions** — reads `AGENTS.md`; nested AGENTS.md auto-attached when the read tool touches nearby files; `instructions` config accepts globs + URLs.
- **Skills** — native discovery in project skills directories. Skills auto-register as slash commands. Frontmatter: `name` and `description`.
- **Commands** — `{command,commands}/**/*.md` in config dirs + `command` config. Supports `$1..$N`, `$ARGUMENTS`, `` !`cmd` `` shell substitution, and `@file`.
- **Agents** — `{agent,agents}/**/*.md` + `agent` config; modes primary/subagent/all; built-ins build/plan/general/explore + hidden compaction/title/summary; `subagent_depth`.
- **Permissions** — ask/allow/deny with glob patterns, **last-match-wins**, per-agent overrides, bash tree-sitter command patterns (`git status *`), `OPENCODE_PERMISSION` env override, `--auto` flag.
- **Checkpoints** — shadow-git snapshots per worktree (`snapshot` config), session revert/unrevert endpoints, `/undo` `/redo`.
- **Sandboxing** — native codemode sandboxes model-authored JS only; bash calls rely on permission prompt.
- **TUI config** — `tui.json` (theme, keybinds, attention/sounds, scroll, mouse); themes from `themes/*.json` in config dirs.

opencode-only wins (exploit, no backport): params/headers hooks, history + system transforms, `tool.definition` rewrite, provider/auth hooks, JS custom tools, in-process SDK client, workspace adapters, TUI slots/routes/keymaps, `session.next.*` telemetry (cost/tokens per step), shadow-git snapshot API, v2 aisdk hook (wrap the LanguageModel itself).

## Tracking upstream drift

The interface is churning (v1 -> v2 migration underway). Watchlist — diff these on every bump of `@opencode-ai/plugin` npm `latest`:

| File                                              | What breaks if it changes                            |
| ------------------------------------------------- | ---------------------------------------------------- |
| `packages/plugin/src/index.ts`                    | v1 Hooks — our core surface (335 lines)              |
| `packages/plugin/src/tui.ts`                      | TUI plugin API                                       |
| `packages/plugin/src/tool.ts`                     | custom tool contract                                 |
| `packages/plugin/src/v2/**` + pkg `exports`       | v2 domains appearing (esp. tool/event/session)       |
| `packages/schema/src/event-manifest.ts`           | event names/payloads we subscribe to                 |
| `packages/sdk/openapi.json`                       | accurate payload shapes (v1 SDK gen is frozen)       |
| `packages/core/src/v1/config/{config,migrate}.ts` | config keys, migration signals (`plugin`->`plugins`) |
| `packages/opencode/src/plugin/index.ts`           | trigger semantics (order, errors, dir filter)        |

Mechanics:

- Pin: record the validated commit + plugin version at the top of this doc (done). Re-validate = shallow-clone at new `latest`, diff watchlist files against the pinned SHA, update doc + shim.
- Cheap detector: `npm view @opencode-ai/plugin version` in CI/cron; on change, `git diff <pinned>..<new> -- <watchlist>` and review. The whole hook surface is typed, so the diff IS the changelog.
- Early warning: npm dist-tags expose in-flight branches (`beta`, `dev`, `next`, `tui-v2`, `snapshot-memory`, …) — worth a periodic scan for names touching our surfaces.
- Known deprecation signals to expect: `session.idle` (deprecated -> will vanish; use `session.status`), v1 `plugin` config key (migrated to `plugins`), TUI `api.command` (deprecated for `api.keymap.registerLayer`), `permission.ask` hook (dead; may be deleted or revived — either changes our story), `permission.v2.*` / `question.v2.*` events superseding v1 names.
- Runtime guard for the shim: on plugin init, probe for the surfaces we depend on (e.g. `client.tui.showToast` exists, expected event types observed) and toast a warning instead of failing silently when upstream moves.
