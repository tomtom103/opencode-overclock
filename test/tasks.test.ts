import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { createTaskManager, type TaskRecord, type TaskManager } from "../src/features/tasks.ts"

const logDir = () => mkdtempSync(`${tmpdir()}/overclock-test-`)

/** run cmd, resolve on exit */
function runToExit(
  command: string,
  opts: { timeoutMs?: number; kill?: boolean } = {},
): Promise<{ rec: TaskRecord; mgr: TaskManager }> {
  return new Promise((resolve) => {
    const mgr: TaskManager = createTaskManager({
      logDir: logDir(),
      onExit: (rec) => resolve({ rec, mgr }),
    })
    const t = mgr.run({
      command,
      description: "test",
      cwd: "/tmp",
      sessionID: "s1",
      timeoutMs: opts.timeoutMs,
    })
    if (opts.kill) mgr.kill(t.id)
  })
}

describe("createTaskManager", () => {
  test("runs and reports clean exit", async () => {
    const { rec } = await runToExit("echo hello")
    expect(rec.status).toBe("exited")
    expect(rec.exitCode).toBe(0)
    expect(rec.sessionID).toBe("s1")
  })

  test("output tails log", async () => {
    const { rec, mgr } = await runToExit("printf 'a\\nb\\nc\\n'")
    const out = await mgr.output(rec.id, 2)
    expect(out).toContain("b")
    expect(out).toContain("c")
    expect(out).not.toContain("a\n")
  })

  test("nonzero exit code captured", async () => {
    const { rec } = await runToExit("exit 3")
    expect(rec.exitCode).toBe(3)
    expect(rec.status).toBe("exited")
  })

  test("kill marks killed", async () => {
    const { rec } = await runToExit("sleep 30", { kill: true })
    expect(rec.status).toBe("killed")
  })

  test("timeout auto-kills", async () => {
    const { rec } = await runToExit("sleep 30", { timeoutMs: 100 })
    expect(rec.status).toBe("killed")
  })

  test("status listing", async () => {
    const mgr = createTaskManager({ logDir: logDir() })
    const t = mgr.run({ command: "sleep 5", description: "listed", cwd: "/tmp", sessionID: "s2" })
    expect(mgr.list().map((x) => x.id)).toContain(t.id)
    expect(mgr.get(t.id)?.status).toBe("running")
    mgr.killAll()
  })
})
