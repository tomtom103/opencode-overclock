# ADR-0001: Implement Hybrid V1/V2 Bridge and Embedded V2 Host Engine

- **Status:** Accepted
- **Date:** 2026-09-07
- **Deciders:** Principal Architecture & Core Engine Maintainers

## Context & Problem Statement

OpenCode is actively undergoing an architectural transition from its V1 plugin specification (`Hooks` return object, execution interception hooks like `tool.execute.before/after`, `event` bus) to its V2 plugin architecture (`setup(context)` with domain transforms on `agent`, `command`, `skill`, `catalog`, `reference`, `aisdk`).

This presents two distinct operational challenges for Overclock:

1. **Host Migration & Dual Conformity:** Overclock must run seamlessly whether installed on an OpenCode V1 runtime or an incoming OpenCode V2 host, without requiring separate packages or fork maintenance.
2. **Ecosystem Compatibility:** Third-party plugins written for OpenCode V2 export `{ id, setup }` or `{ id, effect }` and fail silently or crash when loaded directly by OpenCode V1 distributions. Users need a way to run modern V2 plugins alongside battle-tested V1 tools and event-driven power power-ups.

## Considered Options

1. **Option A: Pure V1 Plugin (Wait for Upstream V2 Transition):** Remain strictly on V1 hooks (`export default { id, server }`). Refuse to support V2 plugins or V2 transforms until OpenCode V2 is universally released and standard.
2. **Option B: Hard Fork into Two Packages (`opencode-overclock-v1` and `v2`):** Split Overclock into two independent npm distributions targeting different engine versions.
3. **Option C: Hybrid Bridge & Embedded In-Process V2 Host Engine:**
   - Implement `createHybridPlugin` (`src/core/bridge.ts`) returning an object that conforms to V1 callable loader, `{ id, server }` export, and `{ id, setup }` export simultaneously.
   - Implement an embedded, spec-compliant V2 host engine (`src/v2/host.ts`, `src/v2/context.ts`, `src/v2/loader.ts`) that synthesizes a `PluginContext`, adapts V2 domain transforms to live V1 hooks (`config`, `chat.params`, `experimental.chat.system.transform`), and executes V2 plugins side-by-side with V1 power tools.

## Decision Outcome

Chosen option: **Option C**, because it delivers immediate zero-friction interoperability, protects user investments, and enables bleeding-edge V2 plugin development on current OpenCode distributions.

### Positive Consequences

- **Single Dual-Conforming Artifact:** A single npm distribution runs unmodified on OpenCode V1 and OpenCode V2 hosts.
- **Immediate V2 Plugin Loading:** Users can configure external V2 plugins (e.g. `./plugins/my-agent.ts` or npm packages) in `opencode.json` under `plugins: [...]`, which Overclock loads, adapts, and executes in-process.
- **Domain Transform Translation:**
  - `agent.transform`, `command.transform`, and `catalog.transform` are mapped cleanly to V1's `config` mutation hook.
  - `reference.transform` (local or git references) is adapted into `experimental.chat.system.transform`.
  - `aisdk.sdk` middleware transforms are executed during V1's `chat.params` hook before LLM invocation.
- **Resource Lifecycle Parity:** The embedded host manages scope ownership and teardown, disposing all nested plugins when the session shuts down.

### Negative Consequences & Accepted Costs

- **Runtime Complexity:** Maintaining a synthetic `PluginContext` requires tracking upstream schema evolution in `@opencode-ai/plugin/v2` (`docs/architecture/opencode-plugin-surface.md`).
- **Feature Gap Emulation:** V2 does not yet specify tool execution interception hooks (`tool.execute.before/after`) or typed event bus listeners; those remain handled exclusively by V1 hooks.
- **In-Memory Transformation Overhead:** Adapting multiple V2 transform drafts during the V1 `config` phase adds a slight synchronous CPU cost during session initialization.

## Compliance & Invariants

- **Dual Module Export:** `createHybridPlugin` must always provide `v1Runner` as a callable function and as `.server`, alongside `.setup` for V2 hosts (`src/core/bridge.ts`).
- **Isolation of Unsafe Plugins:** When dynamic loading of a V2 plugin fails via `options.plugins`, the host engine must log a warning and skip the failed plugin without crashing the overarching Overclock server session (`src/v2/loader.ts`).
- **Automated Verification:** Verified continuously by `test/bridge.test.ts` and `test/v2-host.test.ts`.
