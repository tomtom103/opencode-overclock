import { isAbsolute, relative } from "node:path"
import type { FeatureModule } from "../types.ts"
import { inject, toast } from "../lib/inject.ts"
import { execBash, redactSensitiveOutput, sanitizeEnv } from "../lib/exec.ts"

export interface GuardHook {
  name: string
  tools: string[]
  pathFilter?: string
  glob?: Bun.Glob
  run: string
  mode: "inject" | "append"
  debounceMs: number
  timeoutMs: number
  onSuccess: "silent" | "notify"
  /** inject mode: give up deferring past a busy session after this long, and report anyway. */
  maxDeferMs: number
}

export const EDIT_ERROR_PATTERNS = [
  "oldstring and newstring must be different",
  "oldstring not found",
  "found multiple matches for oldstring",
]

export const EDIT_RECOVERY_HINT =
  "\n\n[edit recovery hint]\nThe edit failed due to a content mismatch. Use the `read` tool to inspect the latest file state around the target lines before retrying the edit."

export interface FloorGuardOptions {
  allowSkips?: boolean
  allowSuppressions?: boolean
  allowAssertionRemoval?: boolean
  [key: string]: unknown
}

export interface FloorViolationPattern {
  name: string
  pattern: RegExp
  description: string
  testFileOnly?: boolean
}

