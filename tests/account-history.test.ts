import { afterEach, describe, expect, it } from 'vitest'
import { AccountArchive, hashText } from '../src/history/archive'
import { restoreArchivedPages, importPreviousDevicePages } from '../src/history/restore'
import { createDatabase, putLocalPages, removeLocalPages, type AppDatabase, type Page } from '../src/db'
import { INTERVAL, RETENTION, CONTROL_ID, OBJECT_PREFIX, CHUNK_PREFIX, MAX_HISTORY_BYTES, MAX_OBJECTS,
  type HistoryStorage, type HistoryRecord, type HistoryControl, type ListOptions } from '../src/history/model'

const NOW = Date.UTC(2026, 10, 3, 0, 0, 0)
const body = (text: string) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const page = (id = crypto.randomUUID(), text = 'original'): Page => ({ id, title: '문서', content: body(text), parentPageId: null, folderId: null,
  hidden: false, deleted: false, order: 0, createdAt: 1, updatedAt: 1 })
class MemoryStorage implements HistoryStorage {
  records = new Map<string, HistoryRecord>()
  pages: Page[] = [page()]
  locked = false
  reads = 0
  failKind = ''
  async get(id: string) { return structuredClone(this.records.get(id) ?? null) }
  async list(prefix: string, options: ListOptions = {}) {
    let records = [...this.records.values()].filter(r => r.id.startsWith(prefix) && (!options.before || r.id < options.before) && (!options.through || r.id <= options.through) && (!options.after || r.id > options.after)).sort((a,b) => a.id.localeCompare(b.id))
    if (options.descending) records.reverse()
    if (options.limit) records = records.slice(0, options.limit)
    return structuredClone(records)
  }
  async put(records: HistoryRecord[]) { for (const r of records) { if (r.kind === this.failKind) throw new Error('network failure'); this.records.set(r.id, structuredClone(r)) } }
  async remove(ids: string[]) { ids.forEach(id => this.records.delete(id)) }
  async currentPages() { this.reads++; return structuredClone(this.pages) }
  async exclusive<T>(task: (control: HistoryControl, save: () => Promise<void>) => Promise<T>) {
    if (this.locked) return undefined
    this.locked = true
    const c = structuredClone(this.records.get(CONTROL_ID) ?? { id: CONTROL_ID, kind: 'control', createdAt: NOW, owner: '', leaseUntil: 0,
      lastAutoAt: 0, lastAutoId: '', lastGcAt: 0, usedBytes: 0, objectCount: 0 }) as HistoryControl
    try { return await task(c, async () => { this.records.set(CONTROL_ID, structuredClone(c)) }) }
    finally { this.locked = false }
  }
  objects() { return [...this.records.values()].filter(r => r.kind === 'object') }
  points() { return [...this.records.values()].filter(r => r.kind === 'checkpoint') }
}
const databases: AppDatabase[] = []
const makeDb = () => { const d = createDatabase('history-test-' + crypto.randomUUID(), 'account'); databases.push(d); return d }
afterEach(async () => { await Promise.all(databases.splice(0).map(d => d.delete())) })

