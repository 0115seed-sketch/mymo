import { afterEach, describe, expect, it } from 'vitest'
import { activateDatabase, createDatabase, db, putLocalPages, removeLocalPages, isTombstone, revisionOf, type AppDatabase, type CloudPage, type Page, type PendingChange } from '../src/db'
import { PageSyncEngine, type RemotePages } from '../src/stores/syncEngine'
import { createPageStore } from '../src/stores/pages'
import { flushPendingWrites, setStorageError } from '../src/stores/persistence'
import { restoreBackup, validateBackup } from '../src/utils/backup'

const databases: AppDatabase[] = []
const makeDb = () => { const d = createDatabase('test-' + crypto.randomUUID(), 'test-user'); databases.push(d); return d }
const body = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const page = (id = crypto.randomUUID(), text = 'original'): Page => ({ id, title: '문서', content: body(text), parentPageId: null, folderId: null,
  deleted: false, hidden: false, order: 0, createdAt: 1, updatedAt: 1 })
function server() {
  const records = new Map<string, CloudPage>()
  let offline = false
  const remote: RemotePages = {
    list: async () => { if (offline) throw new Error('offline'); return structuredClone([...records.values()]) },
    compareAndSet: async (change: PendingChange) => {
      if (offline) throw new Error('offline')
      const current = records.get(change.id) ?? null
      if (current && revisionOf(current) === revisionOf(change.page)) return { written: true, remote: current }
      if ((current && isTombstone(current)) || (current ? revisionOf(current) : null) !== change.baseRevision) return { written: false, remote: current }
      records.set(change.id, structuredClone(change.page))
      return { written: true, remote: change.page }
    },
  }
  return { records, remote, offline: (value: boolean) => { offline = value } }
}
afterEach(async () => { setStorageError(''); await Promise.all(databases.splice(0).map(d => d.delete())) })

describe('storage and account safety', () => {
  it('preserves immediate edits when navigating before 300ms', async () => {
    activateDatabase('test-navigation-' + crypto.randomUUID())
    databases.push(db)
    const store = createPageStore()
    const first = await store.createPage()
    const second = await store.createPage()
    const saving = store.updatePage(first.id, { content: body('마지막 입력') })
    store.setCurrentPageId(second.id)
    await flushPendingWrites()
    await saving
    expect((await db.pages.get(first.id))?.content).toContain('마지막 입력')
    expect(store.currentPageId()).toBe(second.id)
  })
  it('isolates guest and Google accounts, including an in-flight write', async () => {
    const first = activateDatabase('test-A-' + crypto.randomUUID()); databases.push(first)
    const store = createPageStore()
    const creating = store.createPage('A 자료')
    const second = activateDatabase('test-B-' + crypto.randomUUID()); databases.push(second)
    const saved = await creating
    expect(await first.pages.get(saved.id)).toBeDefined()
    expect(await second.pages.count()).toBe(0)
    expect(await second.outbox.count()).toBe(0)
    expect(activateDatabase(null)).not.toBe(first)
    expect(activateDatabase(first.accountId)).toBe(first)
  })
  it('queues failed uploads durably and retries after reopening IndexedDB', async () => {
    const d = makeDb(), cloud = server(), p = page()
    await putLocalPages(d, [p]); cloud.offline(true)
    const engine = new PageSyncEngine(d, cloud.remote)
    await expect(engine.flush()).rejects.toThrow('offline')
    d.close(); await d.open()
    expect(await d.outbox.count()).toBe(1)
    expect((await d.pages.get(p.id))?.content).toBe(p.content)
    cloud.offline(false); await engine.flush()
    expect(await d.outbox.count()).toBe(0)
    expect(cloud.records.has(p.id)).toBe(true)
  })
  it('merges local-only and cloud-only pages on login', async () => {
    const d = makeDb(), cloud = server(), local = page(), remote = page()
    cloud.records.set(remote.id, remote)
    await putLocalPages(d, [local])
    const engine = new PageSyncEngine(d, cloud.remote)
    await engine.pull(); await engine.flush()
    expect(await d.pages.count()).toBe(2)
    expect(cloud.records.size).toBe(2)
  })
})

