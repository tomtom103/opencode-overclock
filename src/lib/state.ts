import { mkdir } from "node:fs/promises"

/** State root: <project>/.opencode/overclock/[sub]. Creates if missing. */
export async function ensureStateDir(directory: string, sub?: string): Promise<string> {
  const dir = `${directory}/.opencode/overclock${sub ? `/${sub}` : ""}`
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * True once per project, then never again. Marker lives beside the other state, so
 * deleting .opencode/overclock/ re-arms the first-run notice.
 */
export async function firstRun(directory: string): Promise<boolean> {
  const dir = await ensureStateDir(directory)
  const marker = Bun.file(`${dir}/.installed`)
  if (await marker.exists()) return false
  await Bun.write(marker, new Date().toISOString())
  return true
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
