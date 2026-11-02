import Dexie, { type EntityTable } from 'dexie'

export interface Folder {
  id: string
  name: string
  order: number
  createdAt: number
}

export interface Page {
  id: string
  title: string
  content: string
  folderId: string | null
  parentPageId: string | null
  deleted: boolean
  hidden: boolean
  order: number
  createdAt: number
  updatedAt: number
  revision?: string
}

export interface Tombstone extends Page { permanentlyDeleted: true }
export type CloudPage = Page | Tombstone
export interface PendingChange { id: string; page: CloudPage; baseRevision: string | null }
export interface SyncMeta { id: string; revision: string }
export interface RecoverySnapshot { id: string; createdAt: number; pages: Page[]; folders: Folder[] }

export function createDatabase(name: string, accountId: string | null = null) {
  const database = new Dexie(name) as Dexie & {
    accountId: string | null
    pages: EntityTable<Page, 'id'>
    folders: EntityTable<Folder, 'id'>
    tombstones: EntityTable<Tombstone, 'id'>
    outbox: EntityTable<PendingChange, 'id'>
    syncMeta: EntityTable<SyncMeta, 'id'>
    recovery: EntityTable<RecoverySnapshot, 'id'>
  }
  database.accountId = accountId
  database.version(2).stores({ pages: 'id, title, updatedAt, folderId, deleted', folders: 'id, name, order' })
  database.version(3).stores({ pages: 'id, title, updatedAt, folderId, deleted, parentPageId', folders: 'id, name, order' })
    .upgrade(tx => tx.table('pages').toCollection().modify(p => { p.parentPageId ??= null }))
  database.version(4).stores({ pages: 'id, title, updatedAt, folderId, deleted, parentPageId, order', folders: 'id, name, order' })
    .upgrade(tx => tx.table('pages').toCollection().modify(p => { p.order ??= 0 }))
  database.version(5).stores({ pages: 'id, title, updatedAt, folderId, deleted, hidden, parentPageId, order', folders: 'id, name, order' })
    .upgrade(tx => tx.table('pages').toCollection().modify(p => { p.hidden ??= false }))
  database.version(6).stores({
    pages: 'id, title, updatedAt, folderId, deleted, hidden, parentPageId, order',
    folders: 'id, name, order', tombstones: 'id, updatedAt', outbox: 'id', syncMeta: 'id',
  })
  database.version(7).stores({ recovery: 'id, createdAt' })
  return database
}

export type AppDatabase = ReturnType<typeof createDatabase>
// Legacy data stays in the guest workspace. Never assign it to the next Google account.
const guestDatabase = createDatabase('ssaemlinderDB')
const databases = new Map<string, AppDatabase>()
export let db = guestDatabase
export function activateDatabase(accountId: string | null) {
  if (accountId === null) db = guestDatabase
  else {
    let next = databases.get(accountId)
    if (!next) {
      next = createDatabase('mymo-account-' + encodeURIComponent(accountId), accountId)
      databases.set(accountId, next)
    }
    db = next
  }
  return db
}
export const hasGuestData = async () => (await guestDatabase.pages.count()) > 0
export const revisionOf = (page: CloudPage) => page.revision ?? ('legacy:' + page.updatedAt)
export const isTombstone = (page: CloudPage): page is Tombstone => 'permanentlyDeleted' in page && page.permanentlyDeleted === true
export const nextTime = (previous = 0) => Math.max(Date.now(), previous + 1)

// All local mutations and their upload requests commit in the same IndexedDB transaction.
export async function putLocalPages(database: AppDatabase, pages: Page[]) {
  await database.transaction('rw', [database.pages, database.tombstones, database.outbox, database.syncMeta], async () => {
    for (const page of pages) {
      if (await database.tombstones.get(page.id)) throw new Error('완전 삭제된 페이지는 다시 저장할 수 없습니다.')
      const next = { ...page, revision: crypto.randomUUID() }
      await database.pages.put(next)
      if (database.accountId) {
        const pending = await database.outbox.get(page.id)
        const meta = await database.syncMeta.get(page.id)
        await database.outbox.put({ id: page.id, page: next, baseRevision: pending ? pending.baseRevision : meta?.revision ?? null })
      }
    }
  })
}

export async function removeLocalPages(database: AppDatabase, ids: string[]) {
  await database.transaction('rw', [database.pages, database.tombstones, database.outbox, database.syncMeta], async () => {
    for (const id of ids) {
      const old = await database.pages.get(id)
      const tombstone: Tombstone = { id, title: '', content: '', folderId: null, parentPageId: null, deleted: true, hidden: true,
        order: 0, createdAt: old?.createdAt ?? Date.now(), updatedAt: nextTime(old?.updatedAt), revision: crypto.randomUUID(), permanentlyDeleted: true }
      await database.pages.delete(id)
      await database.tombstones.put(tombstone)
      if (database.accountId) {
        const pending = await database.outbox.get(id)
        const meta = await database.syncMeta.get(id)
        await database.outbox.put({ id, page: tombstone, baseRevision: pending ? pending.baseRevision : meta?.revision ?? null })
      }
    }
  })
}

// Two devices can concurrently make individually valid moves that form a cycle.
// Break the same edge on every device, preserving every page and its contents.
export async function repairPageCycles(database: AppDatabase) {
  await database.transaction('rw', [database.pages, database.tombstones, database.outbox, database.syncMeta], async () => {
    const all = await database.pages.toArray()
    const map = new Map(all.map(p => [p.id, p]))
    const repaired = new Set<string>()
    for (const page of all) {
      const path: string[] = []
      const indices = new Map<string, number>()
      let current: Page | undefined = page
      while (current) {
        const index = indices.get(current.id)
        if (index !== undefined) {
          const root = path.slice(index).sort()[0]
          const target = map.get(root)!
          target.parentPageId = null
          target.updatedAt = nextTime(target.updatedAt)
          repaired.add(root)
          break
        }
        indices.set(current.id, path.length)
        path.push(current.id)
        current = current.parentPageId ? map.get(current.parentPageId) : undefined
      }
    }
    if (repaired.size) await putLocalPages(database, [...repaired].map(id => map.get(id)!))
  })
}
