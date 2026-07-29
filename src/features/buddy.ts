import type { FeatureModule } from "../types.ts"

/**
 * Buddy is a TUI-surface feature (src/buddy/, wired in src/tui.ts): an ASCII pet
 * beside the prompt. This server module registers no hooks or tools -- it exists
 * so `features.buddy` validates in overclock.json (one config file toggles both
 * surfaces) and the first-run summary mentions it.
 */
export const buddy: FeatureModule = {
  name: "buddy",
  defaultEnabled: true,
  async init() {
    return {}
  },
}
