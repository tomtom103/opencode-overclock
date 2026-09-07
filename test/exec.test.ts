import { describe, expect, test } from "bun:test"
import { execBash, NON_INTERACTIVE_ENV, shellQuote } from "../src/platform/process/exec.ts"

describe("shellQuote", () => {
  test("escapes single quotes correctly", () => {
    expect(shellQuote("simple")).toBe("'simple'")
    expect(shellQuote("don't")).toBe("'don'\\''t'")
    expect(shellQuote("foo'bar'baz")).toBe("'foo'\\''bar'\\''baz'")
  })

  test("handles empty string", () => {
    expect(shellQuote("")).toBe("''")
  })
})

describe("execBash", () => {
  test("captures stdout, stderr, and exit code 0", async () => {
    const res = await execBash("echo 'hello stdout'")
    expect(res.code).toBe(0)
    expect(res.stdout.trim()).toBe("hello stdout")
    expect(res.stderr).toBe("")
    expect(res.combined.trim()).toBe("hello stdout")
  })

  test("captures nonzero exit code and stderr", async () => {
    const res = await execBash("echo 'err' >&2; exit 42")
    expect(res.code).toBe(42)
    expect(res.stderr.trim()).toBe("err")
  })

  test("injects non-interactive environment variables while preserving process.env", async () => {
    const res = await execBash("echo TERM=$TERM; echo PATH_SET=${PATH:+yes}")
    expect(res.code).toBe(0)
    expect(res.stdout).toContain("TERM=dumb")
    expect(res.stdout).toContain("PATH_SET=yes")
  })

  test("merges custom options.env without dropping process.env", async () => {
    const res = await execBash("echo CUSTOM=$CUSTOM_VAR; echo PATH_SET=${PATH:+yes}", {
      env: { CUSTOM_VAR: "overclock_val" },
    })
    expect(res.code).toBe(0)
    expect(res.stdout).toContain("CUSTOM=overclock_val")
    expect(res.stdout).toContain("PATH_SET=yes")
  })

  test("terminates on timeoutMs", async () => {
    const start = Date.now()
    const res = await execBash("sleep 5", { timeoutMs: 50 })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(3000)
    expect(res.code).not.toBe(0)
  })
})
