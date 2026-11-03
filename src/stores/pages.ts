import { createSignal } from 'solid-js'
import { db, nextTime, pageTables, putLocalPages, repairPageCycles, removeLocalPages, type AppDatabase, type Page } from '../db'
import { trackWrite } from './persistence'
import { preserveConflict } from '../db/conflicts'
import { sameDocument } from '../utils/documentEquality'

export function createPageStore() {
  const [pages, setPages] = createSignal<Page[]>([])
  const [currentPageId, setCurrentPageId] = createSignal<string | null>(null)
  const [showTrash, setShowTrash] = createSignal(false)
  let loadVersion = 0
  let loadChain: Promise<void> = Promise.resolve()
  const loadPages = () => {
    const source = db
    const version = loadVersion
    // Every caller waits for its own UI refresh. A background liveQuery refresh
    // must not cancel the foreground save's refresh and leave stale editor props.
    const result = loadChain.then(async () => {
      await repairPageCycles(source)
      const all = await source.pages.orderBy('updatedAt').reverse().toArray()
      if (db !== source || version !== loadVersion) return
      setPages(all)
      if (!all.some(p => p.id === currentPageId())) setCurrentPageId(all.find(p => !p.deleted)?.id ?? null)
    })
    loadChain = result.catch(() => {})
    return result
  }
  const reset = () => { loadVersion++; setPages([]); setCurrentPageId(null); setShowTrash(false) }
  const activePages = () => pages().filter(p => !p.deleted)
  const pageById = (id: string) => pages().find(p => p.id === id) ?? null
  const hiddenPages = () => activePages().filter(p => p.hidden)
  const trashedPages = () => pages().filter(p => p.deleted && (!p.parentPageId || !pageById(p.parentPageId)?.deleted))
  // Broken legacy/cross-device parents must not make a page inaccessible.
  const rootPages = () => activePages().filter(p => !p.hidden && (!p.parentPageId || !pageById(p.parentPageId) || pageById(p.parentPageId)?.deleted))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const subPages = (parentId: string) => activePages().filter(p => !p.hidden && p.parentPageId === parentId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const currentPage = () => pageById(currentPageId() ?? '')

  const descendants = (all: Page[], id: string) => {
    const seen = new Set<string>([id])
    const queue = [id]
    for (let i = 0; i < queue.length; i++) {
      for (const p of all) if (p.parentPageId === queue[i] && !seen.has(p.id)) { seen.add(p.id); queue.push(p.id) }
    }
    return queue
  }
  const transaction = <T>(database: AppDatabase, task: () => Promise<T>) => database.transaction('rw',
    pageTables(database), task)
  const mutate = <T>(task: (database: AppDatabase) => Promise<T>) => {
    const database = db
    return trackWrite(task(database).then(async result => {
      if (database === db) await loadPages()
      window.dispatchEvent(new Event('mymo:local-change'))
      return result
    }))
  }
  const changed = (page: Page, updates: Partial<Page>): Page => ({ ...page, ...updates, updatedAt: nextTime(page.updatedAt) })

  const createPage = (title = '새 페이지', parentPageId: string | null = null, navigate = true) => mutate(database => transaction(database, async () => {
    if (parentPageId) {
      const parent = await database.pages.get(parentPageId)
      if (!parent || parent.deleted) throw new Error('부모 페이지가 없습니다.')
    }
    const siblings = (await database.pages.toArray()).filter(p => !p.deleted && p.parentPageId === parentPageId)
    const now = Date.now()
    const page: Page = { id: crypto.randomUUID(), title, content: '', parentPageId, folderId: null,
      hidden: false, deleted: false, order: 0, createdAt: now, updatedAt: now }
    await putLocalPages(database, [page, ...siblings.map(p => changed(p, { order: p.order + 1 }))])
    if (database === db && navigate) setCurrentPageId(page.id)
    return page
  }))

  const updatePage = (id: string, updates: Partial<Pick<Page, 'title' | 'content'>>, base: { content?: string; title?: string } = {}) => mutate(database => transaction(database, async () => {
    const old = await database.pages.get(id)
    if (!old || old.deleted) return
    if ((updates.title === undefined || updates.title === old.title) && (updates.content === undefined || (updates.content !== undefined && sameDocument(updates.content, old.content)))) return
    const updated = changed(old, updates)
    const modified: Page[] = [updated]
    if ((base.content !== undefined && !sameDocument(base.content, old.content) && updates.content !== undefined && !sameDocument(updates.content, old.content)) ||
        (base.title !== undefined && base.title !== old.title && updates.title !== undefined && updates.title !== old.title)) {
      // A remote/tab update can land between the input event and this transaction.
      // Keep the unseen version rather than silently replacing it.
      if (await preserveConflict(database, old)) window.dispatchEvent(new Event('mymo:conflict'))
    }
    if (updates.title !== undefined) {
      for (const page of await database.pages.toArray()) {
        if (page.id === id || !page.content) continue
        let doc: any
        try { doc = JSON.parse(page.content) } catch { continue }
        let touched = false
        const walk = (node: any) => {
          if (!node || typeof node !== 'object') return
          if (Array.isArray(node.content)) node.content.forEach(walk)
          for (const mark of node.marks ?? []) {
            if (mark.type !== 'link') continue
            const href = String(mark.attrs?.href ?? '')
            if (href !== '#' + id) continue
            if (typeof node.text === 'string' && (node.text.startsWith('📄 ') || node.text === old.title)) {
              node.text = '📄 ' + updates.title
              touched = true
            }
          }
        }
        walk(doc)
        if (touched) modified.push(changed(page, { content: JSON.stringify(doc) }))
      }
    }
    await putLocalPages(database, modified)
  }))

  const setDeleted = (id: string, deleted: boolean) => mutate(database => transaction(database, async () => {
    const all = await database.pages.toArray()
    const ids = new Set(descendants(all, id))
    await putLocalPages(database, all.filter(p => ids.has(p.id)).map(p => changed(p, { deleted })))
    if (database === db && deleted && ids.has(currentPageId() ?? '')) setCurrentPageId(all.find(p => !p.deleted && !ids.has(p.id))?.id ?? null)
  }))
  const trashPage = (id: string) => setDeleted(id, true)
  const restorePage = (id: string) => setDeleted(id, false)
  const setPageHidden = (id: string, hidden: boolean) => mutate(database => transaction(database, async () => {
    const page = await database.pages.get(id)
    if (page) await putLocalPages(database, [changed(page, { hidden })])
  }))
  const deletePage = (id: string) => mutate(database => transaction(database, async () => {
    const all = await database.pages.toArray()
    await removeLocalPages(database, descendants(all, id))
  }))
  const emptyTrash = () => mutate(database => transaction(database, async () => {
    const ids = (await database.pages.toArray()).filter(p => p.deleted).map(p => p.id)
    await removeLocalPages(database, ids)
  }))

  // Move and reorder atomically: the target parent must exist and cannot be a descendant.
  const movePageToParent = (pageId: string, parentId: string | null, newIndex?: number) => mutate(database => transaction(database, async () => {
    const all = await database.pages.toArray()
    const page = all.find(p => p.id === pageId && !p.deleted)
    if (!page) return
    if (parentId) {
      if (descendants(all, pageId).includes(parentId)) throw new Error('자신 또는 하위 페이지 아래로 이동할 수 없습니다.')
      if (!all.some(p => p.id === parentId && !p.deleted)) throw new Error('부모 페이지가 없습니다.')
    }
    const siblings = all.filter(p => !p.deleted && p.parentPageId === parentId).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    const oldIndex = siblings.findIndex(p => p.id === pageId)
    const rest = siblings.filter(p => p.id !== pageId)
    const index = newIndex === undefined ? rest.length : Math.max(0, Math.min(rest.length, oldIndex >= 0 && oldIndex < newIndex ? newIndex - 1 : newIndex))
    rest.splice(index, 0, { ...page, parentPageId: parentId, folderId: null })
    const updates = rest.filter((p, i) => p.id === pageId || p.order !== i).map(p => changed(p, { order: rest.findIndex(r => r.id === p.id) }))
    await putLocalPages(database, updates)
  }))
  const reorderPage = (pageId: string, index: number, parentId: string | null) => movePageToParent(pageId, parentId, index)

  const getAncestorIds = (pageId: string) => {
    const ids: string[] = []
    const seen = new Set([pageId])
    let current = pageById(pageId)
    while (current?.parentPageId && !seen.has(current.parentPageId)) {
      seen.add(current.parentPageId)
      if (!pageById(current.parentPageId)) break
      ids.unshift(current.parentPageId)
      current = pageById(current.parentPageId)
    }
    return ids
  }
  const getPagePath = (id: string) => '/' + [...getAncestorIds(id), id].map(pid => encodeURIComponent(pageById(pid)?.title || pid)).join('/')
  const findPageByPath = (path: string): Page | null => {
    let parts: string[]
    try { parts = path.split('/').filter(Boolean).map(decodeURIComponent) } catch { return null }
    let candidates = rootPages()
    let found: Page | null = null
    for (const part of parts) {
      found = candidates.find(p => (p.title || p.id) === part) ?? null
      if (!found) return null
      candidates = subPages(found.id)
    }
    return found
  }
  return { pages, currentPageId, currentPage, showTrash, setShowTrash, setCurrentPageId, activePages, hiddenPages,
    trashedPages, rootPages, subPages, pageById, loadAll: loadPages, loadPages, reset, createPage, updatePage,
    trashPage, restorePage, setPageHidden, deletePage, emptyTrash, reorderPage, movePageToParent, getAncestorIds, getPagePath, findPageByPath }
}
