import { describe, expect, test } from "bun:test"
import {
  execBash,
  killProcessTree,
  NON_INTERACTIVE_ENV,
  redactSensitiveOutput,
  sanitizeEnv,
  shellQuote,
} from "../src/platform/process/exec.ts"

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

describe("sanitizeEnv", () => {
  test("strips sensitive environment variables", () => {
    const raw = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      OPENAI_API_KEY: "sk-secret123",
      ANTHROPIC_API_KEY: "ant-secret456",
      GITHUB_TOKEN: "ghp_tok789",
      DATABASE_URL: "postgres://user:pass@host/db",
      MY_SECRET_PASS: "hunter2",
      DISCORD_WEBHOOK: "https://discord.com/api/webhooks/123",
      APP_PRIVATE_KEY: "somekey",
      NORMAL_VAR: "safe_value",
    }
    const clean = sanitizeEnv(raw)
    expect(clean.PATH).toBe("/usr/bin")
    expect(clean.HOME).toBe("/home/user")
    expect(clean.NORMAL_VAR).toBe("safe_value")
    expect(clean.OPENAI_API_KEY).toBeUndefined()
    expect(clean.ANTHROPIC_API_KEY).toBeUndefined()
    expect(clean.GITHUB_TOKEN).toBeUndefined()
    expect(clean.DATABASE_URL).toBeUndefined()
    expect(clean.MY_SECRET_PASS).toBeUndefined()
    expect(clean.DISCORD_WEBHOOK).toBeUndefined()
    expect(clean.APP_PRIVATE_KEY).toBeUndefined()
  })

  test("allows explicit allowlist to bypass filter", () => {
    const raw = {
      API_KEY: "my_key",
      SECRET_TOKEN: "my_token",
      NORMAL: "normal",
    }
    const clean = sanitizeEnv(raw, ["API_KEY"])
    expect(clean.NORMAL).toBe("normal")
    expect(clean.API_KEY).toBe("my_key")
    expect(clean.SECRET_TOKEN).toBeUndefined()
  })

  test("preserves essential development environment variables like SSH_AUTH_SOCK and SSL_CERT_FILE", () => {
    const raw = {
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
      SSL_CERT_DIR: "/etc/ssl/certs",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/extra.crt",
      GIT_SSH_COMMAND: "ssh -i /id_rsa",
      SECRET_KEY: "strip-this",
    }
    const clean = sanitizeEnv(raw)
    expect(clean.SSH_AUTH_SOCK).toBe("/tmp/ssh-agent.sock")
    expect(clean.SSL_CERT_FILE).toBe("/etc/ssl/certs/ca-certificates.crt")
    expect(clean.SSL_CERT_DIR).toBe("/etc/ssl/certs")
    expect(clean.NODE_EXTRA_CA_CERTS).toBe("/etc/ssl/extra.crt")
    expect(clean.GIT_SSH_COMMAND).toBe("ssh -i /id_rsa")
    expect(clean.SECRET_KEY).toBeUndefined()
  })
})

describe("redactSensitiveOutput", () => {
  test("redacts Bearer tokens, API keys, JWTs, and private keys", () => {
    const raw = [
      "Error: failed with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef",
      "Using key sk-12345678901234567890abcdef",
      "GitHub token: ghp_123456789012345678901234567890123456",
      "AWS ID: AKIAIOSFODNN7EXAMPLE",
      "DB URL: postgres://admin:supersecret@localhost:5432/mydb",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA0Y...",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n")

    const redacted = redactSensitiveOutput(raw)
    expect(redacted).not.toContain("sk-12345678901234567890abcdef")
    expect(redacted).not.toContain("ghp_123456789012345678901234567890123456")
    expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(redacted).not.toContain("supersecret@")
    expect(redacted).not.toContain("MIIEowIBAAKCAQEA0Y...")
    expect(redacted).toContain("[REDACTED_API_KEY]")
    expect(redacted).toContain("[REDACTED_GITHUB_TOKEN]")
    expect(redacted).toContain("[REDACTED_AWS_KEY]")
    expect(redacted).toContain("[REDACTED_PASSWORD]")
    expect(redacted).toContain("[REDACTED_PRIVATE_KEY]")
  })

  test("redacts active process.env secrets", () => {
    const orig = process.env.TEST_TEMP_SECRET_KEY
    process.env.TEST_TEMP_SECRET_KEY = "super_classified_val_987"
    try {
      const output = "Dump: key found = super_classified_val_987 in line"
      const redacted = redactSensitiveOutput(output)
      expect(redacted).not.toContain("super_classified_val_987")
      expect(redacted).toContain("[REDACTED_SECRET]")
    } finally {
      if (orig !== undefined) process.env.TEST_TEMP_SECRET_KEY = orig
      else delete process.env.TEST_TEMP_SECRET_KEY
    }
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

  test("scrubs sensitive process.env keys by default", async () => {
    const orig = process.env.TEST_LEAK_TOKEN
    process.env.TEST_LEAK_TOKEN = "leaked_secret_val"
    try {
      const res = await execBash("echo TOKEN=${TEST_LEAK_TOKEN:-scrubbed}")
      expect(res.code).toBe(0)
      expect(res.stdout.trim()).toBe("TOKEN=scrubbed")

      // Can be explicitly bypassed if sanitizeEnv: false
      const rawRes = await execBash("echo TOKEN=${TEST_LEAK_TOKEN:-scrubbed}", {
        sanitizeEnv: false,
      })
      expect(rawRes.stdout.trim()).toBe("TOKEN=leaked_secret_val")
    } finally {
      if (orig !== undefined) process.env.TEST_LEAK_TOKEN = orig
      else delete process.env.TEST_LEAK_TOKEN
    }
  })

  test("terminates on timeoutMs", async () => {
    const start = Date.now()
    const res = await execBash("sleep 5", { timeoutMs: 50 })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(3000)
    expect(res.code).not.toBe(0)
  })

  test("killProcessTree recursively kills child and grandchild processes", async () => {
    const leafScript = "console.log(JSON.stringify({leaf:process.pid})); setInterval(()=>{}, 1000)"
    const midScript = `Bun.spawn([process.execPath, "-e", ${JSON.stringify(leafScript)}], { stdout: "inherit", stderr: "ignore" }); setInterval(()=>{}, 1000)`
    const rootScript = `const m = Bun.spawn([process.execPath, "-e", ${JSON.stringify(midScript)}], { stdout: "inherit", stderr: "ignore" }); console.log(JSON.stringify({mid:m.pid})); setInterval(()=>{}, 1000)`

    const root = Bun.spawn([process.execPath, "-e", rootScript], { stdout: "pipe", stderr: "ignore" })
    const reader = root.stdout.getReader()
    let text = ""
    while (!text.includes("leaf")) {
      const { value, done } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    const lines = text.trim().split("\n")
    const leafPid = lines
      .map((l) => {
        try {
          return JSON.parse(l).leaf
        } catch {
          return undefined
        }
      })
      .find((p) => typeof p === "number")

    expect(leafPid).toBeDefined()

    await killProcessTree(root, "SIGKILL")
    await root.exited
    await Bun.sleep(100)

    let leafStillAlive = false
    try {
      process.kill(leafPid!, 0)
      leafStillAlive = true
    } catch (_err) {
      leafStillAlive = false
    }

    expect(leafStillAlive).toBe(false)
  })
})
