import { type AppDatabase, type Page, type CloudPage, type PendingChange, type Tombstone, isTombstone, revisionOf, nextTime, pageTables, rememberRevision, isRevisionAncestor, revisionKey, putLocalPages } from '../db'

import { preserveConflict } from '../db/conflicts'
import { sameDocument } from '../utils/documentEquality'

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
    if (await preserveConflict(this.database, page)) this.onConflict()
  }
  private async accept(remote: CloudPage) {
    if (isTombstone(remote)) {
      await this.database.pages.delete(remote.id)
      await this.database.tombstones.put(remote)
    } else {
      await this.database.pages.put(remote)
    }
    await this.rememberRemoteBase(remote)
  }
  private async rememberRemoteBase(remote: CloudPage) {
    const meta = await this.database.syncMeta.get(remote.id)
    await rememberRevision(this.database, remote, meta?.revision ?? null, true)
    await this.database.syncMeta.put({ id: remote.id, revision: revisionOf(remote), title: remote.title, content: remote.content })
  }
  private async resolve(change: PendingChange, remote: CloudPage | null, written: boolean) {
    const d = this.database
    await d.transaction('rw', pageTables(d), async () => {
      const current = await d.outbox.get(change.id)
      if (!current) return
      if (written || (remote && revisionOf(remote) === revisionOf(change.page))) {
        const meta = await d.syncMeta.get(change.id)
        await rememberRevision(d, change.page, change.baseRevision, true)
        if (!meta || meta.revision === change.baseRevision || meta.revision === revisionOf(change.page)) {
          await d.syncMeta.put({ id: change.id, revision: revisionOf(change.page), title: change.page.title, content: change.page.content })
        }
        // An edit made while the network write was in flight must remain queued.
        if (revisionOf(current.page) === revisionOf(change.page)) await d.outbox.delete(change.id)
        else if (current.baseRevision === change.baseRevision) await d.outbox.put({ ...current, baseRevision: revisionOf(change.page), baseTitle: change.page.title, baseContent: change.page.content })
        return
      }
      if (revisionOf(current.page) !== revisionOf(change.page)) return
      if (remote && !isTombstone(remote) && !isTombstone(current.page)) {
        // An earlier write by this device may have committed before a disconnect.
        // It is an ancestor, not a second editor's conflicting document.
        if (await isRevisionAncestor(d, change.id, revisionOf(remote), revisionOf(current.page))) {
          await this.rememberRemoteBase(remote)
          await d.outbox.put({ ...current, baseRevision: revisionOf(remote), baseTitle: remote.title, baseContent: remote.content })
          return
        }
        const sameBody = remote.title === current.page.title && sameDocument(remote.content, current.page.content)
        const knownBase = current.baseTitle !== undefined && current.baseContent !== undefined
        const titleConflict = knownBase && current.page.title !== current.baseTitle && remote.title !== current.baseTitle && current.page.title !== remote.title
        const contentConflict = knownBase && !sameDocument(current.page.content, current.baseContent!) && !sameDocument(remote.content, current.baseContent!) && !sameDocument(current.page.content, remote.content)
        if (sameBody || (knownBase && !titleConflict && !contentConflict)) {
          await this.rememberRemoteBase(remote)
          const content = knownBase && sameDocument(current.page.content, current.baseContent!) ? remote.content : current.page.content
          const title = knownBase && current.page.title === current.baseTitle ? remote.title : current.page.title
          if (content !== current.page.content || title !== current.page.title) {
            await putLocalPages(d, [{ ...current.page, content, title, updatedAt: nextTime(Math.max(current.page.updatedAt, remote.updatedAt)) }])
          }
          const latest = (await d.outbox.get(change.id))!
          await d.outbox.put({ ...latest, baseRevision: revisionOf(remote), baseTitle: remote.title, baseContent: remote.content })
          return
        }
      }
      if (isTombstone(current.page) && remote && !isTombstone(remote)) {
        // Preserve a newer remote edit before completing a permanent local deletion.
        await this.copyConflict(remote)
        await this.rememberRemoteBase(remote)
        await d.outbox.put({ ...current, baseRevision: revisionOf(remote), baseTitle: remote.title, baseContent: remote.content })
        return
      }
      if (!isTombstone(current.page)) await this.copyConflict(current.page)
      if (remote) {
        await this.accept(remote)
        await d.outbox.delete(change.id)
      } else {
        const tombstone: Tombstone = { ...current.page, title: '', content: '', deleted: true, hidden: true,
          permanentlyDeleted: true, revision: crypto.randomUUID(), updatedAt: nextTime(current.page.updatedAt) }
        await rememberRevision(d, tombstone, revisionOf(current.page))
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
    await d.transaction('rw', pageTables(d), async () => {
      const incoming = revisionOf(page)
      const pending = await d.outbox.get(page.id)
      if (pending) return // Reconcile pending drafts against the actual server record.
      const deleted = await d.tombstones.get(page.id)
      if (deleted && !isTombstone(page)) {
        // This may merely be an old echo. Check the current server record before
        // preserving anything; an echo must not create a new conflict copy.
        await d.outbox.put({ id: page.id, page: deleted, baseRevision: null })
        return
      }
      const meta = await d.syncMeta.get(page.id)
      const known = await d.revisions.get(revisionKey(page.id, incoming))
      // The realtime listener can deliver own echoes after flush has already
      // acknowledged a newer save. Never regress the document or its base revision.
      if (meta && (meta.revision === incoming || known?.acknowledged || await isRevisionAncestor(d, page.id, incoming, meta.revision))) return
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
    await d.transaction('rw', pageTables(d), async () => {
      await rememberRevision(d, tombstone, revisionOf(page))
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
