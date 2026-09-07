/**
 * POSIX single-quote escape for safe shell argument interpolation.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export const NON_INTERACTIVE_ENV: Record<string, string> = {
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_EDITOR: "true",
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  TERM: "dumb",
}

/**
 * Pattern matching environment variable names that typically store credentials,
 * secrets, authentication tokens, API keys, or private keys.
 */
export const SENSITIVE_ENV_PATTERN =
  /(?:KEY|SECRET|TOKEN|AUTH|PASS(?:WORD|WD)?|CREDENTIAL|PRIVATE|SIGNING|DATABASE_URL|WEBHOOK|CERT|BEARER|COOKIE)/i

/**
 * Known system and transport variables that match sensitive keywords but are
 * necessary for everyday development operations (SSH agent socket, TLS certificates).
 */
export const DEFAULT_PRESERVED_ENV: readonly string[] = [
  "SSH_AUTH_SOCK",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "GIT_SSH_COMMAND",
]

/**
 * Filter an environment map to remove sensitive keys (API keys, secrets, tokens).
 * Safe system and build variables (PATH, HOME, USER, SHELL, TEMP, LANG, etc.)
 * as well as essential operational credentials (SSH_AUTH_SOCK, certificates) are preserved.
 */
export function sanitizeEnv(
  env: Record<string, string | undefined>,
  allowlist?: string[],
): Record<string, string | undefined> {
  const allowed = new Set([
    ...DEFAULT_PRESERVED_ENV.map((k) => k.toUpperCase()),
    ...(allowlist?.map((k) => k.toUpperCase()) ?? []),
  ])
  const sanitized: Record<string, string | undefined> = {}

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (allowed.has(key.toUpperCase())) {
      sanitized[key] = value
      continue
    }
    if (SENSITIVE_ENV_PATTERN.test(key)) {
      continue
    }
    sanitized[key] = value
  }

  return sanitized
}

/**
 * Common regex patterns for tokens, API keys, private keys, and credential formats.
 */
export const SENSITIVE_OUTPUT_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Private keys
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  // JWT tokens
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED_JWT]",
  },
  // Bearer tokens
  {
    pattern: /\bBearer\s+[A-Za-z0-9_\-\.~+/]+=*/gi,
    replacement: "Bearer [REDACTED_TOKEN]",
  },
  // OpenAI / Anthropic / AI vendor keys
  {
    pattern: /\b(?:sk|ant)-[a-zA-Z0-9_\-]{20,}\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  // GitHub tokens (classic, fine-grained PATs, OAuth)
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },
  // AWS Access Key ID
  {
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  // Passwords in URLs (e.g. postgres://user:pass@host)
  {
    pattern: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/:]+:)[^/@\s]+(@)/g,
    replacement: "$1[REDACTED_PASSWORD]$2",
  },
  // Authorization headers
  {
    pattern: /(Authorization:\s*(?:Basic|Bearer|Token)\s+)[^\r\n]+/gi,
    replacement: "$1[REDACTED_AUTH]",
  },
  // Key / secret / token assignments in key-value output (e.g. api_key="secret", token: secret)
  {
    pattern:
      /((?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["']?)[A-Za-z0-9_\-\.~+/]{8,}(["']?)/gi,
    replacement: "$1[REDACTED]$2",
  },
]

/**
 * Redacts sensitive tokens, API keys, credentials, and known environment secrets
 * from output strings to prevent data leakage.
 */
export function redactSensitiveOutput(text: string, additionalSecrets?: string[]): string {
  if (!text) return text

  let redacted = text

  // 1. Redact known secrets from process.env (values associated with sensitive keys, length >= 6)
  const envSecrets: string[] = []
  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length >= 6 && SENSITIVE_ENV_PATTERN.test(key)) {
      envSecrets.push(value)
    }
  }

  const allSecrets = [...envSecrets, ...(additionalSecrets ?? [])]
  // Sort by length descending to match longest secrets first
  allSecrets.sort((a, b) => b.length - a.length)

  for (const secret of allSecrets) {
    if (secret && secret.length >= 6 && redacted.includes(secret)) {
      redacted = redacted.replaceAll(secret, "[REDACTED_SECRET]")
    }
  }

  // 2. Redact pattern matches
  for (const { pattern, replacement } of SENSITIVE_OUTPUT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement)
  }

  return redacted
}

/**
 * Discover all descendant PIDs of a given process by inspecting the process tree.
 */
export async function getDescendantPids(rootPid: number): Promise<number[]> {
  const pids: number[] = []
  try {
    const proc = Bun.spawn(["ps", "-A", "-o", "pid,ppid"], {
      stdout: "pipe",
      stderr: "ignore",
    })
    const text = await new Response(proc.stdout).text()
    await proc.exited

    const parentMap = new Map<number, number[]>()
    for (const line of text.trim().split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2) {
        const pid = Number(parts[0])
        const ppid = Number(parts[1])
        if (!isNaN(pid) && !isNaN(ppid)) {
          if (!parentMap.has(ppid)) parentMap.set(ppid, [])
          parentMap.get(ppid)!.push(pid)
        }
      }
    }

    const queue = [rootPid]
    while (queue.length > 0) {
      const curr = queue.shift()!
      const children = parentMap.get(curr) ?? []
      for (const child of children) {
        pids.push(child)
        queue.push(child)
      }
    }
  } catch {}
  return pids
}

