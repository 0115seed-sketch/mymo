import { type AppDatabase, type Page, type CloudPage, type PendingChange, type Tombstone, isTombstone, revisionOf, nextTime } from '../db'

export interface RemotePages {
  list: () => Promise<CloudPage[]>
  compareAndSet: (change: PendingChange) => Promise<{ written: boolean; remote: CloudPage | null }>
}

// Transport-independent so real IndexedDB transactions and network failures can be tested.
export class PageSyncEngine {
  readonly database: AppDatabase
  readonly remote: RemotePages
  readonly onConflict: () => void
  private stopped = false
  private chain: Promise<unknown> = Promise.resolve()
  constructor(database: AppDatabase, remote: RemotePages, onConflict = () => {}) {
    this.database = database
    this.remote = remote
    this.onConflict = onConflict
  }
  stop() { this.stopped = true }
  private serial<T>(task: () => Promise<T>) {
    const result = this.chain.then(task)
    this.chain = result.catch(() => {})
    return result
  }
  private async copyConflict(page: Page) {
    const id = crypto.randomUUID()
    const copy: Page = { ...page, id, title: (page.title || '제목 없음') + ' (충돌 복사본)', parentPageId: null, folderId: null,
      hidden: false, deleted: false, updatedAt: nextTime(page.updatedAt), revision: crypto.randomUUID() }
    await this.database.pages.put(copy)
    await this.database.outbox.put({ id, page: copy, baseRevision: null })
    this.onConflict()
  }
  private async accept(remote: CloudPage) {
    if (isTombstone(remote)) {
      await this.database.pages.delete(remote.id)
      await this.database.tombstones.put(remote)
    } else {
      await this.database.pages.put(remote)
    }
    await this.database.syncMeta.put({ id: remote.id, revision: revisionOf(remote) })
  }
  private async resolve(change: PendingChange, remote: CloudPage | null, written: boolean) {
    const d = this.database
    await d.transaction('rw', [d.pages, d.outbox, d.tombstones, d.syncMeta], async () => {
      const current = await d.outbox.get(change.id)
      if (!current) return
      if (written || (remote && revisionOf(remote) === revisionOf(change.page))) {
        await d.syncMeta.put({ id: change.id, revision: revisionOf(change.page) })
        // An edit made while the network write was in flight must remain queued.
        if (revisionOf(current.page) === revisionOf(change.page)) await d.outbox.delete(change.id)
        else await d.outbox.put({ ...current, baseRevision: revisionOf(change.page) })
        return
      }
      if (revisionOf(current.page) !== revisionOf(change.page)) return
      if (remote && !isTombstone(remote) && !isTombstone(current.page) && remote.title === current.page.title && remote.content === current.page.content) {
        await d.outbox.put({ ...current, baseRevision: revisionOf(remote) })
        return
      }
      if (isTombstone(current.page) && remote && !isTombstone(remote)) {
        // Preserve a newer remote edit before completing a permanent local deletion.
        await this.copyConflict(remote)
        await d.outbox.put({ ...current, baseRevision: revisionOf(remote) })
        return
      }
      if (!isTombstone(current.page)) await this.copyConflict(current.page)
      if (remote) {
        await this.accept(remote)
        await d.outbox.delete(change.id)
      } else {
        const tombstone: Tombstone = { ...current.page, title: '', content: '', deleted: true, hidden: true,
          permanentlyDeleted: true, revision: crypto.randomUUID(), updatedAt: nextTime(current.page.updatedAt) }
        await d.pages.delete(change.id)
        await d.tombstones.put(tombstone)
        await d.outbox.put({ id: change.id, page: tombstone, baseRevision: null })
      }
    })
  }
  pull() {
    return this.serial(async () => {
      const records = await this.remote.list()
      if (this.stopped) return
      const ids = new Set(records.map(p => p.id))
      for (const page of records) await this.receiveNow(page)
      // Missing, previously synchronized records are legacy remote deletions.
      for (const meta of await this.database.syncMeta.toArray()) {
        if (!ids.has(meta.id) && await this.database.pages.get(meta.id)) await this.removeNow(meta.id)
      }
    })
  }
  receive(page: CloudPage) { return this.serial(() => this.receiveNow(page)) }
  private async receiveNow(page: CloudPage) {
    if (this.stopped) return
    const d = this.database
    await d.transaction('rw', [d.pages, d.outbox, d.tombstones, d.syncMeta], async () => {
      const pending = await d.outbox.get(page.id)
      if (pending) return // flush compares revisions in a remote transaction; never overwrite pending edits.
      const deleted = await d.tombstones.get(page.id)
      if (deleted && !isTombstone(page)) {
        await d.outbox.put({ id: page.id, page: deleted, baseRevision: revisionOf(page) })
        await this.copyConflict(page)
        return
      }
      await this.accept(page)
    })
  }
  removed(id: string) { return this.serial(() => this.removeNow(id)) }
  private async removeNow(id: string) {
    if (this.stopped) return
    const d = this.database
    const pending = await d.outbox.get(id)
    if (pending) { await this.resolve(pending, null, false); return }
    const page = await d.pages.get(id)
    if (!page) return
    const tombstone: Tombstone = { ...page, title: '', content: '', hidden: true, deleted: true,
      permanentlyDeleted: true, updatedAt: nextTime(page.updatedAt), revision: crypto.randomUUID() }
    await d.transaction('rw', [d.pages, d.tombstones, d.outbox], async () => {
      await d.pages.delete(id)
      await d.tombstones.put(tombstone)
      await d.outbox.put({ id, page: tombstone, baseRevision: null })
    })
  }
  flush() {
    return this.serial(async () => {
      // Bound each pass so a continuously edited document cannot monopolize synchronization.
      for (let count = 0; count < 500 && !this.stopped; count++) {
        const change = await this.database.outbox.toCollection().first()
        if (!change) return
        const result = await this.remote.compareAndSet(change)
        if (this.stopped) return
        await this.resolve(change, result.remote, result.written)
      }
    })
  }
}