describe('multiple devices', () => {
  it('preserves both concurrent edits as an original and conflict copy', async () => {
    const a = makeDb(), b = makeDb(), cloud = server(), p = page()
    const ea = new PageSyncEngine(a, cloud.remote), eb = new PageSyncEngine(b, cloud.remote)
    await putLocalPages(a, [p]); await ea.flush(); await eb.pull()
    await putLocalPages(a, [{ ...p, content: body('기기 A') }])
    await putLocalPages(b, [{ ...p, content: body('기기 B') }])
    await ea.flush(); await eb.pull(); await eb.flush()
    const values = await b.pages.toArray()
    expect(values.find(v => v.id === p.id)?.content).toContain('기기 A')
    expect(values.find(v => v.title.includes('충돌 복사본'))?.content).toContain('기기 B')
    expect(cloud.records.size).toBe(2)
  })
  it('rebases a second edit made while an upload is in flight', async () => {
    const d = makeDb(), cloud = server(), p = page()
    await putLocalPages(d, [p])
    const realWrite = cloud.remote.compareAndSet
    let first = true
    cloud.remote.compareAndSet = async change => {
      if (first) { first = false; await putLocalPages(d, [{ ...p, content: body('newer') }]) }
      return realWrite(change)
    }
    await new PageSyncEngine(d, cloud.remote).flush()
    expect(cloud.records.get(p.id)?.content).toContain('newer')
    expect(await d.pages.count()).toBe(1)
    expect(await d.outbox.count()).toBe(0)
  })
  it('does not resurrect a permanently deleted page from an offline device', async () => {
    const a = makeDb(), b = makeDb(), cloud = server(), p = page()
    const ea = new PageSyncEngine(a, cloud.remote), eb = new PageSyncEngine(b, cloud.remote)
    await putLocalPages(a, [p]); await ea.flush(); await eb.pull()
    await putLocalPages(b, [{ ...p, content: body('offline work') }])
    await removeLocalPages(a, [p.id]); await ea.flush(); await eb.flush()
    expect(isTombstone(cloud.records.get(p.id)!)).toBe(true)
    expect(await b.pages.get(p.id)).toBeUndefined()
    expect((await b.pages.toArray())[0].content).toContain('offline work')
  })
  it('preserves a newer remote edit before permanent deletion', async () => {
    const a = makeDb(), b = makeDb(), cloud = server(), p = page()
    const ea = new PageSyncEngine(a, cloud.remote), eb = new PageSyncEngine(b, cloud.remote)
    await putLocalPages(a, [p]); await ea.flush(); await eb.pull()
    await removeLocalPages(a, [p.id])
    await putLocalPages(b, [{ ...p, content: body('new remote work') }]); await eb.flush(); await ea.flush()
    expect(isTombstone(cloud.records.get(p.id)!)).toBe(true)
    expect((await a.pages.toArray())[0].content).toContain('new remote work')
  })
  it('applies remote and legacy deletions to local data', async () => {
    const d = makeDb(), cloud = server(), p = page()
    const engine = new PageSyncEngine(d, cloud.remote)
    await putLocalPages(d, [p]); await engine.flush()
    cloud.records.delete(p.id)
    await engine.pull(); await engine.flush()
    expect(await d.pages.get(p.id)).toBeUndefined()
    expect(await d.tombstones.get(p.id)).toBeDefined()
    expect(isTombstone(cloud.records.get(p.id)!)).toBe(true)
  })
  it('synchronizes page order and timestamps', async () => {
    const source = activateDatabase('test-order-' + crypto.randomUUID()); databases.push(source)
    const store = createPageStore()
    const one = await store.createPage('one'), two = await store.createPage('two')
    const before = await source.pages.get(one.id)
    await store.reorderPage(one.id, 0, null)
    const cloud = server(), target = makeDb()
    await new PageSyncEngine(source, cloud.remote).flush()
    await new PageSyncEngine(target, cloud.remote).pull()
    expect((await target.pages.orderBy('order').toArray()).map(p => p.title)).toEqual(['one', 'two'])
    expect((await source.pages.get(one.id))!.updatedAt).toBeGreaterThan(before!.updatedAt)
    expect(await target.pages.get(two.id)).toBeDefined()
  })
  it('rejects moving a parent under its descendant without changing the tree', async () => {
    const source = activateDatabase('test-cycle-' + crypto.randomUUID()); databases.push(source)
    const store = createPageStore(), parent = await store.createPage(), child = await store.createPage('child', parent.id)
    await expect(store.movePageToParent(parent.id, child.id)).rejects.toThrow('하위 페이지')
    expect((await source.pages.get(parent.id))?.parentPageId).toBeNull()
    expect(store.getAncestorIds(child.id)).toEqual([parent.id])
  })
  it('ignores a network result after its session is stopped', async () => {
    const d = makeDb(), cloud = server(), p = page()
    let finish!: (value: CloudPage[]) => void
    cloud.remote.list = () => new Promise(resolve => { finish = resolve })
    const engine = new PageSyncEngine(d, cloud.remote), pulling = engine.pull()
    await Promise.resolve(); engine.stop(); finish([p]); await pulling
    expect(await d.pages.count()).toBe(0)
  })
})