/**
 * Kill a process and its child processes recursively on POSIX systems.
 */
export async function killProcessTree(
  target: Bun.Subprocess | number,
  signal: "SIGTERM" | "SIGKILL" = "SIGTERM",
): Promise<void> {
  const pid = typeof target === "number" ? target : target.pid
  if (!pid) return

  // 1. Gather all descendants in the process tree before sending signals
  const descendants = await getDescendantPids(pid)

  // 2. Try killing process group in case target is a process group leader
  try {
    process.kill(-pid, signal)
  } catch {}

  // 3. Kill all descendants (leaves first by iterating in reverse)
  for (let i = descendants.length - 1; i >= 0; i--) {
    try {
      process.kill(descendants[i]!, signal)
    } catch {}
  }

  // 4. Fallback pkill -P for any newly spawned direct children
  try {
    const pkill = Bun.spawn(["pkill", `-${signal === "SIGKILL" ? "KILL" : "TERM"}`, "-P", String(pid)], {
      stdout: "ignore",
      stderr: "ignore",
    })
    await pkill.exited
  } catch {}

  // 5. Kill the root process
  try {
    if (typeof target === "number") {
      process.kill(pid, signal)
    } else {
      target.kill(signal)
    }
  } catch {}
}

export interface ExecBashOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  timeoutMs?: number
  onSpawn?: (proc: Bun.Subprocess) => void
  /**
   * If true (default), sensitive environment variables (API keys, secrets, tokens)
   * are scrubbed from process.env before spawning child processes.
   */
  sanitizeEnv?: boolean
  /**
   * Specific variable names to keep even if they match sensitive patterns.
   */
  envAllowlist?: string[]
  /**
   * Maximum captured bytes per stream (stdout/stderr). Defaults to 1MB.
   * Outputs beyond the cap are truncated with a marker so giant tool
   * outputs cannot OOM the host or flood the model context.
   */
  maxBytes?: number
}

/** Default per-stream capture cap for execBash (1MB). */
export const EXEC_BASH_MAX_BYTES = 1024 * 1024

const TRUNCATION_MARKER = "\n... [truncated: output exceeded capture limit]"

export interface ExecBashResult {
  code: number | null
  stdout: string
  stderr: string
  combined: string
}

/**
 * Run a command via `bash -c`, capturing stdout, stderr, and exit code.
 * Ensures non-interactive environment variables with correct precedence,
 * environment sanitization against secret leakage, and process termination escalation.
 */
export async function execBash(command: string, options: ExecBashOptions = {}): Promise<ExecBashResult> {
  const baseEnv =
    options.sanitizeEnv === false ? process.env : sanitizeEnv(process.env, options.envAllowlist)

  const mergedEnv: Record<string, string | undefined> = {
    ...baseEnv,
    ...NON_INTERACTIVE_ENV,
    ...options.env,
  }

  const proc = Bun.spawn(["bash", "-c", command], {
    cwd: options.cwd,
    env: mergedEnv,
    stdout: "pipe",
    stderr: "pipe",
  })
  options.onSpawn?.(proc)

  let killEscalationTimer: ReturnType<typeof setTimeout> | undefined
  const killTimer = options.timeoutMs
    ? setTimeout(() => {
        void killProcessTree(proc, "SIGTERM")
        killEscalationTimer = setTimeout(() => {
          void killProcessTree(proc, "SIGKILL")
        }, 2000)
        killEscalationTimer.unref?.()
      }, options.timeoutMs)
    : undefined

  // Protect against pipe leaks when background child processes keep stdout/stderr open
  const streamTimeoutMs = options.timeoutMs ? options.timeoutMs + 2500 : undefined
  const maxBytes = options.maxBytes ?? EXEC_BASH_MAX_BYTES
  const readStreamWithTimeout = (stream: ReadableStream, timeoutMs?: number): Promise<string> => {
    const readPromise = new Response(stream).text().catch(() => "")
    if (!timeoutMs) return readPromise
    let timer: ReturnType<typeof setTimeout>
    return Promise.race([
      readPromise,
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
  }

  const [rawStdout, rawStderr, code] = await Promise.all([
    readStreamWithTimeout(proc.stdout, streamTimeoutMs),
    readStreamWithTimeout(proc.stderr, streamTimeoutMs),
    proc.exited.catch(() => proc.exitCode ?? 1),
  ])

  if (killTimer) clearTimeout(killTimer)
  if (killEscalationTimer) clearTimeout(killEscalationTimer)

  const truncate = (text: string): string =>
    text.length > maxBytes ? text.slice(0, maxBytes) + TRUNCATION_MARKER : text
  const stdout = truncate(rawStdout)
  const stderr = truncate(rawStderr)
  return { code, stdout, stderr, combined: stdout + stderr }
}
