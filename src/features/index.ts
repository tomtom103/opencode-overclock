import type { FeatureModule } from "../types.ts"
import { safety } from "./safety.ts"
import { workflow } from "./workflow.ts"
import { tasks } from "./tasks.ts"
import { sched } from "./sched.ts"
import { guard } from "./guard.ts"
import { usage } from "./usage.ts"
import { buddy } from "./buddy.ts"
import { truncator } from "./truncator.ts"
import { recovery } from "./recovery.ts"

/**
 * Registry, ordered. Order = hook composition order.
 */
export const features: FeatureModule[] = [
  safety,
  workflow,
  tasks,
  sched,
  guard,
  usage,
  buddy,
  truncator,
  recovery,
]
