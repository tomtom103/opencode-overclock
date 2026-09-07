import { describe, expect, test } from "bun:test"
import {
  checkDangerousCommand,
  resolvePatterns,
  safety,
  DANGEROUS_GIT_PATTERNS,
} from "../src/features/safety.ts"

describe("checkDangerousCommand", () => {
  const patterns = resolvePatterns()

  test("blocks git reset --hard", () => {
    const res = checkDangerousCommand("git reset --hard HEAD~1", patterns)
    expect(res).not.toBeNull()
    expect(res?.name).toBe("hard-reset")
  })

  test("blocks git push -f and git push --force", () => {
    expect(checkDangerousCommand("git push origin main --force", patterns)?.name).toBe("force-push")
    expect(checkDangerousCommand("git push origin main -f", patterns)?.name).toBe("force-push")
    expect(checkDangerousCommand("git push origin +main:main", patterns)?.name).toBe("force-push")
  })

  test("allows regular git push", () => {
    expect(checkDangerousCommand("git push origin main", patterns)).toBeNull()
    expect(checkDangerousCommand("git push", patterns)).toBeNull()
  })

  test("blocks git clean -fd", () => {
    expect(checkDangerousCommand("git clean -fd", patterns)?.name).toBe("force-clean")
    expect(checkDangerousCommand("git clean -f", patterns)?.name).toBe("force-clean")
  })

  test("blocks git branch -D", () => {
    expect(checkDangerousCommand("git branch -D my-feature", patterns)?.name).toBe("branch-force-delete")
    expect(checkDangerousCommand("git branch --delete --force feat", patterns)?.name).toBe(
      "branch-force-delete",
    )
  })

  test("allows git branch -d (safe delete)", () => {
    expect(checkDangerousCommand("git branch -d my-feature", patterns)).toBeNull()
  })

  test("blocks discarding all files via checkout or restore", () => {
    expect(checkDangerousCommand("git restore .", patterns)?.name).toBe("discard-all-worktree")
    expect(checkDangerousCommand("git checkout -- .", patterns)?.name).toBe("discard-all-worktree")
    expect(checkDangerousCommand("git checkout .", patterns)?.name).toBe("discard-all-worktree")
  })

  test("allows selective restore of single files", () => {
    expect(checkDangerousCommand("git restore src/button.ts", patterns)).toBeNull()
    expect(checkDangerousCommand("git checkout src/button.ts", patterns)).toBeNull()
  })

  test("blocks git stash drop and clear", () => {
    expect(checkDangerousCommand("git stash drop", patterns)?.name).toBe("stash-destroy")
    expect(checkDangerousCommand("git stash clear", patterns)?.name).toBe("stash-destroy")
  })

  test("blocks git rebase --skip", () => {
    expect(checkDangerousCommand("git rebase --skip", patterns)?.name).toBe("rebase-skip")
  })

  test("blocks chained commands containing dangerous operations", () => {
    expect(checkDangerousCommand("npm test && git reset --hard HEAD", patterns)?.name).toBe("hard-reset")
    expect(checkDangerousCommand("git status; git clean -f", patterns)?.name).toBe("force-clean")
  })

  test("blocks commands with git global flags and reordered arguments", () => {
    // global flags
    expect(checkDangerousCommand("git -C . reset --hard", patterns)?.name).toBe("hard-reset")
    expect(checkDangerousCommand("git -C /tmp push origin +main", patterns)?.name).toBe("force-push")
    expect(checkDangerousCommand("git -C . clean --force -d", patterns)?.name).toBe("force-clean")
    expect(checkDangerousCommand("git -C . branch -D feat", patterns)?.name).toBe("branch-force-delete")
    expect(checkDangerousCommand("git -C . push origin :branch", patterns)?.name).toBe(
      "remote-branch-delete",
    )
    expect(checkDangerousCommand("git -C . restore .", patterns)?.name).toBe("discard-all-worktree")
    expect(checkDangerousCommand("git -C . stash drop", patterns)?.name).toBe("stash-destroy")
    expect(checkDangerousCommand("git -C . rebase --skip", patterns)?.name).toBe("rebase-skip")

    // reordered arguments
    expect(checkDangerousCommand("git reset HEAD --hard", patterns)?.name).toBe("hard-reset")
    expect(checkDangerousCommand("git clean --force -d", patterns)?.name).toBe("force-clean")
    expect(checkDangerousCommand("git clean -df", patterns)?.name).toBe("force-clean")
    expect(checkDangerousCommand("git push origin +main", patterns)?.name).toBe("force-push")
    expect(checkDangerousCommand("git push origin -d branch", patterns)?.name).toBe(
      "remote-branch-delete",
    )
    expect(checkDangerousCommand("git checkout HEAD -- .", patterns)?.name).toBe("discard-all-worktree")
    expect(checkDangerousCommand("git checkout -f .", patterns)?.name).toBe("discard-all-worktree")
  })

  test("does not suffer from ReDoS when matching repeated flags", () => {
    const cmd = "git " + "-a ".repeat(40) + "status"
    const start = performance.now()
    const result = checkDangerousCommand(cmd, patterns)
    const elapsed = performance.now() - start
    expect(result).toBeNull()
    expect(elapsed).toBeLessThan(50)
  })
})

