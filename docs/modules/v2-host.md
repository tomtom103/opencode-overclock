# Embedded V2 Plugin Host (`v2-host`)

OpenCode is actively transitioning from its legacy V1 plugin specification (`Hooks` return objects, execution interception hooks) to its V2 architecture (`setup(context)` with domain transforms on `agent`, `command`, `skill`, `catalog`, `reference`, `aisdk`).

However, standard OpenCode V1 installations cannot natively load V2 plugins (which export `{ id, setup }` or `{ id, effect }` instead of a server function).

Overclock embeds a complete, in-process **V2 Plugin Host Engine** that runs modern V2 plugins side-by-side with V1 power tools on current OpenCode installations.

---

## The Dual-Architecture Bridge

```
┌────────────────────────────────────────────────────────┐
│               EXTERNAL V2 PLUGIN ARTIFACT              │
│       export default { id: "my-plugin", setup(ctx) }   │
└──────────────────────────┬─────────────────────────────┘
                           │ loaded via options.plugins
┌──────────────────────────▼─────────────────────────────┐
│             OVERCLOCK EMBEDDED V2 HOST                 │
│  Synthesizes a spec-compliant PluginContext:           │
│  • agent.transform    • command.transform              │
│  • catalog.transform  • reference.transform            │
│  • aisdk.sdk          • plugin.add / remove            │
└──────────────────────────┬─────────────────────────────┘
                           │ adapts transforms to live hooks
┌──────────────────────────▼─────────────────────────────┐
│                 OPENCODE V1 RUNTIME                    │
│  • config(cfg) hook mutates live agents & commands     │
│  • experimental.chat.system.transform injects refs    │
│  • chat.params hook executes AI-SDK middlewares        │
│  • All Overclock V1 tools & event listeners active     │
└────────────────────────────────────────────────────────┘
```

---

## Loading External V2 Plugins

To load V2 plugins into your OpenCode session, add them to `plugins` in your `opencode.json`:

```jsonc
{
  "plugin": [
    [
      "opencode-overclock",
      {
        "plugins": [
          // Local TypeScript or JavaScript plugin file:
          "./plugins/custom-agent.ts",
          // NPM package with options:
          ["opencode-plugin-analytics", { "strict": true }],
        ],
      },
    ],
  ],
}
```

Overclock dynamically resolves each plugin, detects whether it uses a Promise-based (`setup`) or Effect-based (`effect`) interface, instantiates a synthetic context, and executes its registrations.

---

## Domain Transform Adaptation

Overclock maps V2 domain transforms directly into V1 runtime lifecycle points:

| V2 Domain Transform         | Adapted V1 Lifecycle Point           | Runtime Behavior                                                         |
| :-------------------------- | :----------------------------------- | :----------------------------------------------------------------------- |
| **`agent.transform`**       | `config(cfg)`                        | Updates or introduces custom agent configurations and prompts.           |
| **`command.transform`**     | `config(cfg)`                        | Registers slash commands and templates in the command registry.          |
| **`catalog.transform`**     | `config(cfg)`                        | Mutates model catalog definitions and default model selections.          |
| **`reference.transform`**   | `experimental.chat.system.transform` | Injects local or remote documentation references into the system prompt. |
| **`aisdk.sdk`**             | `chat.params`                        | Executes AI-SDK middleware transforms before LLM invocation.             |
| **`skill.transform`**       | `skills.paths`                       | Discovers and exposes additional skill directories.                      |
| **`plugin.add` / `remove`** | Host Scope Manager                   | Allows nested plugins to register sub-plugins with automatic disposal.   |

---

## Authoring Hybrid V1/V2 Plugins with `createHybridPlugin`

For plugin authors who want their own extensions to run natively on both OpenCode V1 and OpenCode V2 hosts, Overclock exposes the `createHybridPlugin` helper (`src/bridge.ts`):

```typescript
import { createHybridPlugin } from "opencode-overclock/bridge"

export default createHybridPlugin({
  id: "my-hybrid-extension",

  // Runs on OpenCode V1:
  server: async (input, options) => {
    return {
      tool: {
        my_tool: ...
      }
    }
  },

  // Runs on OpenCode V2:
  setup: async (context, options) => {
    context.agent?.transform?.(async (draft) => {
      draft.update("custom-worker", (worker) => {
        worker.description = "A specialized worker agent"
      })
    })
  }
})
```

The resulting export:

1. Is a callable function `(input, options) => Promise<Hooks>` (satisfies the V1 callable loader).
2. Has `.server` property (satisfies the V1 object specification).
3. Has `.setup` property (satisfies the V2 specification).
