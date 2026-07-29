import type { FeatureModule } from "../types.ts"
import { tasks } from "./tasks.ts"
import { sched } from "./sched.ts"
import { sandbox } from "./sandbox.ts"
import { guard } from "./guard.ts"
import { usage } from "./usage.ts"
import { checkpoints } from "./checkpoints.ts"
import { buddy } from "./buddy.ts"

/** Registry, ordered. Order = hook composition order. */
export const features: FeatureModule[] = [tasks, sched, sandbox, guard, usage, checkpoints, buddy]