describe('transactional backup restoration', () => {
  const backup = (pages: Page[]) => ({ app: 'mymo', version: 3, pages, folders: [] })
  it('rejects malformed content and cyclic backups before deleting any data', async () => {
    const d = makeDb(), original = page()
    await putLocalPages(d, [original])
    await expect(restoreBackup(d, backup([{ ...page(), content: '{broken' }]))).rejects.toThrow()
    const cyclic = page(); cyclic.parentPageId = cyclic.id
    expect(() => validateBackup(backup([cyclic]))).toThrow('순환')
    expect((await d.pages.toArray())[0].id).toBe(original.id)
    expect(await d.recovery.count()).toBe(0)
  })
  it('rolls back all deletes, snapshots and upload requests when insertion fails', async () => {
    const d = makeDb(), original = page()
    await putLocalPages(d, [original])
    const before = await d.outbox.toArray()
    const fail = (_key: unknown, value: Page) => { if (value.title === 'FAIL') throw new Error('disk full') }
    d.pages.hook('creating', fail)
    await expect(restoreBackup(d, backup([{ ...page(), title: 'FAIL' }]))).rejects.toThrow('disk full')
    d.pages.hook('creating').unsubscribe(fail)
    expect((await d.pages.toArray())[0].id).toBe(original.id)
    expect(await d.outbox.toArray()).toEqual(before)
    expect(await d.tombstones.count()).toBe(0)
    expect(await d.recovery.count()).toBe(0)
  })
  it('keeps a recovery snapshot, remaps internal links, and propagates replacements', async () => {
    const d = makeDb(), cloud = server(), old = page(), child = page()
    child.parentPageId = old.id
    old.content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'child', marks: [{ type: 'link', attrs: { href: '#' + child.id } }] }] }] })
    const engine = new PageSyncEngine(d, cloud.remote)
    await putLocalPages(d, [old, child]); await engine.flush()
    await restoreBackup(d, backup([old, child])); await engine.flush()
    const restored = await d.pages.toArray(), parent = restored.find(p => !p.parentPageId)!, sub = restored.find(p => p.parentPageId)!
    expect(parent.id).not.toBe(old.id)
    expect(sub.parentPageId).toBe(parent.id)
    expect(parent.content).toContain('#' + sub.id)
    expect((await d.recovery.toArray())[0].pages).toHaveLength(2)
    expect(isTombstone(cloud.records.get(old.id)!)).toBe(true)
    expect([...cloud.records.values()].filter(p => !isTombstone(p))).toHaveLength(2)
  })
})

describe('input and tree races', () => {
  it('preserves an unseen remote edit that lands just before an input transaction', async () => {
    const source = activateDatabase('test-input-race-' + crypto.randomUUID()); databases.push(source)
    const store = createPageStore(), original = await store.createPage('original')
    await store.updatePage(original.id, { content: body('old view') })
    await source.pages.update(original.id, { content: body('unseen remote edit'), revision: 'remote-revision' })
    await store.updatePage(original.id, { content: body('local typing') }, { content: body('old view') })
    const pages = await source.pages.toArray()
    expect(pages.find(p => p.id === original.id)?.content).toContain('local typing')
    expect(pages.find(p => p.id !== original.id)?.content).toContain('unseen remote edit')
  })
  it('repairs a concurrent cross-device parent cycle without losing either page', async () => {
    const source = activateDatabase('test-repair-cycle-' + crypto.randomUUID()); databases.push(source)
    const first = page('a'), second = page('b')
    first.parentPageId = second.id; second.parentPageId = first.id
    await source.pages.bulkPut([first, second])
    const store = createPageStore(); await store.loadAll()
    expect(await source.pages.count()).toBe(2)
    expect((await source.pages.get('a'))?.parentPageId).toBeNull()
    expect(store.rootPages().map(p => p.id)).toContain('a')
    expect(store.getAncestorIds('b')).toEqual(['a'])
    expect(await source.outbox.get('a')).toBeDefined()
  })
})
