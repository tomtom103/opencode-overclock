import type { OverclockConfig } from "./types.ts"

const CONFIG_PATHS = [".opencode/overclock.json", "overclock.json"]

/** Load plugin config from project dir. Missing file -> {} (all defaults). */
export async function loadConfig(directory: string): Promise<OverclockConfig> {
  for (const rel of CONFIG_PATHS) {
    const file = Bun.file(`${directory}/${rel}`)
    if (await file.exists()) {
      try {
        return (await file.json()) as OverclockConfig
      } catch (e) {
        console.warn(`[overclock] bad config ${rel}: ${e}`)
        return {}
      }
    }
  }
  return {}
}
