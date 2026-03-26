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
  content: string  // TipTap JSON string
  folderId: string | null  // null = root level
  parentPageId: string | null  // null = top-level page, otherwise sub-page
  deleted: boolean  // true = in trash
  order: number  // manual sort order (lower = higher priority)
  createdAt: number
  updatedAt: number
}

const db = new Dexie('ssaemlinderDB') as Dexie & {
  pages: EntityTable<Page, 'id'>
  folders: EntityTable<Folder, 'id'>
}

db.version(2).stores({
  pages: 'id, title, updatedAt, folderId, deleted',
  folders: 'id, name, order',
})

db.version(3).stores({
  pages: 'id, title, updatedAt, folderId, deleted, parentPageId',
  folders: 'id, name, order',
}).upgrade(tx => {
  return tx.table('pages').toCollection().modify(page => {
    if (page.parentPageId === undefined) page.parentPageId = null
  })
})

db.version(4).stores({
  pages: 'id, title, updatedAt, folderId, deleted, parentPageId, order',
  folders: 'id, name, order',
}).upgrade(tx => {
  let i = 0
  return tx.table('pages').toCollection().modify(page => {
    if (page.order === undefined) page.order = i++
  })
})

export { db }
