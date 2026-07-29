import type { FeatureModule } from "../types.ts"
import { tasks } from "./tasks.ts"
import { sched } from "./sched.ts"
import { sandbox } from "./sandbox.ts"

/** Registry, ordered. Order = hook composition order. */
export const features: FeatureModule[] = [tasks, sched, sandbox]