describe('account history snapshots', () => {
  it('round-trips titles, body, hierarchy, hidden and trash pages', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage), parent = storage.pages[0]
    const child = { ...page(), parentPageId: parent.id, hidden: true, deleted: true }
    storage.pages.push(child)
    const point = (await archive.capture('auto', NOW))!
    expect(point.pages).toHaveLength(2)
    const restored = await archive.readPage(point, child.id, NOW)
    expect({ ...restored, content: JSON.parse(restored.content) }).toEqual({ ...child, content: JSON.parse(child.content) })
  })
  it('stores unchanged page content once across ten-minute checkpoints', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    await archive.capture('auto', NOW)
    storage.pages[0].updatedAt++
    storage.pages[0].revision = 'only-revision-changed'
    await archive.capture('auto', NOW + INTERVAL)
    expect(storage.points()).toHaveLength(2)
    expect(storage.objects()).toHaveLength(1)
  })
  it('deduplicates embedded images including images in reusable templates', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage), image = 'data:image/png;base64,aGVsbG8='
    const content = JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: image } },
      { type: 'actionButton', attrs: { templateContent: JSON.stringify([{ type: 'image', attrs: { src: image } }]) } }] })
    storage.pages = [{ ...page(), content }, { ...page(), content }]
    const point = (await archive.capture('auto', NOW))!
    const imageHash = await hashText(image)
    expect(storage.objects().filter(o => o.kind === 'object' && o.hash === imageHash)).toHaveLength(1)
    const restored = await archive.readPage(point, storage.pages[0].id, NOW)
    const doc = JSON.parse(restored.content)
    expect(doc.content[0].attrs.src).toBe(image)
    expect(JSON.parse(doc.content[1].attrs.templateContent)).toEqual([{ type: 'image', attrs: { src: image } }])
  })
  it('creates only one automatic checkpoint in a ten-minute bucket across sessions', async () => {
    const storage = new MemoryStorage(), first = new AccountArchive(storage), second = new AccountArchive(storage)
    const point = await first.capture('auto', NOW)
    expect((await second.capture('auto', NOW + 1000))?.id).toBe(point?.id)
    expect(storage.reads).toBe(1)
    expect(storage.points()).toHaveLength(1)
  })
  it('prevents simultaneous clients from running capture and garbage collection together', async () => {
    const storage = new MemoryStorage(), first = new AccountArchive(storage), second = new AccountArchive(storage)
    const results = await Promise.all([first.capture('auto', NOW), second.capture('auto', NOW)])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(storage.points()).toHaveLength(1)
  })
  it('does not publish a checkpoint after a partial upload failure', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    storage.failKind = 'chunk'
    await expect(archive.capture('auto', NOW)).rejects.toThrow('network failure')
    expect(storage.points()).toHaveLength(0)
    expect(storage.pages).toHaveLength(1)
    storage.failKind = ''
    await archive.capture('auto', NOW + 1)
    expect(storage.points()).toHaveLength(1)
  })
  it('detects corrupted payloads before they can be used to restore', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    const point = (await archive.capture('auto', NOW))!
    const chunk = [...storage.records.values()].find(r => r.kind === 'chunk')!
    storage.records.set(chunk.id, { ...chunk, kind: 'chunk', data: 'tampered' })
    await expect(archive.readPage(point, storage.pages[0].id, NOW)).rejects.toThrow('검증')
  })
  it('removes expired checkpoints on reconnect while keeping current notes', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    const old = (await archive.capture('auto', NOW))!
    await archive.capture('auto', NOW + RETENTION + 1)
    expect(await storage.get(old.id)).toBeNull()
    expect(storage.pages[0].content).toContain('original')
    expect(storage.points()).toHaveLength(1)
    expect(storage.objects()).toHaveLength(1)
    await expect(archive.readPage(old, storage.pages[0].id, NOW + RETENTION + 1)).rejects.toThrow('만료')
  })
  it('keeps an old content object while recent checkpoints still reference it', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    const first = (await archive.capture('auto', NOW))!, oldObject = first.pages[0].object
    const day = 24 * 60 * 60 * 1000
    const recent = (await archive.capture('auto', NOW + 6 * day))!
    storage.pages[0].content = body('new')
    await archive.capture('auto', NOW + 8 * day)
    expect(await storage.get(first.id)).toBeNull()
    expect(await storage.get(OBJECT_PREFIX + oldObject)).not.toBeNull()
    expect((await archive.readPage(recent, storage.pages[0].id, NOW + 8 * day)).content).toContain('original')
  })
  it('selects the actual last saved point before a target time and rejects unavailable times', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    const first = (await archive.capture('auto', NOW))!
    await archive.capture('auto', NOW + INTERVAL)
    expect((await archive.nearest(NOW + 5000, NOW + INTERVAL))?.id).toBe(first.id)
    expect(await archive.nearest(NOW - 1, NOW + INTERVAL)).toBeNull()
    expect(await archive.nearest(NaN, NOW)).toBeNull()
    expect(await archive.nearest(NOW + 1, NOW)).toBeNull()
  })
  it('always records a pre-restore checkpoint, even in the same ten-minute bucket', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    const automatic = await archive.capture('auto', NOW)
    storage.pages[0].content = body('right before restore')
    const before = (await archive.capture('before-restore', NOW + 10))!
    expect(before.id).not.toBe(automatic?.id)
    expect((await archive.readPage(before, storage.pages[0].id, NOW + 10)).content).toContain('right before restore')
  })
  it('enforces the history cap without deleting or changing the current document', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    await archive.capture('auto', NOW)
    const control = storage.records.get(CONTROL_ID) as HistoryControl
    storage.records.set(CONTROL_ID, { ...control, objectCount: MAX_OBJECTS, usedBytes: MAX_HISTORY_BYTES })
    storage.pages[0].content = body('new unsnapshotted content')
    await expect(archive.capture('auto', NOW + INTERVAL)).rejects.toThrow('보관 한도')
    expect(storage.pages[0].content).toContain('new unsnapshotted content')
    expect(storage.points()).toHaveLength(1)
  })
  it('handles large Unicode payloads split across multiple chunks', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage), text = '수학🙂'.repeat(30000)
    storage.pages[0].content = body(text)
    const point = (await archive.capture('auto', NOW))!
    expect([...storage.records.keys()].filter(k => k.startsWith(CHUNK_PREFIX)).length).toBeGreaterThan(1)
    expect((await archive.readPage(point, storage.pages[0].id, NOW)).content).toContain(text)
  })
})

