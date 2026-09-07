import type { FeatureModule } from "../types.ts"

/**
 * Buddy is a TUI-surface feature (src/buddy/, wired in src/tui.ts): an ASCII pet
 * beside the prompt. This server module registers no hooks or tools -- it exists
 * so buddy appears in the first-run capability summary.
 */
export const buddy: FeatureModule = {
  name: "buddy",
  defaultEnabled: true,
  async init() {
    return {}
  },
}
