import { createSignal } from 'solid-js'
const pending = new Set<Promise<unknown>>()
export const [storageError, setStorageError] = createSignal('')
export const [pendingLocalWrites, setPendingLocalWrites] = createSignal(0)
export const reportStorageError = (error: unknown) => {
  setStorageError('기기 저장 실패: ' + (error instanceof Error ? error.message : String(error)))
}
export function trackWrite<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise)
  setPendingLocalWrites(pending.size)
  promise.then(() => {
    pending.delete(promise)
    setPendingLocalWrites(pending.size)
  }, error => {
    pending.delete(promise)
    setPendingLocalWrites(pending.size)
    reportStorageError(error)
  })
  return promise
}
export async function flushPendingWrites() {
  setStorageError('')
  window.dispatchEvent(new Event('mymo:flush-editors'))
  while (pending.size) await Promise.all([...pending])
  if (storageError()) throw new Error(storageError())
}
