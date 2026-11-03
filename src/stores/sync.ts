import { createSignal } from 'solid-js'
import { liveQuery } from 'dexie'
import { collection, doc, getDocsFromServer, onSnapshot, runTransaction, query, where, documentId } from 'firebase/firestore'
import { db as firestore } from '../lib/firebase'
import { type AppDatabase, type CloudPage, type Folder, isTombstone, revisionOf } from '../db'
import { validatePage } from '../utils/pageValidation'
import { PageSyncEngine, type RemotePages } from './syncEngine'
import { HISTORY_PREFIX } from '../history/model'

type SyncState = { state: 'local' | 'syncing' | 'synced' | 'offline' | 'error'; pending: number; conflicts: number; message: string }
export const [syncStatus, setSyncStatus] = createSignal<SyncState>({ state: 'local', pending: 0, conflicts: 0, message: '' })
let stopCurrent: (() => void) | undefined
let retryCurrent: (() => void) | undefined
let flushCurrent: ((refresh?: boolean) => Promise<void>) | undefined
export async function synchronizeAccount(refresh = false) {
  if (!flushCurrent) throw new Error('Google 계정으로 로그인해주세요.')
  await flushCurrent(refresh)
}
export const retrySync = () => retryCurrent?.()
export function stopRealtimeSync() {
  stopCurrent?.()
  stopCurrent = undefined
  retryCurrent = undefined
  flushCurrent = undefined
  setSyncStatus({ state: 'local', pending: 0, conflicts: 0, message: '' })
}
export function startRealtimeSync(userId: string, database: AppDatabase) {
  stopRealtimeSync()
  let active = true
  let busy = false
  let rerun = false
  let pulled = false
  let foldersDirty = true
  let unsubscribe: (() => void) | undefined
  let snapshotChain: Promise<void> = Promise.resolve()
  const pages = collection(firestore, 'users', userId, 'pages')
  const folders = collection(firestore, 'users', userId, 'folders')
  // Folders are legacy metadata (there is no folder editor); preserve both sides.
  const syncFolderMetadata = async () => {
    const snapshots = await Promise.all([
      getDocsFromServer(query(folders, where(documentId(), '<', HISTORY_PREFIX))),
      getDocsFromServer(query(folders, where(documentId(), '>=', HISTORY_PREFIX + '\uf8ff'))),
    ])
    if (!active) return
    const remote = new Map<string, Folder>()
    for (const item of snapshots.flatMap(snapshot => snapshot.docs)) {
      const value = item.data() as Folder
      if (value.id !== item.id || typeof value.name !== 'string' || !Number.isFinite(value.createdAt) || !Number.isFinite(value.order)) throw new Error('클라우드 폴더 형식을 확인해주세요.')
      remote.set(item.id, { id: value.id, name: value.name, order: value.order, createdAt: value.createdAt })
    }
    await database.transaction('rw', database.folders, async () => {
      for (const folder of remote.values()) if (!await database.folders.get(folder.id)) await database.folders.put(folder)
    })
    for (const folder of await database.folders.toArray()) {
      if (!active) return
      if (!remote.has(folder.id)) await runTransaction(firestore, async tx => {
        const ref = doc(folders, folder.id)
        if (!(await tx.get(ref)).exists()) tx.set(ref, folder)
      })
    }
  }

  const remote: RemotePages = {
    list: async () => (await getDocsFromServer(pages)).docs.map(snapshot => {
      const page = validatePage(snapshot.data())
      if (page.id !== snapshot.id) throw new Error('클라우드 페이지 식별자가 일치하지 않습니다.')
      return page
    }),
    compareAndSet: async change => runTransaction(firestore, async transaction => {
      const ref = doc(pages, change.id)
      const snap = await transaction.get(ref)
      const remotePage: CloudPage | null = snap.exists() ? validatePage(snap.data()) : null
      if (remotePage && remotePage.id !== change.id) throw new Error('클라우드 페이지 식별자가 일치하지 않습니다.')
      const remoteRevision = remotePage ? revisionOf(remotePage) : null
      if (remotePage && revisionOf(change.page) === remoteRevision) return { written: true, remote: remotePage }
      if ((remotePage && isTombstone(remotePage)) || remoteRevision !== change.baseRevision) return { written: false, remote: remotePage }
      transaction.set(ref, change.page)
      return { written: true, remote: change.page }
    }),
  }
  const engine = new PageSyncEngine(database, remote, () => {
    if (active) setSyncStatus(s => ({ ...s, conflicts: s.conflicts + 1 }))
  })
  flushCurrent = async (refresh = false) => {
    if (!active) throw new Error('계정이 변경되었습니다.')
    if (refresh) await engine.pull()
    await engine.flush()
    if (!active || await database.outbox.count()) throw new Error('아직 전송 대기 중인 자료가 있습니다. 동기화 후 다시 시도해주세요.')
  }
  const failure = async (error: unknown) => {
    if (!active) return
    const pending = await database.outbox.count()
    if (!active) return
    const offline = !navigator.onLine || (error as { code?: string }).code === 'unavailable'
    setSyncStatus(s => ({ ...s, pending, state: offline ? 'offline' : 'error', message: error instanceof Error ? error.message : String(error) }))
  }
  const run = async () => {
    if (!active) return
    if (busy) { rerun = true; return }
    busy = true
    try {
      do {
        rerun = false
        if (!active) break
        setSyncStatus(s => ({ ...s, state: 'syncing' }))
        if (!pulled) {
          await engine.pull()
          if (!active) break
          pulled = true
          subscribe()
        }
        await engine.flush()
        if (foldersDirty) { foldersDirty = false; try { await syncFolderMetadata() } catch (error) { foldersDirty = true; throw error } }
        if (!active) break
        const pending = await database.outbox.count()
        if (!active) break
        setSyncStatus(s => ({ ...s, pending, state: pending ? 'syncing' : 'synced', message: '' }))
      } while (rerun && active)
    } catch (error) { await failure(error) }
    finally { busy = false }
  }
  const retry = () => { void run() }
  retryCurrent = retry
  const subscribe = () => {
    unsubscribe = onSnapshot(pages, { includeMetadataChanges: true }, snapshot => {
      if (!active || snapshot.metadata.fromCache) return
      snapshotChain = snapshotChain.then(async () => {
        for (const change of snapshot.docChanges()) {
          if (!active) return
          if (change.doc.metadata.hasPendingWrites) continue
          if (change.type === 'removed') await engine.removed(change.doc.id)
          else {
            const page = validatePage(change.doc.data())
            if (page.id !== change.doc.id) throw new Error('클라우드 페이지 식별자가 일치하지 않습니다.')
            await engine.receive(page)
          }
        }
        retry()
      }).catch(failure)
    }, failure)
  }
  const outboxSub = liveQuery(() => database.outbox.toArray()).subscribe({ next: changes => {
    if (!active) return
    setSyncStatus(s => ({ ...s, pending: changes.length }))
    if (changes.length) retry()
  }, error: failure })
  const folderSub = liveQuery(() => database.folders.toArray()).subscribe({ next: () => { if (active) { foldersDirty = true; retry() } }, error: failure })
  const onConflict = () => { if (active) setSyncStatus(s => ({ ...s, conflicts: s.conflicts + 1 })) }
  window.addEventListener('mymo:conflict', onConflict)
  const timer = window.setInterval(retry, 15000)
  window.addEventListener('online', retry)
  window.addEventListener('mymo:local-change', retry)
  stopCurrent = () => {
    active = false
    engine.stop()
    unsubscribe?.()
    outboxSub.unsubscribe()
    folderSub.unsubscribe()
    window.removeEventListener('mymo:conflict', onConflict)
    clearInterval(timer)
    window.removeEventListener('online', retry)
    window.removeEventListener('mymo:local-change', retry)
  }
  retry()
}