export const FLOOR_VIOLATIONS: FloorViolationPattern[] = [
  {
    name: "test-skip-js",
    pattern:
      /(?:^|[.\s])(?:skip\s*\(|xit\s*\(|xdescribe\s*\()|\b(?:test\.skip|it\.skip|describe\.skip)\b/,
    description: "Skipping test execution (.skip / xit / xdescribe)",
    testFileOnly: true,
  },
  {
    name: "test-skip-python",
    pattern: /@pytest\.mark\.skip|@unittest\.skip/,
    description: "Skipping test execution (@pytest.mark.skip / @unittest.skip)",
    testFileOnly: true,
  },
  {
    name: "test-skip-go",
    pattern: /\bt\.Skip(?:\(|f\()/,
    description: "Skipping test execution (t.Skip)",
    testFileOnly: true,
  },
  {
    name: "test-skip-rust",
    pattern: /#\[ignore(?:\s*=.*)?\]/,
    description: "Skipping test execution (#[ignore])",
    testFileOnly: true,
  },
  {
    name: "ts-suppression",
    pattern:
      /\/\/\s*@ts-(?:ignore|nocheck)\b|\/\*\s*@ts-(?:ignore|nocheck)\s*\*\/|\{\s*\/\*\s*@ts-(?:ignore|nocheck)\s*\*\/\s*\}/,
    description: "TypeScript error suppression (@ts-ignore / @ts-nocheck)",
  },
  {
    name: "eslint-suppression",
    pattern: /\/\*?\s*eslint-disable(?:-next-line)?\b/,
    description: "ESLint diagnostic suppression (eslint-disable)",
  },
  {
    name: "python-suppression",
    pattern: /#\s*(?:noqa|type:\s*ignore)\b/,
    description: "Python diagnostic suppression (# noqa / # type: ignore)",
  },
  {
    name: "empty-catch",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    description: "Empty catch block swallowing errors silently",
  },
]

export const ASSERTION_PATTERN =
  /\b(?:expect\s*\(|assert\b|assert\.[a-zA-Z]+|assertEquals|assertTrue|assertFalse|self\.assert)/

export function isTestFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replaceAll("\\", "/")
  const segments = normalized.split("/")
  const filename = segments[segments.length - 1] ?? ""

  return (
    filename.includes(".test.") ||
    filename.includes(".spec.") ||
    segments.includes("test") ||
    segments.includes("tests") ||
    segments.includes("__tests__") ||
    filename.endsWith("_test.go") ||
    filename.endsWith("_test.py") ||
    filename.endsWith("_spec.rb") ||
    filename.startsWith("test_")
  )
}

export function checkFloorViolation(
  tool: string,
  args: Record<string, unknown> | undefined,
  options: FloorGuardOptions = {},
  resolveTool?: (name: string) => string,
): string | null {
  // Resolve renamed tools both ways: hook may see the model-visible name
  // (e.g. "my_edit") while config declares "edit", or vice versa.
  const toolLower = tool.toLowerCase()
  const candidates = new Set([toolLower])
  if (resolveTool) {
    for (const declared of ["edit", "write", "apply_patch"]) {
      const visible = resolveTool(declared).toLowerCase()
      candidates.add(visible)
      // If input matches a visible name, also accept the declared name
      if (visible === toolLower) candidates.add(declared)
    }
  }
  const isEdit = candidates.has("edit")
  const isWrite = candidates.has("write")
  const isApplyPatch = candidates.has("apply_patch")
  if (!isEdit && !isWrite && !isApplyPatch) return null
  if (!args) return null

  const filePath =
    typeof args.filePath === "string"
      ? args.filePath
      : typeof args.path === "string"
        ? args.path
        : typeof args.file_path === "string"
          ? args.file_path
          : ""

  const isTest = isTestFile(filePath)

  if (isEdit) {
    const oldStr = typeof args.oldString === "string" ? args.oldString : ""
    const newStr = typeof args.newString === "string" ? args.newString : ""

    for (const v of FLOOR_VIOLATIONS) {
      if (v.testFileOnly && !isTest) continue
      if (v.testFileOnly && options.allowSkips) continue
      if (!v.testFileOnly && options.allowSuppressions) continue

      if (v.pattern.test(newStr) && !v.pattern.test(oldStr)) {
        return `Detected ${v.description} in ${filePath || "edited file"}. Modifying code to bypass tests or suppress warnings is prohibited by floor-guard policy. Fix the underlying issue instead.`
      }
    }

    if (!options.allowAssertionRemoval && isTest) {
      if (
        ASSERTION_PATTERN.test(oldStr) &&
        !ASSERTION_PATTERN.test(newStr) &&
        newStr.trim().length > 0
      ) {
        return `Stripped test assertion(s) from ${filePath || "test file"} without replacement. Deleting assertions to make tests pass is prohibited by floor-guard policy. Fix the implementation to satisfy the assertion.`
      }
    }
  } else if (isWrite || isApplyPatch) {
    const content =
      typeof args.content === "string"
        ? args.content
        : // apply_patch-style payloads carry the new file text under various keys
          typeof args.newString === "string"
          ? args.newString
          : typeof args.text === "string"
            ? args.text
            : typeof args.patch === "string"
              ? args.patch
              : ""

    for (const v of FLOOR_VIOLATIONS) {
      if (v.testFileOnly && !isTest) continue
      if (v.testFileOnly && options.allowSkips) continue
      if (!v.testFileOnly && options.allowSuppressions) continue

      if (v.pattern.test(content)) {
        return `Detected ${v.description} in ${filePath || "written file"}. Introducing test skips or error suppressions is prohibited by floor-guard policy.`
      }
    }
  }

  return null
}

export function checkEditFailure(tool: string, outputText: string): string | null {
  if (tool.toLowerCase() !== "edit") return null
  const lower = outputText.toLowerCase()
  if (EDIT_ERROR_PATTERNS.some((p) => lower.includes(p))) {
    return EDIT_RECOVERY_HINT
  }
  return null
}

export const GUARD_RECIPES: Record<string, Omit<GuardHook, "glob">> = {
  tsc: {
    name: "tsc",
    tools: ["edit", "write"],
    pathFilter: "**/*.{ts,tsx}",
    run: "bun x tsc --noEmit || npx tsc --noEmit",
    mode: "inject",
    debounceMs: 2000,
    timeoutMs: 60000,
    onSuccess: "silent",
    maxDeferMs: 300000,
  },
  eslint: {
    name: "eslint",
    tools: ["edit", "write"],
    pathFilter: "**/*.{js,jsx,ts,tsx}",
    run: "bun x eslint . || npx eslint .",
    mode: "inject",
    debounceMs: 2000,
    timeoutMs: 60000,
    onSuccess: "silent",
    maxDeferMs: 300000,
  },
  ruff: {
    name: "ruff",
    tools: ["edit", "write"],
    pathFilter: "**/*.py",
    run: "ruff check .",
    mode: "inject",
    debounceMs: 2000,
    timeoutMs: 60000,
    onSuccess: "silent",
    maxDeferMs: 300000,
  },
  cargo: {
    name: "cargo",
    tools: ["edit", "write"],
    pathFilter: "**/*.rs",
    run: "cargo check",
    mode: "inject",
    debounceMs: 2000,
    timeoutMs: 60000,
    onSuccess: "silent",
    maxDeferMs: 300000,
  },
  go: {
    name: "go",
    tools: ["edit", "write"],
    pathFilter: "**/*.go",
    run: "go test ./...",
    mode: "inject",
    debounceMs: 2000,
    timeoutMs: 60000,
    onSuccess: "silent",
    maxDeferMs: 300000,
  },
}

export async function detectRecipes(directory: string): Promise<GuardHook[]> {
  const detected: GuardHook[] = []
  if (await Bun.file(`${directory}/tsconfig.json`).exists()) {
    detected.push({ ...GUARD_RECIPES.tsc, glob: new Bun.Glob("**/*.{ts,tsx}") })
  }
  if (await Bun.file(`${directory}/Cargo.toml`).exists()) {
    detected.push({ ...GUARD_RECIPES.cargo, glob: new Bun.Glob("**/*.rs") })
  }
  if (
    (await Bun.file(`${directory}/pyproject.toml`).exists()) ||
    (await Bun.file(`${directory}/ruff.toml`).exists())
  ) {
    detected.push({ ...GUARD_RECIPES.ruff, glob: new Bun.Glob("**/*.py") })
  }
  if (await Bun.file(`${directory}/go.mod`).exists()) {
    detected.push({ ...GUARD_RECIPES.go, glob: new Bun.Glob("**/*.go") })
  }
  return detected
}

/**
 * Patterns matching dangerous command idioms that are inappropriate for quality-gate hooks,
 * such as reverse shells, remote script piping, and arbitrary socket relays.
 */
export const DANGEROUS_COMMAND_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\/dev\/(?:tcp|udp)\//i, reason: "network socket redirection (/dev/tcp or /dev/udp)" },
  { pattern: /\bmkfifo\b/i, reason: "named pipe creation (mkfifo)" },
  {
    pattern: /\b(?:nc|netcat)\b.*(?:\s+-e\s+|\s+-c\s+)/i,
    reason: "netcat remote command execution flag (-e/-c)",
  },
  {
    pattern: /\b(?:curl|wget|fetch)\b.*\|\s*(?:bash|sh|zsh|python|perl|ruby)\b/i,
    reason: "remote script execution via pipe (curl/wget | shell)",
  },
  {
    pattern: /\bbase64\s+(?:-d|--decode)\b.*\|\s*(?:bash|sh|zsh)\b/i,
    reason: "encoded payload execution via pipe (base64 -d | shell)",
  },
  { pattern: /\bbash\s+-i\b.*>&/i, reason: "interactive reverse shell redirection (bash -i >&)" },
  { pattern: /\bsocat\s+/i, reason: "socket relay execution (socat)" },
]

/**
 * Validates a hook command string against dangerous patterns.
 * Returns the rejection reason or null if valid.
 */
export function validateHookCommand(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return reason
    }
  }
  return null
}

/** Maximum character length of failure payload tail to prevent prompt flooding. */
export const MAX_FAILURE_PAYLOAD_CHARS = 4000

/** options.hooks -> validated GuardHook[]. Invalid entries -> console.warn, skipped, never throw. */
export function parseHooks(raw: unknown): GuardHook[] {
  if (!Array.isArray(raw)) return []
  const hooks: GuardHook[] = []
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>
    const validTools =
      Array.isArray(e.tools) && e.tools.length > 0 && e.tools.every((t) => typeof t === "string")
    if (typeof e.name !== "string" || !e.name || !validTools || typeof e.run !== "string" || !e.run) {
      console.warn(`[overclock] guard: skipping invalid hook config: ${JSON.stringify(entry)}`)
      continue
    }

    const danger = validateHookCommand(e.run)
    if (danger) {
      console.warn(`[overclock] guard: rejecting unsafe hook "${e.name}": ${danger}`)
      continue
    }

    const pathFilter = typeof e.pathFilter === "string" ? e.pathFilter : undefined
    if (pathFilter && pathFilter.includes("..")) {
      console.warn(`[overclock] guard: rejecting hook "${e.name}": pathFilter cannot contain ".."`)
      continue
    }

    hooks.push({
      name: e.name,
      tools: e.tools as string[],
      pathFilter,
      glob: pathFilter ? new Bun.Glob(pathFilter) : undefined,
      run: e.run,
      mode: e.mode === "append" ? "append" : "inject",
      debounceMs: typeof e.debounceMs === "number" ? Math.max(50, Math.min(e.debounceMs, 60000)) : 2000,
      timeoutMs: typeof e.timeoutMs === "number" ? Math.max(100, Math.min(e.timeoutMs, 300000)) : 60000,
      onSuccess: e.onSuccess === "notify" ? "notify" : "silent",
      maxDeferMs:
        typeof e.maxDeferMs === "number" ? Math.max(1000, Math.min(e.maxDeferMs, 600000)) : 300000,
    })
  }
  return hooks
}

/** tools: exact match or mapped name. pathFilter set + no filePath -> no match. */
export function matchHook(
  hook: GuardHook,
  toolName: string,
  filePath: string | undefined,
  resolveTool?: (name: string) => string,
  cwd?: string,
): boolean {
  const matches = hook.tools.some((t) => {
    if (t === toolName) return true
    if (resolveTool && resolveTool(t) === toolName) return true
    return false
  })
  if (!matches) return false
  if (!hook.pathFilter) return true
  if (typeof filePath !== "string") return false

  const glob = hook.glob ?? new Bun.Glob(hook.pathFilter)
  const normalized = filePath.replaceAll("\\", "/")
  if (glob.match(normalized)) return true

  if (cwd && isAbsolute(normalized)) {
    const rel = relative(cwd, normalized).replaceAll("\\", "/")
    if (glob.match(rel)) return true
  }

  return false
}

/** `[guard "<name>" failed (exit <code>)]` + sanitized last 40 lines of combined stdout+stderr. */
export function failurePayload(name: string, code: number | null, combined: string): string {
  const sanitized = redactSensitiveOutput(combined)
  let tail = sanitized.split("\n").slice(-40).join("\n")
  if (tail.length > MAX_FAILURE_PAYLOAD_CHARS) {
    tail = tail.slice(-MAX_FAILURE_PAYLOAD_CHARS) + "\n... [truncated for security & length]"
  }
  return `\n\n[guard "${name}" failed (exit ${code})]\n${tail}`
}

function buildEnv(toolName: string, filePath: string | undefined): Record<string, string | undefined> {
  return {
    ...sanitizeEnv(process.env),
    GUARD_TOOL: toolName,
    ...(filePath !== undefined ? { GUARD_FILE: filePath } : {}),
  }
}

async function runCommand(
  hook: GuardHook,
  cwd: string,
  env: Record<string, string | undefined>,
  register?: (proc: Bun.Subprocess) => void,
): Promise<{ code: number | null; combined: string }> {
  return execBash(hook.run, {
    cwd,
    env,
    timeoutMs: hook.timeoutMs,
    onSpawn: register,
    sanitizeEnv: true,
  })
}

interface HookState {
  timer?: ReturnType<typeof setTimeout>
  running: boolean
  lastSessionID?: string
  lastToolName: string
  lastFilePath?: string
  procs: Set<Bun.Subprocess>
  /** when the current run of deferrals started, for the maxDeferMs cap */
  deferredSince?: number
  /** last payload actually injected, to avoid re-reporting a standing failure */
  lastInjectedPayload?: string
}

export interface GuardRunnerDeps {
  cwd: string
  onInject: (sessionID: string, payload: string) => Promise<void>
  onNotify: (hookName: string) => Promise<void>
  /** omitted -> never busy, i.e. the old always-inject behaviour */
  isBusy?: (sessionID: string) => boolean
}

export interface GuardRunner {
  /** append mode: run synchronously, return failure payload (undefined on success). */
  runAppend(hook: GuardHook, toolName: string, filePath: string | undefined): Promise<string | undefined>
  /** inject mode: (re)arm the trailing debounce for this hook. */
  triggerInject(hook: GuardHook, sessionID: string, toolName: string, filePath: string | undefined): void
  dispose(): void
}

/** Exported for tests: debounce/run core decoupled from plugin ctx. */
export function createGuardRunner(deps: GuardRunnerDeps): GuardRunner {
  const states = new Map<string, HookState>()

  function state(name: string): HookState {
    let s = states.get(name)
    if (!s) {
      s = { running: false, lastToolName: "", procs: new Set() }
      states.set(name, s)
    }
    return s
  }

  async function runAppend(
    hook: GuardHook,
    toolName: string,
    filePath: string | undefined,
  ): Promise<string | undefined> {
    const s = state(hook.name)
    const result = await runCommand(hook, deps.cwd, buildEnv(toolName, filePath), (p) => s.procs.add(p))
    s.procs.clear()
    if (result.code !== 0) return failurePayload(hook.name, result.code, result.combined)
    if (hook.onSuccess === "notify") await deps.onNotify(hook.name)
    return undefined
  }

  async function fire(hook: GuardHook): Promise<void> {
    const s = state(hook.name)
    if (s.running) {
      // still mid-run: skip this launch, re-arm the trailing debounce
      s.timer = setTimeout(() => void fire(hook), hook.debounceMs)
      return
    }
    const sessionID = s.lastSessionID
    // Agent still mid-turn: the tree is in flux, so any verdict we reach now may already be
    // stale by the time it's read. Re-arm instead. The recheck doubles as dedup -- if the
    // agent fixed the fault itself, the later run exits 0 and we stay silent.
    if (sessionID && deps.isBusy?.(sessionID)) {
      s.deferredSince ??= Date.now()
      if (Date.now() - s.deferredSince < hook.maxDeferMs) {
        s.timer = setTimeout(() => void fire(hook), hook.debounceMs)
        return
      }
      // deferred too long -- session may be wedged. Report anyway rather than never.
    }
    s.deferredSince = undefined
    s.running = true
    const toolName = s.lastToolName
    const filePath = s.lastFilePath
    try {
      const result = await runCommand(hook, deps.cwd, buildEnv(toolName, filePath), (p) =>
        s.procs.add(p),
      )
      if (result.code !== 0) {
        const payload = failurePayload(hook.name, result.code, result.combined)
        // Backstop to the idle gate above: a fault the agent can't fix would otherwise
        // re-inject on every idle cycle forever. Report transitions, not standing state.
        // Exact-match is deliberately conservative -- it only ever suppresses a report
        // that is byte-identical to the one the agent has already seen and failed to clear.
        if (sessionID && payload !== s.lastInjectedPayload) {
          await deps.onInject(sessionID, payload)
          s.lastInjectedPayload = payload
        }
      } else {
        s.lastInjectedPayload = undefined
        if (hook.onSuccess === "notify") await deps.onNotify(hook.name)
      }
    } finally {
      s.running = false
      s.procs.clear()
    }
  }

  function triggerInject(
    hook: GuardHook,
    sessionID: string,
    toolName: string,
    filePath: string | undefined,
  ): void {
    const s = state(hook.name)
    s.lastSessionID = sessionID
    s.lastToolName = toolName
    s.lastFilePath = filePath
    if (s.timer) clearTimeout(s.timer)
    s.timer = setTimeout(() => void fire(hook), hook.debounceMs)
  }

  function dispose(): void {
    for (const s of states.values()) {
      if (s.timer) clearTimeout(s.timer)
      for (const p of s.procs) {
        try {
          p.kill("SIGTERM")
          const hard = setTimeout(() => {
            try {
              p.kill("SIGKILL")
            } catch {}
          }, 1000)
          hard.unref?.()
        } catch {}
      }
    }
  }

  return { runAppend, triggerInject, dispose }
}

/**
 * User-configurable post-tool hooks. Run commands after matching tool calls. No config -> inert.
 * "append": run synchronously, failure appended to tool output in place.
 * "inject" (default): debounced per hook name, failure injected as a user turn once the
 * session goes idle. Firing mid-turn doesn't interrupt (promptAsync queues), but each
 * fire queues its own turn, so a burst of edits stacks several reports of a fault the
 * agent was already fixing -- and reports it from a tree that was still being edited.
 */
export const guard: FeatureModule = {
  name: "guard",
  tools: [],
  defaultEnabled: true,
  requires: ["session.promptAsync", "session.messages"],
  async init(ctx, options, shared) {
    if (options.hooks !== undefined && !Array.isArray(options.hooks)) {
      console.warn(`[overclock] guard: options.hooks must be an array, got ${typeof options.hooks}`)
    }
    const hooks = parseHooks(options.hooks)
    if (Array.isArray(options.recipes)) {
      for (const r of options.recipes) {
        if (typeof r === "string" && GUARD_RECIPES[r]) {
          const recipe = GUARD_RECIPES[r]
          hooks.push({
            ...recipe,
            glob: recipe.pathFilter ? new Bun.Glob(recipe.pathFilter) : undefined,
          })
        }
      }
    }
    if (options.auto === true) {
      const autoHooks = await detectRecipes(ctx.directory)
      hooks.push(...autoHooks)
    }

    const floorGuardEnabled =
      options.floorGuard === true ||
      options.auto === true ||
      (typeof options.floorGuard === "object" && options.floorGuard !== null)
    const floorGuardOpts: FloorGuardOptions =
      typeof options.floorGuard === "object" && options.floorGuard !== null
        ? (options.floorGuard as FloorGuardOptions)
        : {}

    const editRecovery =
      options.editRecovery === true || (hooks.length > 0 && options.editRecovery !== false)
    if (hooks.length === 0 && !editRecovery && !floorGuardEnabled) return {}

    const runner =
      hooks.length > 0
        ? createGuardRunner({
            cwd: ctx.directory,
            onInject: async (sessionID, payload) => {
              await inject(ctx.client, sessionID, payload)
            },
            onNotify: async (hookName) => {
              await toast(ctx.client, `guard "${hookName}" passed`, "success")
            },
            isBusy: (sessionID) => shared.busy.isBusy(sessionID),
          })
        : undefined

    return {
      dispose: async () => {
        runner?.dispose()
      },
      "tool.execute.after": async (input, output) => {
        if (editRecovery && typeof output.output === "string") {
          const hint = checkEditFailure(input.tool, output.output)
          if (hint) output.output += hint
        }

        if (floorGuardEnabled && typeof output.output === "string") {
          const violation = checkFloorViolation(
            input.tool,
            input.args as Record<string, unknown> | undefined,
            floorGuardOpts,
            shared?.toolName,
          )
          if (violation) {
            output.output += `\n\n[overclock floor-guard warning]\n${violation}`
            void toast(ctx.client, "guard: floor-guard violation detected", "warning")
          }
        }

        if (!runner || hooks.length === 0) return

        const args = input.args as Record<string, unknown> | undefined
        const filePath =
          typeof args?.filePath === "string"
            ? args.filePath
            : typeof args?.path === "string"
              ? args.path
              : typeof args?.file_path === "string"
                ? args.file_path
                : undefined

        for (const hook of hooks) {
          if (!matchHook(hook, input.tool, filePath, shared?.toolName, ctx.directory)) continue
          if (hook.mode === "append") {
            const payload = await runner.runAppend(hook, input.tool, filePath)
            if (payload && typeof output.output === "string") output.output += payload
          } else {
            runner.triggerInject(hook, input.sessionID, input.tool, filePath)
          }
        }
      },
    }
  },
}
