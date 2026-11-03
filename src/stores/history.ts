import { createSignal } from 'solid-js'
import { db, readGuestPages, type AppDatabase } from '../db'
import { user } from './auth'
import { synchronizeAccount } from './sync'
import { flushPendingWrites, trackWrite } from './persistence'
import { AccountArchive } from '../history/archive'
import { firebaseHistoryStorage } from '../history/storage'
import { restoreArchivedPages, importPreviousDevicePages } from '../history/restore'
import { INTERVAL, type Checkpoint } from '../history/model'

interface HistoryStatus { active: boolean; busy: boolean; lastSavedAt: number; error: string }
export const [historyStatus, setHistoryStatus] = createSignal<HistoryStatus>({ active: false, busy: false, lastSavedAt: 0, error: '' })
interface Context { uid: string; source: AppDatabase; archive: AccountArchive; active: boolean; running?: Promise<Checkpoint | undefined> }
let context: Context | undefined
let stopTimer: (() => void) | undefined
const valid = (c: Context) => c.active && db === c.source && user()?.uid === c.uid
const getContext = () => {
  if (!context || !valid(context)) throw new Error('계정 복원 기록을 사용하려면 Google 계정으로 로그인해주세요.')
  return context
}
export function stopAccountHistory() {
  if (context) context.active = false
  context = undefined
  stopTimer?.(); stopTimer = undefined
  setHistoryStatus({ active: false, busy: false, lastSavedAt: 0, error: '' })
}
export function startAccountHistory(uid: string, source: AppDatabase) {
  stopAccountHistory()
  const c: Context = { uid, source, active: true, archive: undefined! }
  c.archive = new AccountArchive(firebaseHistoryStorage(uid, () => valid(c)))
  context = c
  setHistoryStatus({ active: true, busy: false, lastSavedAt: 0, error: '' })
  const run = () => { if (valid(c)) void saveAccountCheckpoint().catch(() => {}) }
  const timer = window.setInterval(run, INTERVAL)
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)
  stopTimer = () => { clearInterval(timer); window.removeEventListener('online', run); document.removeEventListener('visibilitychange', onVisible) }
  run()
}
export async function saveAccountCheckpoint(reason: 'auto' | 'before-restore' = 'auto') {
  const c = getContext()
  if (c.running) {
    const existing = await c.running
    if (reason === 'auto') return existing // current operation already recorded this bucket
  }
  const job = (async () => {
    setHistoryStatus(s => ({ ...s, busy: true, error: '' }))
    try {
      await flushPendingWrites()
      if (!valid(c)) throw new Error('계정이 변경되었습니다.')
      await synchronizeAccount(reason === 'before-restore')
      if (!valid(c)) throw new Error('계정이 변경되었습니다.')
      const checkpoint = await c.archive.capture(reason)
      if (valid(c)) setHistoryStatus(s => ({ ...s, lastSavedAt: checkpoint?.createdAt ?? s.lastSavedAt, error: '' }))
      return checkpoint
    } catch (error) {
      if (valid(c)) setHistoryStatus(s => ({ ...s, error: '계정 보관 실패: ' + (error instanceof Error ? error.message : String(error)) }))
      throw error
    } finally {
      c.running = undefined
      if (valid(c)) setHistoryStatus(s => ({ ...s, busy: false }))
    }
  })()
  c.running = job
  return job
}
export const recentCheckpoints = async () => getContext().archive.recent()
export const checkpointAt = async (time: number) => getContext().archive.nearest(time)
export const previewArchivedPage = async (checkpoint: Checkpoint, id: string) => getContext().archive.readPage(checkpoint, id)
export async function restoreAccountCheckpoint(checkpoint: Checkpoint, pageId?: string) {
  const c = getContext()
  if (!await c.archive.storage.get(checkpoint.id)) throw new Error('복원 시점이 만료되었거나 삭제되었습니다.')
  const ids = pageId ? [pageId] : checkpoint.pages.map(p => p.id)
  const pages = []
  for (const id of ids) pages.push(await c.archive.readPage(checkpoint, id))
  // Force a pre-restore point, even within the same ten-minute bucket.
  if (!valid(c)) throw new Error('계정이 변경되었습니다.')
  const before = await saveAccountCheckpoint('before-restore')
  if (!before) throw new Error('다른 기기가 보관 중입니다. 잠시 후 다시 복원해주세요.')
  if (!valid(c)) throw new Error('계정이 변경되었습니다.')
  const restored = await trackWrite(restoreArchivedPages(c.source, pages, !!pageId))
  window.dispatchEvent(new Event('mymo:local-change'))
  // The operation is already safe locally. Surface an upload failure without losing it.
  try { await synchronizeAccount() }
  catch (error) { throw new Error('이 기기에서는 복원했고 계정 전송은 대기 중입니다. ' + (error instanceof Error ? error.message : String(error))) }
  return restored
}

export async function importPreviousDeviceData() {
  const c = getContext()
  const pages = await readGuestPages()
  if (!pages.length) return 0
  if (!valid(c)) throw new Error('계정이 변경되었습니다.')
  const before = await saveAccountCheckpoint('before-restore')
  if (!before || !valid(c)) throw new Error('계정 보관이 완료된 후 다시 시도해주세요.')
  const count = await trackWrite(importPreviousDevicePages(c.source, pages))
  window.dispatchEvent(new Event('mymo:local-change'))
  await synchronizeAccount()
  return count
}
