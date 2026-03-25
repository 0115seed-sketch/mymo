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

export { db }