describe("resolvePatterns options", () => {
  test("allowForcePush removes force-push pattern", () => {
    const custom = resolvePatterns({ allowForcePush: true })
    expect(checkDangerousCommand("git push origin main -f", custom)).toBeNull()
    expect(checkDangerousCommand("git reset --hard", custom)?.name).toBe("hard-reset")
  })

  test("allowStashDrop removes stash-destroy pattern", () => {
    const custom = resolvePatterns({ allowStashDrop: true })
    expect(checkDangerousCommand("git stash drop", custom)).toBeNull()
  })

  test("customPatterns are added and checked", () => {
    const custom = resolvePatterns({
      customPatterns: [{ name: "drop-table", pattern: "\\bDROP\\s+TABLE\\b", reason: "Data loss" }],
    })
    expect(checkDangerousCommand("DROP TABLE users;", custom)?.name).toBe("drop-table")
  })
})

describe("safety feature module", () => {
  test("rewrites output.args.command on dangerous match", async () => {
    const toasts: string[] = []
    const ctx = {
      client: { tui: { showToast: async (opts: any) => toasts.push(opts.message) } },
      directory: "/tmp",
    } as any

    const hooks = await safety.init(ctx, {}, { busy: {} as any, toolName: (n) => n })
    expect(hooks["tool.execute.before"]).toBeDefined()

    const output = { args: { command: "git reset --hard HEAD" } }
    await hooks["tool.execute.before"]!({ tool: "bash", args: output.args } as any, output as any)

    expect(output.args.command).toContain("[overclock safety] Blocked destructive git command")
    expect(output.args.command).toContain("exit 1")
    expect(toasts.length).toBe(1)
  })

  test("rewritten command safely escapes shell expansions and substitutions", async () => {
    const ctx = {
      client: { tui: { showToast: async () => {} } },
      directory: "/tmp",
    } as any

    const hooks = await safety.init(ctx, {}, { busy: {} as any, toolName: (n) => n })
    const output = {
      args: { command: "git reset --hard $(echo INJECTED_EXECUTION >&2)" },
    }
    await hooks["tool.execute.before"]!({ tool: "bash", args: output.args } as any, output as any)

    const proc = Bun.spawn(["bash", "-c", output.args.command], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(1)
    expect(stderr).not.toContain("INJECTED_EXECUTION\n")
    expect(stderr).toContain("$(echo INJECTED_EXECUTION >&2)")
    expect(stderr).toContain("[overclock safety] Blocked destructive git command")
  })

  test("leaves safe commands untouched", async () => {
    const ctx = { client: {}, directory: "/tmp" } as any
    const hooks = await safety.init(ctx, {}, { busy: {} as any, toolName: (n) => n })

    const output = { args: { command: "git status" } }
    await hooks["tool.execute.before"]!({ tool: "bash", args: output.args } as any, output as any)

    expect(output.args.command).toBe("git status")
  })

  test("disabled when blockDestructiveGit is false", async () => {
    const ctx = { client: {}, directory: "/tmp" } as any
    const hooks = await safety.init(
      ctx,
      { blockDestructiveGit: false },
      { busy: {} as any, toolName: (n) => n },
    )
    expect(hooks["tool.execute.before"]).toBeUndefined()
  })
})
