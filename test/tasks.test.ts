import { describe, expect, test, afterAll, spyOn } from "bun:test"
import { tmpDir, cleanupTmp } from "./tmp.ts"
import {
  createTaskManager,
  looksLikePrompt,
  detectInteractiveCommand,
  readLogTail,
  type TaskRecord,
  type TaskManager,
} from "../src/features/tasks.ts"

afterAll(cleanupTmp)

const logDir = () => tmpDir("tasks")

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

  test("output redacts secrets from logs", async () => {
    const { rec, mgr } = await runToExit("echo 'token sk-12345678901234567890abcdef leaked'; echo done")
    const out = await mgr.output(rec.id, 50)
    expect(out).toContain("done")
    expect(out).not.toContain("sk-12345678901234567890abcdef")
    expect(out).toContain("[REDACTED_API_KEY]")
  })

  test("output caps tail lines at 200", async () => {
    const { rec, mgr } = await runToExit("seq 1 300")
    const out = await mgr.output(rec.id, 10000)
    const lines = out.trim().split("\n")
    expect(lines.length).toBeLessThanOrEqual(200)
    expect(out).toContain("300")
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

  test("tracks task acknowledgment", async () => {
    const mgr = createTaskManager({ logDir: logDir() })
    const t = mgr.run({ command: "true", description: "ack-test", cwd: "/tmp", sessionID: "s-ack" })
    expect(mgr.isAcknowledged(t.id)).toBe(false)
    mgr.acknowledge(t.id)
    expect(mgr.isAcknowledged(t.id)).toBe(true)
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

  test("detectInteractiveCommand identifies interactive commands", () => {
    expect(detectInteractiveCommand("vim file.txt")).toBe("vim")
    expect(detectInteractiveCommand("nano /etc/hosts")).toBe("nano")
    expect(detectInteractiveCommand("git rebase -i HEAD~3")).toBe("git rebase -i")
    expect(detectInteractiveCommand("git commit --amend")).toBe("git commit --amend")
    expect(detectInteractiveCommand("python3")).toBe("python3")
    expect(detectInteractiveCommand("node")).toBe("node")

    // Non-interactive variants should not be blocked
    expect(detectInteractiveCommand("git commit -m 'feat: update'")).toBeNull()
    expect(detectInteractiveCommand("git commit --amend -m 'fix: update'")).toBeNull()
    expect(detectInteractiveCommand("python3 script.py")).toBeNull()
    expect(detectInteractiveCommand("node index.js")).toBeNull()
    expect(detectInteractiveCommand("echo hi")).toBeNull()
  })

  test("output safely bounds memory on huge outputs and handles negative/zero tailLines", async () => {
    const dir = logDir()
    const mgr = createTaskManager({ logDir: dir })
    const rec = mgr.run({
      command: 'for i in $(seq 1 100); do echo "line $i"; done',
      description: "lines",
      cwd: "/tmp",
      sessionID: "s-lines",
    })

    await waitFor(
      async () => (await Bun.file(rec.logPath).exists()) && mgr.get(rec.id)?.status === "exited",
    )

    // Negative tailLines should clamp safely to 1 line, not slice from the start
    const neg = await mgr.output(rec.id, -5)
    expect(neg).toBe("line 100")

    // Zero tailLines should clamp safely to 1 line
    const zero = await mgr.output(rec.id, 0)
    expect(zero).toBe("line 100")

    // Positive tailLines
    const tail5 = await mgr.output(rec.id, 5)
    expect(tail5).toContain("line 96")
    expect(tail5).toContain("line 100")
    expect(tail5).not.toContain("line 95")
  })

  test("prunes finished tasks when maxTasks is exceeded", async () => {
    const dir = logDir()
    const mgr = createTaskManager({ logDir: dir, maxTasks: 3 })
    for (let i = 1; i <= 5; i++) {
      await runToExit(`echo task-${i}`, { timeoutMs: 500 })
    }
    const t1 = mgr.run({ command: "echo t1", description: "1", cwd: "/tmp", sessionID: "s" })
    await waitFor(async () => mgr.get(t1.id)?.status === "exited")
    const t2 = mgr.run({ command: "echo t2", description: "2", cwd: "/tmp", sessionID: "s" })
    await waitFor(async () => mgr.get(t2.id)?.status === "exited")
    const t3 = mgr.run({ command: "echo t3", description: "3", cwd: "/tmp", sessionID: "s" })
    await waitFor(async () => mgr.get(t3.id)?.status === "exited")
    const t4 = mgr.run({ command: "echo t4", description: "4", cwd: "/tmp", sessionID: "s" })
    await waitFor(async () => mgr.get(t4.id)?.status === "exited")

    expect(mgr.list().length).toBeLessThanOrEqual(3)
  })

  test("completion reporting retains log output even under aggressive maxTasks pruning", async () => {
    const dir = logDir()
    const exits: { id: string; tail: string }[] = []
    const mgr = createTaskManager({
      logDir: dir,
      maxTasks: 1,
      onExit: async (task) => {
        const tail = await readLogTail(task.logPath, 5)
        exits.push({ id: task.id, tail })
      },
    })

    const t1 = mgr.run({ command: 'echo "output-t1"', description: "1", cwd: "/tmp", sessionID: "s" })
    const t2 = mgr.run({ command: 'echo "output-t2"', description: "2", cwd: "/tmp", sessionID: "s" })

    await waitFor(async () => exits.length === 2)

    const exit1 = exits.find((e) => e.id === t1.id)
    const exit2 = exits.find((e) => e.id === t2.id)

    expect(exit1?.tail).toContain("output-t1")
    expect(exit1?.tail).not.toContain("no task")
    expect(exit2?.tail).toContain("output-t2")
    expect(exit2?.tail).not.toContain("no task")
  })

  test("spawns tmux pane with configured tmux / tmuxTarget", async () => {
    const origTmux = process.env.TMUX
    const origPane = process.env.TMUX_PANE
    let spawnedArgs: string[][] = []

    const origSpawn = Bun.spawn
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: any, opts?: any) => {
      if (Array.isArray(args) && args[0] === "tmux") {
        spawnedArgs.push(args)
        return {
          stdout: new Response("%42\n").body,
          stderr: new Response("").body,
          exited: Promise.resolve(0),
          exitCode: 0,
        } as any
      }
      return origSpawn(args, opts)
    })

    try {
      process.env.TMUX = "1"
      process.env.TMUX_PANE = "%current"

      // Case 1: tmux as a string target
      spawnedArgs = []
      const mgr1 = createTaskManager({
        logDir: logDir(),
        tmux: "%custom-target",
      })
      mgr1.run({ command: "true", description: "custom target test", cwd: "/tmp", sessionID: "s" })
      await waitFor(async () => spawnedArgs.length > 0)
      expect(spawnedArgs[0]).toContain("-t")
      expect(spawnedArgs[0][spawnedArgs[0].indexOf("-t") + 1]).toBe("%custom-target")

      // Case 2: tmux boolean + tmuxTarget
      spawnedArgs = []
      const mgr2 = createTaskManager({
        logDir: logDir(),
        tmux: true,
        tmuxTarget: "%opt-target",
      })
      mgr2.run({ command: "true", description: "opt target test", cwd: "/tmp", sessionID: "s" })
      await waitFor(async () => spawnedArgs.length > 0)
      expect(spawnedArgs[0]).toContain("-t")
      expect(spawnedArgs[0][spawnedArgs[0].indexOf("-t") + 1]).toBe("%opt-target")

      // Case 3: tmux boolean without tmuxTarget -> falls back to TMUX_PANE
      spawnedArgs = []
      const mgr3 = createTaskManager({
        logDir: logDir(),
        tmux: true,
      })
      mgr3.run({ command: "true", description: "env target test", cwd: "/tmp", sessionID: "s" })
      await waitFor(async () => spawnedArgs.length > 0)
      expect(spawnedArgs[0]).toContain("-t")
      expect(spawnedArgs[0][spawnedArgs[0].indexOf("-t") + 1]).toBe("%current")
    } finally {
      spawnSpy.mockRestore()
      if (origTmux !== undefined) process.env.TMUX = origTmux
      else delete process.env.TMUX
      if (origPane !== undefined) process.env.TMUX_PANE = origPane
      else delete process.env.TMUX_PANE
    }
  })
})
