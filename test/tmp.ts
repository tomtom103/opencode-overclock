import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

const created: string[] = []

/**
 * mkdtemp that cleans itself up when the importing test file finishes.
 * Plain mkdtempSync leaked a directory per call -- ~450 of them accumulated in /tmp
 * before anyone looked.
 */
export function tmpDir(prefix: string): string {
  const dir = mkdtempSync(`${tmpdir()}/overclock-${prefix}-`)
  created.push(dir)
  return dir
}

/**
 * Call from each test file: `afterAll(cleanupTmp)`.
 *
 * Must be registered by the importing file. Neither an afterAll registered here at
 * import time nor a process "exit" handler fires under bun's runner -- both leak
 * silently, which is how ~450 directories accumulated unnoticed.
 */
export function cleanupTmp(): void {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
  created.length = 0
}
