/**
 * Runtime surface probe (doc: "probe for the surfaces we depend on ... instead of
 * failing silently when upstream moves"). Dot-paths resolved against the SDK client;
 * leaf must be a function by default.
 */
export function missingSurfaces(
  client: unknown,
  paths: string[],
  requiredType: "function" | "object" | "defined" = "function",
): string[] {
  return paths.filter((path) => {
    let node: unknown = client
    for (const key of path.split(".")) {
      if (node == null || typeof node !== "object") return true
      try {
        node = (node as Record<string, unknown>)[key]
      } catch {
        return true
      }
    }
    if (requiredType === "function") return typeof node !== "function"
    if (requiredType === "object") return node === null || typeof node !== "object"
    return node === undefined
  })
}
