import { describe, expect, test } from "bun:test"
import { truncateOutput, truncator, DEFAULT_MAX_CHARS } from "../src/features/truncator.ts"
import { createBusyTracker } from "../src/lib/busy.ts"

const shared = () => ({ busy: createBusyTracker(), toolName: (n: string) => n })

describe("truncateOutput", () => {
  test("leaves short content untouched", () => {
    const res = truncateOutput("hello world", 100)
    expect(res.truncated).toBe(false)
    expect(res.text).toBe("hello world")
  })

  test("truncates long multi-line content preserving head and tail", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: ${"x".repeat(50)}`)
    const full = lines.join("\n")
    const res = truncateOutput(full, 500, 3, 5)

    expect(res.truncated).toBe(true)
    expect(res.omittedLines).toBe(92)
    expect(res.text).toContain("Line 1:")
    expect(res.text).toContain("Line 2:")
    expect(res.text).toContain("Line 3:")
    expect(res.text).toContain("Line 100:")
    expect(res.text).toContain("truncated 92 lines")
  })

  test("handles single long line", () => {
    const long = "a".repeat(1000)
    const res = truncateOutput(long, 200)
    expect(res.truncated).toBe(true)
    expect(res.text).toContain("truncated")
  })
})

describe("truncator feature module", () => {
  test("module metadata", () => {
    expect(truncator.name).toBe("truncator")
    expect(truncator.defaultEnabled).toBe(true)
    expect(truncator.tools).toEqual([])
  })

  test("truncates matching tool output", async () => {
    const mod = await truncator.init({} as any, { maxChars: 100, tools: ["task_output"] }, shared())
    const after = mod["tool.execute.after"]!

    const output = {
      title: "Task Output",
      output: Array.from({ length: 20 }, (_, i) => `line ${i} long text here`).join("\n"),
      metadata: {},
    }
    await after({ tool: "task_output", sessionID: "s1", callID: "c1", args: {} }, output)

    expect(output.output).toContain("truncated")
  })

  test("skips non-target tool", async () => {
    const mod = await truncator.init({} as any, { maxChars: 100, tools: ["task_output"] }, shared())
    const after = mod["tool.execute.after"]!

    const orig = "long text ".repeat(50)
    const output = {
      title: "Read",
      output: orig,
      metadata: {},
    }
    await after({ tool: "read", sessionID: "s1", callID: "c1", args: {} }, output)

    expect(output.output).toBe(orig)
  })
})
