/**
 * Runtime surface probe (doc: "probe for the surfaces we depend on ... instead of
 * failing silently when upstream moves"). Dot-paths resolved against the SDK client;
 * leaf must be a function.
 */
export function missingSurfaces(client: unknown, paths: string[]): string[] {
  return paths.filter((path) => {
    let node: unknown = client
    for (const key of path.split(".")) {
      if (node == null || typeof node !== "object") return true
      node = (node as Record<string, unknown>)[key]
    }
    return typeof node !== "function"
  })
}
