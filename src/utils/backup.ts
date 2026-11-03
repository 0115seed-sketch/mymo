import { type AppDatabase, type Page, type Folder, type RecoverySnapshot, pageTables, putLocalPages, removeLocalPages, nextTime, isTombstone } from '../db'
import { validatePage, validateHierarchy } from './pageValidation'

export interface Backup { app: 'mymo'; version: number; exportedAt: number; pages: Page[]; folders: Folder[] }
export function validateBackup(input: unknown): Backup {
  const data = input as Partial<Backup> | null
  if (!data || data.app !== 'mymo' || ![1, 2, 3, 4].includes(data.version ?? 0) || !Array.isArray(data.pages) || !Array.isArray(data.folders)) {
    throw new Error('지원하는 mymo 백업 파일이 아닙니다.')
  }
  const pages = data.pages.map(page => {
    const value = validatePage(page)
    if (isTombstone(value)) throw new Error('백업에 완전 삭제 기록이 포함되어 있습니다.')
    return value
  })
  validateHierarchy(pages)
  const folderIds = new Set<string>()
  const folders = data.folders.map(folder => {
    if (!folder || typeof folder.id !== 'string' || !folder.id || typeof folder.name !== 'string' ||
      !Number.isFinite(folder.order) || !Number.isFinite(folder.createdAt) || folderIds.has(folder.id)) throw new Error('폴더 형식이 잘못되었습니다.')
    folderIds.add(folder.id)
    return { id: folder.id, name: folder.name, order: folder.order, createdAt: folder.createdAt }
  })
  return { app: 'mymo', version: 4, exportedAt: data.exportedAt ?? Date.now(), pages, folders }
}

function rewriteLinks(content: string, ids: Map<string, string>): string {
  if (!content) return ''
  const doc = JSON.parse(content)
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return
    for (const [key, item] of Object.entries(value)) {
      if (key === 'href' && typeof item === 'string' && item.startsWith('#') && ids.has(item.slice(1))) value[key] = '#' + ids.get(item.slice(1))
      else if (key === 'templateContent' && typeof item === 'string' && item) value[key] = rewriteLinks(item, ids)
      else if (item && typeof item === 'object') walk(item)
    }
  }
  walk(doc)
  return JSON.stringify(doc)
}

// A failed insert aborts the entire transaction, including deletes and upload requests.
export async function restoreBackup(database: AppDatabase, input: unknown) {
  const backup = validateBackup(input)
  const ids = new Map(backup.pages.map(p => [p.id, crypto.randomUUID()]))
  const folders = new Map(backup.folders.map(f => [f.id, crypto.randomUUID()]))
  const restored = backup.pages.map(p => ({ ...p, id: ids.get(p.id)!, parentPageId: p.parentPageId ? ids.get(p.parentPageId)! : null,
    folderId: p.folderId ? folders.get(p.folderId) ?? null : null, content: rewriteLinks(p.content, ids), updatedAt: nextTime(p.updatedAt) }))
  const restoredFolders = backup.folders.map(f => ({ ...f, id: folders.get(f.id)!, createdAt: nextTime(f.createdAt) }))
  await database.transaction('rw', [...pageTables(database), database.folders, database.recovery], async () => {
    const previous: RecoverySnapshot = { id: crypto.randomUUID(), createdAt: Date.now(), pages: await database.pages.toArray(), folders: await database.folders.toArray() }
    await database.recovery.put(previous)
    await removeLocalPages(database, previous.pages.map(p => p.id))
    await database.folders.clear()
    await database.folders.bulkAdd(restoredFolders)
    await putLocalPages(database, restored)
  })
}
