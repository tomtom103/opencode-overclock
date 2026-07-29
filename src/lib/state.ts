import { mkdir } from "node:fs/promises"

/** State root: <project>/.opencode/overclock/[sub]. Creates if missing. */
export async function ensureStateDir(directory: string, sub?: string): Promise<string> {
  const dir = `${directory}/.opencode/overclock${sub ? `/${sub}` : ""}`
  await mkdir(dir, { recursive: true })
  return dir
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  const file = Bun.file(path)
  if (!(await file.exists())) return fallback
  try {
    return (await file.json()) as T
  } catch {
    return fallback
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(value, null, 2))
}

/** POSIX single-quote escape. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}
