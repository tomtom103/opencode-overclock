import type { FeatureModule } from "../types.ts"
import { hello } from "./hello.ts"

/**
 * Registry, ordered. Order = hook composition order.
 * Planned (see docs/roadmap.md): cc-hooks, stop-loop, claude-dir, memory, permission-rules.
 */
export const features: FeatureModule[] = [hello]
