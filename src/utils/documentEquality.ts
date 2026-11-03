// JSON object key order and omitted null attributes do not represent document edits.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key]
      if (item === undefined) continue
      if (key === 'attrs' && item && typeof item === 'object' && !Array.isArray(item)) {
        const attrs = Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null && v !== undefined))
        if (Object.keys(attrs).length === 0) continue
        result[key] = canonical(attrs)
      } else result[key] = canonical(item)
    }
    return result
  }
  return value
}
export function sameDocument(left: string, right: string) {
  if (left === right) return true
  try { return JSON.stringify(canonical(JSON.parse(left))) === JSON.stringify(canonical(JSON.parse(right))) } catch { return false }
}
