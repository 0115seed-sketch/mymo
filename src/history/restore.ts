import { type AppDatabase, type Page, nextTime, pageTables, putLocalPages, removeLocalPages } from '../db'
import { validatePage } from '../utils/pageValidation'

function rewriteLinks(content: string, ids: Map<string, string>): string {
  if (!content || ids.size === 0) return content
  const parsed = JSON.parse(content)
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (key === 'href' && typeof item === 'string' && item.startsWith('#') && ids.has(item.slice(1))) value[key] = '#' + ids.get(item.slice(1))
      else if (key === 'templateContent' && typeof item === 'string' && item) value[key] = rewriteLinks(item, ids)
      else if (item && typeof item === 'object') walk(item)
    }
  }
  walk(parsed)
  return JSON.stringify(parsed)
}
// Inputs have already been downloaded and verified. No network inside a local transaction.
export async function restoreArchivedPages(database: AppDatabase, input: Page[], single = false) {
  const pages = input.map(validatePage)
  if (single && pages.length !== 1) throw new Error('복원할 페이지 하나를 선택해주세요.')
  if (new Set(pages.map(p => p.id)).size !== pages.length) throw new Error('복원 기록에 중복 페이지가 있습니다.')
  let restoredId: string | undefined
  await database.transaction('rw', pageTables(database), async () => {
    const current = await database.pages.toArray()
    const map = new Map(current.map(p => [p.id, p]))
    const remap = new Map<string, string>()
    for (const page of pages) if (await database.tombstones.get(page.id)) remap.set(page.id, crypto.randomUUID())
    const targetIds = new Set(pages.map(p => remap.get(p.id) ?? p.id))
    if (!single) await removeLocalPages(database, current.filter(p => !targetIds.has(p.id)).map(p => p.id))
    const writes: Page[] = []
    for (const source of pages) {
      const old = map.get(source.id)
      const id = remap.get(source.id) ?? source.id
      const parent = single && old ? old.parentPageId : source.parentPageId ? remap.get(source.parentPageId) ?? source.parentPageId : null
      const validParent = parent && (single ? current.some(p => p.id === parent && !p.deleted) : targetIds.has(parent)) ? parent : null
      const page: Page = single && old
        ? { ...old, title: source.title, content: rewriteLinks(source.content, remap), deleted: false, updatedAt: nextTime(old.updatedAt) }
        : { ...source, id, parentPageId: validParent, folderId: single && old ? old.folderId : null,
          content: rewriteLinks(source.content, remap), updatedAt: nextTime(Math.max(old?.updatedAt ?? 0, source.updatedAt)) }
      if (single) { page.parentPageId = validParent; page.deleted = false; page.hidden = old?.hidden ?? false; restoredId = id }
      writes.push(page)
    }
    // Defend against cyclic historical parent links without dropping any content.
    const byId = new Map(writes.map(p => [p.id, p]))
    for (const page of writes) {
      const seen = new Set<string>([page.id]); let parent = page.parentPageId
      while (parent && byId.has(parent)) {
        if (seen.has(parent)) { page.parentPageId = null; break }
        seen.add(parent); parent = byId.get(parent)!.parentPageId
      }
    }
    await putLocalPages(database, writes)
  })
  return restoredId
}

// Explicit, non-destructive migration path now that file import/export is removed.
export async function importPreviousDevicePages(database: AppDatabase, input: Page[]) {
  const remap = new Map(input.map(p => [p.id, crypto.randomUUID()]))
  const pages = input.map(validatePage).map(page => ({ ...page, id: remap.get(page.id)!,
    parentPageId: page.parentPageId ? remap.get(page.parentPageId) ?? null : null, folderId: null,
    content: rewriteLinks(page.content, remap), updatedAt: nextTime(page.updatedAt) }))
  await putLocalPages(database, pages)
  return pages.length
}
