import { createSignal } from 'solid-js'
import { db, type Page, type Folder } from '../db'
import {
  syncPageToCloud,
  syncFolderToCloud,
  deletePageFromCloud,
  deleteFolderFromCloud,
} from './sync'
import { user } from './auth'

const generateId = () => crypto.randomUUID()

export function createPageStore() {
  const [pages, setPages] = createSignal<Page[]>([])
  const [folders, setFolders] = createSignal<Folder[]>([])
  const [currentPageId, setCurrentPageId] = createSignal<string | null>(null)
  const [showTrash, setShowTrash] = createSignal(false)

  // --- Load ---
  const loadPages = async () => {
    const all = await db.pages.orderBy('order').toArray()
    setPages(all)
    // Auto-select first non-deleted page if current is gone
    const current = currentPageId()
    const active = all.filter(p => !p.deleted)
    if (active.length > 0 && (!current || !active.find(p => p.id === current))) {
      setCurrentPageId(active[0].id)
    }
  }

  const loadFolders = async () => {
    const all = await db.folders.orderBy('order').toArray()
    setFolders(all)
  }

  const loadAll = async () => {
    await Promise.all([loadPages(), loadFolders()])
  }

  // --- Derived ---
  const activePages = () => pages().filter(p => !p.deleted)
  const trashedPages = () => pages().filter(p => p.deleted)
  const rootPages = () => activePages().filter(p => !p.folderId && !p.parentPageId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const pagesInFolder = (folderId: string) => activePages().filter(p => p.folderId === folderId && !p.parentPageId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const subPages = (parentPageId: string) => activePages().filter(p => p.parentPageId === parentPageId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const currentPage = () => pages().find(p => p.id === currentPageId()) ?? null

  // --- Page CRUD ---
  const createPage = async (title = '새 페이지', folderId: string | null = null, parentPageId: string | null = null) => {
    const now = Date.now()
    // new pages go to order 0 (top), push existing ones down
    const siblings = pages().filter(p => !p.deleted && p.folderId === folderId && p.parentPageId === parentPageId)
    for (const s of siblings) {
      await db.pages.update(s.id, { order: (s.order ?? 0) + 1 })
    }
    const page: Page = {
      id: generateId(),
      title,
      content: '',
      folderId,
      parentPageId,
      deleted: false,
      order: 0,
      createdAt: now,
      updatedAt: now,
    }
    await db.pages.add(page)
    // 로컬 state만 업데이트 (전체 reload 제거)
    setPages(prev => {
      const updated = prev.map(p => 
        (p.folderId === folderId && p.parentPageId === parentPageId) 
          ? {...p, order: (p.order ?? 0) + 1} 
          : p
      )
      return [page, ...updated]
    })
    setCurrentPageId(page.id)
    // 백그라운드 클라우드 동기화 (로컬 저장 후 fire-and-forget)
    const uid = user()?.uid
    if (uid) syncPageToCloud(uid, page)
    return page
  }

  const updatePage = async (id: string, updates: Partial<Pick<Page, 'title' | 'content' | 'folderId'>>) => {
    const updatedAt = Date.now()
    await db.pages.update(id, { ...updates, updatedAt })
    // 로컬 state만 업데이트 (전체 reload 제거)
    setPages(prev => prev.map(p => 
      p.id === id ? {...p, ...updates, updatedAt} : p
    ))
    // 백그라운드 클라우드 동기화
    const uid = user()?.uid
    if (uid) {
      const page = await db.pages.get(id)
      if (page) syncPageToCloud(uid, page)
    }
  }

  // Soft delete → move to trash
  const trashPage = async (id: string) => {
    const updatedAt = Date.now()
    await db.pages.update(id, { deleted: true, updatedAt })
    // 로컬 state만 업데이트
    setPages(prev => prev.map(p => 
      p.id === id ? {...p, deleted: true, updatedAt} : p
    ))
    if (currentPageId() === id) {
      const active = pages().filter(p => !p.deleted)
      setCurrentPageId(active.length > 0 ? active[0].id : null)
    }
    // 백그라운드 클라우드 동기화 (소프트 삭제 반영)
    const uid = user()?.uid
    if (uid) {
      const page = await db.pages.get(id)
      if (page) syncPageToCloud(uid, page)
    }
  }

  // Restore from trash
  const restorePage = async (id: string) => {
    const updatedAt = Date.now()
    await db.pages.update(id, { deleted: false, updatedAt })
    // 로컬 state만 업데이트
    setPages(prev => prev.map(p => 
      p.id === id ? {...p, deleted: false, updatedAt} : p
    ))
    const uid = user()?.uid
    if (uid) {
      const page = await db.pages.get(id)
      if (page) syncPageToCloud(uid, page)
    }
  }

  // Permanent delete
  const deletePage = async (id: string) => {
    await db.pages.delete(id)
    // 로컬 state만 업데이트
    const currentId = currentPageId()
    setPages(prev => prev.filter(p => p.id !== id))
    if (currentId === id) {
      const active = pages().filter(p => !p.deleted && p.id !== id)
      setCurrentPageId(active.length > 0 ? active[0].id : null)
    }
    const uid = user()?.uid
    if (uid) deletePageFromCloud(uid, id)
  }

  // Empty trash
  const emptyTrash = async () => {
    const trashed = pages().filter(p => p.deleted)
    const ids = trashed.map(p => p.id)
    await db.pages.bulkDelete(ids)
    // 로컬 state만 업데이트
    setPages(prev => prev.filter(p => !p.deleted))
    const uid = user()?.uid
    if (uid) ids.forEach(id => deletePageFromCloud(uid, id))
  }

  // --- Folder CRUD ---
  const createFolder = async (name = '새 폴더') => {
    const maxOrder = folders().reduce((max, f) => Math.max(max, f.order), 0)
    const folder: Folder = {
      id: generateId(),
      name,
      order: maxOrder + 1,
      createdAt: Date.now(),
    }
    await db.folders.add(folder)
    // 로컬 state만 업데이트
    setFolders(prev => [...prev, folder])
    const uid = user()?.uid
    if (uid) syncFolderToCloud(uid, folder)
    return folder
  }

  const renameFolder = async (id: string, name: string) => {
    await db.folders.update(id, { name })
    // 로컬 state만 업데이트
    setFolders(prev => prev.map(f => 
      f.id === id ? {...f, name} : f
    ))
    const uid = user()?.uid
    if (uid) {
      const folder = await db.folders.get(id)
      if (folder) syncFolderToCloud(uid, folder)
    }
  }

  const deleteFolder = async (id: string) => {
    // Move pages in this folder to root
    const pagesInThisFolder = activePages().filter(p => p.folderId === id)
    for (const p of pagesInThisFolder) {
      await db.pages.update(p.id, { folderId: null })
    }
    await db.folders.delete(id)
    // 로컬 state만 업데이트
    setFolders(prev => prev.filter(f => f.id !== id))
    setPages(prev => prev.map(p => 
      p.folderId === id ? {...p, folderId: null} : p
    ))
    const uid = user()?.uid
    if (uid) {
      deleteFolderFromCloud(uid, id)
      // 루트로 이동된 페이지들도 클라우드에 반영
      for (const p of pagesInThisFolder) {
        const page = await db.pages.get(p.id)
        if (page) syncPageToCloud(uid, page)
      }
    }
  }

  // --- Reorder pages ---
  const reorderPage = async (pageId: string, newIndex: number, folderId: string | null) => {
    // Get sorted siblings (same folder & not deleted)
    const siblings = activePages()
      .filter(p => p.folderId === folderId && !p.parentPageId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const oldIndex = siblings.findIndex(p => p.id === pageId)
    if (oldIndex === -1 || oldIndex === newIndex) return

    const reordered = [...siblings]
    const [moved] = reordered.splice(oldIndex, 1)
    // splice 후 배열이 짧아지므로, 원래 인덱스보다 뒤로 이동할 때 1을 빼야 함
    const adjustedIndex = oldIndex < newIndex ? newIndex - 1 : newIndex
    reordered.splice(adjustedIndex, 0, moved)

    const uid = user()?.uid
    for (let i = 0; i < reordered.length; i++) {
      await db.pages.update(reordered[i].id, { order: i })
      if (uid) {
        const page = await db.pages.get(reordered[i].id)
        if (page) syncPageToCloud(uid, page)
      }
    }
    // 로컬 state만 업데이트
    setPages(prev => prev.map(p => {
      const idx = reordered.findIndex(r => r.id === p.id)
      return idx !== -1 ? {...p, order: idx} : p
    }))
  }

  // --- Reorder folders ---
  const reorderFolder = async (folderId: string, newIndex: number) => {
    const sorted = [...folders()].sort((a, b) => a.order - b.order)
    const oldIndex = sorted.findIndex(f => f.id === folderId)
    if (oldIndex === -1 || oldIndex === newIndex) return

    const reordered = [...sorted]
    const [moved] = reordered.splice(oldIndex, 1)
    const adjustedIndex = oldIndex < newIndex ? newIndex - 1 : newIndex
    reordered.splice(adjustedIndex, 0, moved)

    const uid = user()?.uid
    for (let i = 0; i < reordered.length; i++) {
      await db.folders.update(reordered[i].id, { order: i })
      if (uid) {
        const folder = await db.folders.get(reordered[i].id)
        if (folder) syncFolderToCloud(uid, folder)
      }
    }
    setFolders(prev => prev.map(f => {
      const idx = reordered.findIndex(r => r.id === f.id)
      return idx !== -1 ? { ...f, order: idx } : f
    }))
  }

  // Move page to folder (with order placement at end)
  const movePageToFolder = async (pageId: string, folderId: string | null) => {
    const siblings = activePages().filter(p => p.folderId === folderId && !p.parentPageId)
    const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(p => p.order ?? 0)) + 1 : 0
    const updatedAt = Date.now()
    await db.pages.update(pageId, { folderId, order: maxOrder, updatedAt })
    // 로컬 state만 업데이트
    setPages(prev => prev.map(p => 
      p.id === pageId ? {...p, folderId, order: maxOrder, updatedAt} : p
    ))
    const uid = user()?.uid
    if (uid) {
      const page = await db.pages.get(pageId)
      if (page) syncPageToCloud(uid, page)
    }
  }

  return {
    pages,
    folders,
    currentPageId,
    currentPage,
    showTrash,
    setShowTrash,
    setCurrentPageId,
    activePages,
    trashedPages,
    rootPages,
    pagesInFolder,
    subPages,
    loadAll,
    loadPages,
    createPage,
    updatePage,
    trashPage,
    restorePage,
    deletePage,
    emptyTrash,
    createFolder,
    renameFolder,
    deleteFolder,
    reorderPage,
    reorderFolder,
    movePageToFolder,
  }
}
