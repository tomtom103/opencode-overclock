import { describe, expect, test, spyOn } from "bun:test"
import { isInsideTmux, spawnTaskPane } from "../src/lib/tmux.ts"

describe("tmux utilities", () => {
  test("isInsideTmux reflects TMUX environment variable", () => {
    const orig = process.env.TMUX
    try {
      delete process.env.TMUX
      expect(isInsideTmux()).toBe(false)

      process.env.TMUX = "/tmp/tmux-1000/default,1234,0"
      expect(isInsideTmux()).toBe(true)
    } finally {
      if (orig !== undefined) process.env.TMUX = orig
      else delete process.env.TMUX
    }
  })

  test("spawnTaskPane returns null when outside tmux", async () => {
    const orig = process.env.TMUX
    try {
      delete process.env.TMUX
      const pane = await spawnTaskPane("/tmp/nonexistent.log", "test")
      expect(pane).toBeNull()
    } finally {
      if (orig !== undefined) process.env.TMUX = orig
      else delete process.env.TMUX
    }
  })

  test("spawnTaskPane targets target or process.env.TMUX_PANE", async () => {
    const origTmux = process.env.TMUX
    const origPane = process.env.TMUX_PANE
    let spawnedArgs: string[][] = []

    const spawnSpy = spyOn(Bun, "spawn").mockImplementation((args: any) => {
      spawnedArgs.push(args)
      return {
        stdout: new Response("%99\n").body,
        stderr: new Response("").body,
        exited: Promise.resolve(0),
        exitCode: 0,
      } as any
    })

    try {
      process.env.TMUX = "/tmp/tmux-1000/default,1234,0"
      process.env.TMUX_PANE = "%1"

      // 1. Explicit target takes precedence
      spawnedArgs = []
      const pane1 = await spawnTaskPane("/tmp/task1.log", "task 1", "%2")
      expect(pane1?.paneId).toBe("%99")
      expect(spawnedArgs[0]).toEqual([
        "tmux",
        "split-window",
        "-t",
        "%2",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "bash",
        "-c",
        'printf "=== [%s] ===\\n" "$1" && exec tail -f "$2"',
        "_",
        "task 1",
        "/tmp/task1.log",
      ])

      // 2. Falls back to process.env.TMUX_PANE when target is omitted
      spawnedArgs = []
      const pane2 = await spawnTaskPane("/tmp/task2.log", "task 2")
      expect(pane2?.paneId).toBe("%99")
      expect(spawnedArgs[0]).toEqual([
        "tmux",
        "split-window",
        "-t",
        "%1",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "bash",
        "-c",
        'printf "=== [%s] ===\\n" "$1" && exec tail -f "$2"',
        "_",
        "task 2",
        "/tmp/task2.log",
      ])

      // 3. Omits -t when neither target nor TMUX_PANE is present
      delete process.env.TMUX_PANE
      spawnedArgs = []
      const pane3 = await spawnTaskPane("/tmp/task3.log", "task 3")
      expect(pane3?.paneId).toBe("%99")
      expect(spawnedArgs[0]).toEqual([
        "tmux",
        "split-window",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "bash",
        "-c",
        'printf "=== [%s] ===\\n" "$1" && exec tail -f "$2"',
        "_",
        "task 3",
        "/tmp/task3.log",
      ])

      // 4. Works without title (tail -f branch)
      spawnedArgs = []
      const pane4 = await spawnTaskPane("/tmp/task4.log", undefined, "%3")
      expect(pane4?.paneId).toBe("%99")
      expect(spawnedArgs[0]).toEqual([
        "tmux",
        "split-window",
        "-t",
        "%3",
        "-d",
        "-P",
        "-F",
        "#{pane_id}",
        "tail",
        "-f",
        "/tmp/task4.log",
      ])

      // 5. Pane close kills the pane by paneId
      if (pane1) {
        spawnedArgs = []
        await pane1.close()
        expect(spawnedArgs[0]).toEqual(["tmux", "kill-pane", "-t", "%99"])
      }
    } finally {
      spawnSpy.mockRestore()
      if (origTmux !== undefined) process.env.TMUX = origTmux
      else delete process.env.TMUX
      if (origPane !== undefined) process.env.TMUX_PANE = origPane
      else delete process.env.TMUX_PANE
    }
  })
})