describe('restoring individual pages and workspaces', () => {
  it('restores a live page in place while leaving its current parent, children and other pages intact', async () => {
    const d = makeDb(), parent = page(), original = { ...page(), parentPageId: parent.id, order: 4 }, child = { ...page(), parentPageId: original.id }
    await putLocalPages(d, [parent, original, child])
    const id = await restoreArchivedPages(d, [{ ...original, title: 'old title', content: body('old body'), parentPageId: null, order: 0 }], true)
    expect(id).toBe(original.id)
    expect((await d.pages.get(id!))?.parentPageId).toBe(parent.id)
    expect((await d.pages.get(id!))?.order).toBe(4)
    expect((await d.pages.get(id!))?.content).toContain('old body')
    expect((await d.pages.get(child.id))?.parentPageId).toBe(original.id)
    expect(await d.pages.count()).toBe(3)
  })
  it('recovers a permanently deleted page using a fresh id without resurrecting its tombstone', async () => {
    const d = makeDb(), original = { ...page(), deleted: true }
    await putLocalPages(d, [original]); await removeLocalPages(d, [original.id])
    const id = await restoreArchivedPages(d, [original], true)
    expect(id).not.toBe(original.id)
    expect(await d.pages.get(original.id)).toBeUndefined()
    expect(await d.tombstones.get(original.id)).toBeDefined()
    expect((await d.pages.get(id!))?.deleted).toBe(false)
  })
  it('restores an entire workspace while retaining live ids and remapping permanently deleted internal links', async () => {
    const d = makeDb(), live = page(), removed = page(), extra = page()
    live.content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: '#' + removed.id } }] }] }] })
    await putLocalPages(d, [live, removed, extra]); await removeLocalPages(d, [removed.id])
    await restoreArchivedPages(d, [live, removed])
    const all = await d.pages.toArray(), recovered = all.find(p => p.id !== live.id)!
    expect(all).toHaveLength(2)
    expect(all.some(p => p.id === live.id)).toBe(true)
    expect(recovered.id).not.toBe(removed.id)
    expect((await d.pages.get(live.id))?.content).toContain('#' + recovered.id)
    expect(await d.tombstones.get(extra.id)).toBeDefined()
  })
  it('rolls back the entire restore if an insertion fails', async () => {
    const d = makeDb(), original = page()
    await putLocalPages(d, [original])
    const fail = (_key: unknown, value: Page) => { if (value.title === 'FAIL') throw new Error('disk full') }
    d.pages.hook('creating', fail)
    await expect(restoreArchivedPages(d, [{ ...page(), title: 'FAIL' }])).rejects.toThrow('disk full')
    d.pages.hook('creating').unsubscribe(fail)
    expect((await d.pages.toArray())[0].id).toBe(original.id)
    expect(await d.tombstones.count()).toBe(0)
  })
  it('copies legacy local pages into the chosen account without replacing existing notes', async () => {
    const d = makeDb(), existing = page(), legacy = page()
    await putLocalPages(d, [existing])
    await importPreviousDevicePages(d, [legacy])
    expect(await d.pages.count()).toBe(2)
    expect(await d.pages.get(existing.id)).toBeDefined()
    expect(await d.pages.get(legacy.id)).toBeUndefined()
  })
})

describe('retention clock', () => {
  it('uses the server clock instead of a future device clock for retention decisions', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    const first = (await archive.capture('auto', NOW))!
    const control = storage.records.get(CONTROL_ID) as HistoryControl
    storage.records.set(CONTROL_ID, { ...control, serverNow: NOW + INTERVAL })
    const next = (await archive.capture('auto', NOW + RETENTION * 3))!
    expect(next.createdAt).toBe(NOW + INTERVAL)
    expect(await storage.get(first.id)).not.toBeNull()
  })
})


describe('layout deduplication', () => {
  it('does not duplicate a page body when only its order changes', async () => {
    const storage = new MemoryStorage(), archive = new AccountArchive(storage)
    const first = (await archive.capture('auto', NOW))!
    storage.pages[0].order = 9
    const second = (await archive.capture('auto', NOW + INTERVAL))!
    expect(first.pages[0].object).toBe(second.pages[0].object)
    expect(storage.objects()).toHaveLength(1)
    expect((await archive.readPage(first, storage.pages[0].id, NOW + INTERVAL)).order).toBe(0)
    expect((await archive.readPage(second, storage.pages[0].id, NOW + INTERVAL)).order).toBe(9)
  })
})
