import { createSignal } from 'solid-js'
import { db, type Page, type Folder } from '../db'

const generateId = () => crypto.randomUUID()

export function createPageStore() {
  const [pages, setPages] = createSignal<Page[]>([])
  const [folders, setFolders] = createSignal<Folder[]>([])
  const [currentPageId, setCurrentPageId] = createSignal<string | null>(null)
  const [showTrash, setShowTrash] = createSignal(false)

  // --- Load ---
  const loadPages = async () => {
    const all = await db.pages.orderBy('updatedAt').reverse().toArray()
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
  const rootPages = () => activePages().filter(p => !p.folderId && !p.parentPageId)
  const pagesInFolder = (folderId: string) => activePages().filter(p => p.folderId === folderId && !p.parentPageId)
  const subPages = (parentPageId: string) => activePages().filter(p => p.parentPageId === parentPageId)
  const currentPage = () => pages().find(p => p.id === currentPageId()) ?? null

  // --- Page CRUD ---
  const createPage = async (title = '새 페이지', folderId: string | null = null, parentPageId: string | null = null) => {
    const now = Date.now()
    const page: Page = {
      id: generateId(),
      title,
      content: '',
      folderId,
      parentPageId,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    }
    await db.pages.add(page)
    await loadPages()
    setCurrentPageId(page.id)
    return page
  }

  const updatePage = async (id: string, updates: Partial<Pick<Page, 'title' | 'content' | 'folderId'>>) => {
    await db.pages.update(id, { ...updates, updatedAt: Date.now() })
    await loadPages()
  }

  // Soft delete → move to trash
  const trashPage = async (id: string) => {
    await db.pages.update(id, { deleted: true, updatedAt: Date.now() })
    await loadPages()
    if (currentPageId() === id) {
      const active = pages().filter(p => !p.deleted)
      setCurrentPageId(active.length > 0 ? active[0].id : null)
    }
  }

  // Restore from trash
  const restorePage = async (id: string) => {
    await db.pages.update(id, { deleted: false, updatedAt: Date.now() })
    await loadPages()
  }

  // Permanent delete
  const deletePage = async (id: string) => {
    await db.pages.delete(id)
    await loadPages()
    if (currentPageId() === id) {
      const active = pages().filter(p => !p.deleted)
      setCurrentPageId(active.length > 0 ? active[0].id : null)
    }
  }

  // Empty trash
  const emptyTrash = async () => {
    const trashed = pages().filter(p => p.deleted)
    await db.pages.bulkDelete(trashed.map(p => p.id))
    await loadPages()
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
    await loadFolders()
    return folder
  }

  const renameFolder = async (id: string, name: string) => {
    await db.folders.update(id, { name })
    await loadFolders()
  }

  const deleteFolder = async (id: string) => {
    // Move pages in this folder to root
    const pagesInThisFolder = activePages().filter(p => p.folderId === id)
    for (const p of pagesInThisFolder) {
      await db.pages.update(p.id, { folderId: null })
    }
    await db.folders.delete(id)
    await Promise.all([loadPages(), loadFolders()])
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
  }
}
