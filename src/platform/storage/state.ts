import { mkdir, copyFile } from "node:fs/promises"
import { writeFileSync, renameSync, unlinkSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { shellQuote } from "../process/exec.ts"

export { shellQuote }

/** State root: <project>/.opencode/overclock/[sub]. Pure -- creates nothing. */
export function stateDir(directory: string, sub?: string): string {
  return `${directory}/.opencode/overclock${sub ? `/${sub}` : ""}`
}

/** State root: <project>/.opencode/overclock/[sub]. Creates if missing. */
export async function ensureStateDir(directory: string, sub?: string): Promise<string> {
  const dir = stateDir(directory, sub)
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
  } catch (e) {
    console.warn(`[overclock] failed to parse JSON at ${path}: ${e}`)
    try {
      await copyFile(path, `${path}.corrupt.${Date.now()}`)
    } catch {}
    return fallback
  }
}

/**
 * Serializes the value formatted with 2 spaces and atomically writes to the destination path.
 */
export async function writeJson(path: string, value: unknown): Promise<void> {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  const content = JSON.stringify(value, null, 2)
  try {
    writeFileSync(tmpPath, content)
    renameSync(tmpPath, path)
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(tmpPath, content)
      renameSync(tmpPath, path)
      return
    }
    try {
      unlinkSync(tmpPath)
    } catch {}
    throw err
  }
}

/** A typed state file accessor. */
export interface Store<T> {
  readonly file: string
  path(directory: string): string
  read(directory: string): Promise<T>
  readMaybe(directory: string): Promise<T | undefined>
  write(directory: string, value: T): Promise<void>
}

/** Factory for typed state file stores. */
export function defineStore<T>(file: string, fallback: () => T): Store<T> {
  const path = (directory: string) => `${stateDir(directory)}/${file}`
  return {
    file,
    path,
    read: (directory) => readJson<T>(path(directory), fallback()),
    readMaybe: async (directory) => {
      const target = path(directory)
      try {
        if (!(await Bun.file(target).exists())) return undefined
      } catch {
        return undefined
      }
      return readJson<T>(target, fallback())
    },
    write: async (directory, value) => {
      await ensureStateDir(directory)
      await writeJson(path(directory), value)
    },
  }
}
