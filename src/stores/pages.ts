import { createSignal } from 'solid-js'
import { db, type Page } from '../db'
import {
  syncPageToCloud,
  deletePageFromCloud,
} from './sync'
import { user } from './auth'

const generateId = () => crypto.randomUUID()

export function createPageStore() {
  const [pages, setPages] = createSignal<Page[]>([])
  const [currentPageId, setCurrentPageId] = createSignal<string | null>(null)
  const [showTrash, setShowTrash] = createSignal(false)

  // --- Load ---
  const loadPages = async () => {
    const all = await db.pages.orderBy('order').toArray()
    setPages(all)
    const current = currentPageId()
    const active = all.filter(p => !p.deleted)
    if (active.length > 0 && (!current || !active.find(p => p.id === current))) {
      setCurrentPageId(active[0].id)
    }
  }

  const loadAll = async () => {
    await loadPages()
  }

  // --- Derived ---
  const activePages = () => pages().filter(p => !p.deleted)
  const trashedPages = () =>
    pages().filter(p =>
      p.deleted &&
      (!p.parentPageId || !pageById(p.parentPageId)?.deleted)
    )
  const rootPages = () => activePages().filter(p => !p.parentPageId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const subPages = (parentPageId: string) => activePages().filter(p => p.parentPageId === parentPageId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const currentPage = () => pages().find(p => p.id === currentPageId()) ?? null
  const pageById = (id: string) => pages().find(p => p.id === id) ?? null

  // --- Page CRUD ---
  const createPage = async (title = '새 페이지', parentPageId: string | null = null, navigate = true) => {
    const now = Date.now()
    const siblings = pages().filter(p => !p.deleted && p.parentPageId === parentPageId)
    for (const s of siblings) {
      await db.pages.update(s.id, { order: (s.order ?? 0) + 1 })
    }
    const page: Page = {
      id: generateId(),
      title,
      content: '',
      folderId: null,
      parentPageId,
      deleted: false,
      order: 0,
      createdAt: now,
      updatedAt: now,
    }
    await db.pages.add(page)
    setPages(prev => {
      const updated = prev.map(p =>
        (!p.deleted && p.parentPageId === parentPageId)
          ? { ...p, order: (p.order ?? 0) + 1 }
          : p
      )
      return [page, ...updated]
    })
    if (navigate) setCurrentPageId(page.id)
    const uid = user()?.uid
    if (uid) syncPageToCloud(uid, page)
    return page
  }

  const updatePage = async (id: string, updates: Partial<Pick<Page, 'title' | 'content'>>) => {
    const updatedAt = Date.now()
    await db.pages.update(id, { ...updates, updatedAt })
    setPages(prev => prev.map(p =>
      p.id === id ? { ...p, ...updates, updatedAt } : p
    ))
    const uid = user()?.uid
    if (uid) {
      const page = await db.pages.get(id)
      if (page) syncPageToCloud(uid, page)
    }
  }

  // 하위 페이지 ID를 재귀적으로 수집
  const getDescendantIds = (parentId: string): string[] => {
    const children = pages().filter(p => p.parentPageId === parentId)
    const ids: string[] = []
    for (const child of children) {
      ids.push(child.id)
      ids.push(...getDescendantIds(child.id))
    }
    return ids
  }

  const trashPage = async (id: string) => {
    const updatedAt = Date.now()
    const toTrash = [id, ...getDescendantIds(id)]
    for (const pid of toTrash) {
      await db.pages.update(pid, { deleted: true, updatedAt })
    }
    setPages(prev => prev.map(p =>
      toTrash.includes(p.id) ? { ...p, deleted: true, updatedAt } : p
    ))
    if (currentPageId() === id) {
      const active = pages().filter(p => !p.deleted && !toTrash.includes(p.id))
      setCurrentPageId(active.length > 0 ? active[0].id : null)
    }
    const uid = user()?.uid
    if (uid) {
      for (const pid of toTrash) {
        const page = await db.pages.get(pid)
        if (page) syncPageToCloud(uid, page)
      }
    }
  }

  const restorePage = async (id: string) => {
    const updatedAt = Date.now()
    const toRestore = [id, ...getDescendantIds(id)]
    for (const pid of toRestore) {
      await db.pages.update(pid, { deleted: false, updatedAt })
    }
    setPages(prev => prev.map(p =>
      toRestore.includes(p.id) ? { ...p, deleted: false, updatedAt } : p
    ))
    const uid = user()?.uid
    if (uid) {
      for (const pid of toRestore) {
        const page = await db.pages.get(pid)
        if (page) syncPageToCloud(uid, page)
      }
    }
  }

  const deletePage = async (id: string) => {
    const toDelete = [id, ...getDescendantIds(id)]
    await db.pages.bulkDelete(toDelete)
    const currentId = currentPageId()
    setPages(prev => prev.filter(p => !toDelete.includes(p.id)))
    if (toDelete.includes(currentId!)) {
      const active = pages().filter(p => !p.deleted && !toDelete.includes(p.id))
      setCurrentPageId(active.length > 0 ? active[0].id : null)
    }
    const uid = user()?.uid
    if (uid) toDelete.forEach(pid => deletePageFromCloud(uid, pid))
  }

  const emptyTrash = async () => {
    const trashed = pages().filter(p => p.deleted)
    const ids = trashed.map(p => p.id)
    await db.pages.bulkDelete(ids)
    setPages(prev => prev.filter(p => !p.deleted))
    const uid = user()?.uid
    if (uid) ids.forEach(id => deletePageFromCloud(uid, id))
  }

  // --- Reorder pages (same parent) ---
  const reorderPage = async (pageId: string, newIndex: number, parentPageId: string | null) => {
    const siblings = activePages()
      .filter(p => p.parentPageId === parentPageId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const oldIndex = siblings.findIndex(p => p.id === pageId)
    if (oldIndex === -1 || oldIndex === newIndex) return

    const reordered = [...siblings]
    const [moved] = reordered.splice(oldIndex, 1)
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
    setPages(prev => prev.map(p => {
      const idx = reordered.findIndex(r => r.id === p.id)
      return idx !== -1 ? { ...p, order: idx } : p
    }))
  }

  // 페이지의 조상 ID 배열 (root → ... → parent 순서)
  const getAncestorIds = (pageId: string): string[] => {
    const ids: string[] = []
    let current = pageById(pageId)
    while (current && current.parentPageId) {
      ids.unshift(current.parentPageId)
      current = pageById(current.parentPageId)
    }
    return ids
  }

  // 페이지 경로 문자열 (페이지명 기반): /페이지1/하위1/하위2
  const getPagePath = (pageId: string): string => {
    const parts: string[] = []
    let current = pageById(pageId)
    while (current) {
      parts.unshift(encodeURIComponent(current.title || current.id))
      current = current.parentPageId ? pageById(current.parentPageId) : null
    }
    return '/' + parts.join('/')
  }

  // 페이지 경로 문자열로 페이지 찾기
  const findPageByPath = (path: string): Page | null => {
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
    if (parts.length === 0) return null
    let candidates = rootPages()
    let found: Page | null = null
    for (const part of parts) {
      found = candidates.find(p => (p.title || p.id) === part) ?? null
      if (!found) return null
      candidates = subPages(found.id)
    }
    return found
  }

  // --- Move page to different parent ---
  const movePageToParent = async (pageId: string, newParentPageId: string | null) => {
    const siblings = activePages().filter(p => p.parentPageId === newParentPageId)
    const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(p => p.order ?? 0)) + 1 : 0
    const updatedAt = Date.now()
    await db.pages.update(pageId, { parentPageId: newParentPageId, folderId: null, order: maxOrder, updatedAt })
    setPages(prev => prev.map(p =>
      p.id === pageId ? { ...p, parentPageId: newParentPageId, folderId: null, order: maxOrder, updatedAt } : p
    ))
    const uid = user()?.uid
    if (uid) {
      const page = await db.pages.get(pageId)
      if (page) syncPageToCloud(uid, page)
    }
  }

  return {
    pages,
    currentPageId,
    currentPage,
    showTrash,
    setShowTrash,
    setCurrentPageId,
    activePages,
    trashedPages,
    rootPages,
    subPages,
    pageById,
    loadAll,
    loadPages,
    createPage,
    updatePage,
    trashPage,
    restorePage,
    deletePage,
    emptyTrash,
    reorderPage,
    movePageToParent,
    getAncestorIds,
    getPagePath,
    findPageByPath,
  }
}
