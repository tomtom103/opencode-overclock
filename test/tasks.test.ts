import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import {
  createTaskManager,
  looksLikePrompt,
  type TaskRecord,
  type TaskManager,
} from "../src/features/tasks.ts"

const logDir = () => mkdtempSync(`${tmpdir()}/overclock-test-`)

function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const poll = async () => {
      if (await check()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"))
      setTimeout(poll, 20)
    }
    poll()
  })
}

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

  test("mirror file reflects spawned+exited task", async () => {
    const dir = logDir()
    const mirrorPath = `${dir}/tasks.json`
    const mgr: TaskManager = createTaskManager({ logDir: dir, mirrorPath })
    const t = mgr.run({ command: "echo hi", description: "mirrored", cwd: "/tmp", sessionID: "s3" })

    await waitFor(async () => await Bun.file(mirrorPath).exists())
    const spawned = await Bun.file(mirrorPath).json()
    expect(spawned.find((e: { id: string }) => e.id === t.id)?.status).toBe("running")

    await waitFor(async () => {
      const entries = await Bun.file(mirrorPath).json()
      return entries.find((e: { id: string }) => e.id === t.id)?.status === "exited"
    })
    const exited = await Bun.file(mirrorPath).json()
    const entry = exited.find((e: { id: string }) => e.id === t.id)
    expect(entry?.status).toBe("exited")
    expect(entry?.exitCode).toBe(0)
    expect(entry?.description).toBe("mirrored")
    expect(typeof entry?.startedAt).toBe("number")
  })
})

describe("looksLikePrompt", () => {
  test("matches y/n and press-key prompts", () => {
    expect(looksLikePrompt("Overwrite? (y/n) ")).toBe(true)
    expect(looksLikePrompt("some output\nContinue?")).toBe(true)
    expect(looksLikePrompt("Press any key to continue")).toBe(true)
    expect(looksLikePrompt("Are you sure you want to proceed?")).toBe(true)
    expect(looksLikePrompt("Delete files? [Y/n]")).toBe(true)
  })

  test("does not match plain log lines", () => {
    expect(looksLikePrompt("Building... 45%")).toBe(false)
    expect(looksLikePrompt("compiled 3 files\ndone")).toBe(false)
    expect(looksLikePrompt("")).toBe(false)
  })
})

describe("stall watchdog", () => {
  test("onStall fires for prompt-like stalled output", async () => {
    const stalled = await new Promise<{ task: TaskRecord; tail: string; mgr: TaskManager }>(
      (resolve) => {
        const mgr: TaskManager = createTaskManager({
          logDir: logDir(),
          stallCheckIntervalMs: 50,
          stallThresholdMs: 150,
          onStall: (task, tail) => resolve({ task, tail, mgr }),
        })
        mgr.run({
          command: "printf 'Overwrite? (y/n) '; sleep 30",
          description: "stalls",
          cwd: "/tmp",
          sessionID: "s4",
        })
      },
    )
    expect(stalled.tail).toContain("Overwrite?")
    expect(stalled.task.status).toBe("running")
    stalled.mgr.kill(stalled.task.id)
  })

  test("onStall does not fire while output keeps growing", async () => {
    let stallFired = false
    const { rec } = await new Promise<{ rec: TaskRecord }>((resolve) => {
      const mgr = createTaskManager({
        logDir: logDir(),
        stallCheckIntervalMs: 50,
        stallThresholdMs: 150,
        onStall: () => {
          stallFired = true
        },
        onExit: (rec) => resolve({ rec }),
      })
      mgr.run({
        command: "for i in 1 2 3 4 5; do echo tick; sleep 0.05; done",
        description: "grows",
        cwd: "/tmp",
        sessionID: "s5",
      })
    })
    expect(rec.exitCode).toBe(0)
    expect(stallFired).toBe(false)
  })
})
