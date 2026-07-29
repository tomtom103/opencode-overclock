import type { FeatureModule } from "../types.ts"

/**
 * Demo module. Proves wiring. Delete once first real backport lands.
 * Shape template for real modules: cc-hooks, stop-loop, claude-dir, memory, permission-rules.
 */
export const hello: FeatureModule = {
  name: "hello",
  defaultEnabled: false,
  async init(_ctx, _options) {
    return {
      event: async ({ event }) => {
        if (event.type === "session.created") console.log("[overclock] hello: session created")
      },
    }
  },
}
