import {
  collection, doc, documentId, getDocFromServer, getDocsFromServer, query, orderBy,
  startAt, startAfter, endAt, endBefore, limit, limitToLast, runTransaction, writeBatch, setDoc, serverTimestamp, type QueryConstraint,
} from 'firebase/firestore'
import { db as firestore } from '../lib/firebase'
import { validatePage } from '../utils/pageValidation'
import { HISTORY_PREFIX, CONTROL_ID, type HistoryRecord, type HistoryControl, type HistoryStorage } from './model'

export function firebaseHistoryStorage(uid: string, active: () => boolean): HistoryStorage {
  // Reuse the existing per-account folders namespace; no public storage or service-account secret.
  const folderCollection = collection(firestore, 'users', uid, 'folders')
  const currentCollection = collection(firestore, 'users', uid, 'pages')
  const guard = () => { if (!active()) throw new Error('계정 또는 작업 공간이 변경되었습니다.') }
  const recordData = (record: HistoryRecord) => ({ ...record, recordType: 'mymoHistory', name: '복원 기록', order: 0 })
  const read = (id: string, data: unknown): HistoryRecord => {
    const record = data as HistoryRecord
    if (!id.startsWith(HISTORY_PREFIX) || !record || record.id !== id || !['checkpoint', 'object', 'chunk', 'control'].includes(record.kind)) throw new Error('계정 복원 기록 형식이 잘못되었습니다.')
    return record
  }
  return {
    get: async id => {
      guard()
      const snapshot = await getDocFromServer(doc(folderCollection, id))
      guard()
      return snapshot.exists() ? read(id, snapshot.data()) : null
    },
    list: async (prefix, options = {}) => {
      guard()
      const constraints: QueryConstraint[] = [orderBy(documentId())]
      constraints.push(options.after ? startAfter(options.after) : startAt(prefix))
      constraints.push(options.through ? endAt(options.through) : endBefore(options.before ?? prefix + '\uf8ff'))
      const size = options.limit
      const listAscending = () => getDocsFromServer(query(folderCollection, ...constraints))
      let snapshots
      if (size && options.descending) {
        try {
          snapshots = await getDocsFromServer(query(folderCollection, ...constraints, limitToLast(size)))
        } catch (error) {
          // Firestore reverses the document-ID order for limitToLast.
          // Existing projects may only have the ascending index.
          if ((error as { code?: string }).code !== 'failed-precondition') throw error
          guard()
          snapshots = await listAscending()
        }
      } else {
        snapshots = await getDocsFromServer(query(folderCollection, ...constraints, ...(size ? [limit(size)] : [])))
      }
      guard()
      const records = snapshots.docs.map(snapshot => read(snapshot.id, snapshot.data()))
      return options.descending ? records.reverse().slice(0, size ?? records.length) : records
    },
    put: async records => {
      for (let i = 0; i < records.length; i += 20) {
        guard()
        const batch = writeBatch(firestore)
        for (const record of records.slice(i, i + 20)) batch.set(doc(folderCollection, record.id), recordData(record))
        await batch.commit()
      }
      guard()
    },
    remove: async ids => {
      for (let i = 0; i < ids.length; i += 200) {
        guard()
        const batch = writeBatch(firestore)
        for (const id of ids.slice(i, i + 200)) batch.delete(doc(folderCollection, id))
        await batch.commit()
      }
      guard()
    },
    currentPages: async () => {
      guard()
      const snapshots = await getDocsFromServer(currentCollection)
      guard()
      return snapshots.docs.map(snapshot => {
        const page = validatePage(snapshot.data())
        if (page.id !== snapshot.id) throw new Error('페이지 식별자가 일치하지 않습니다.')
        return page
      })
    },
    exclusive: async task => {
      guard()
      // Read a server timestamp before deciding retention or lease expiry. A wrong
      // device clock must not delete a week of another device's valid history.
      const clockRef = doc(folderCollection, HISTORY_PREFIX + 'clock')
      await setDoc(clockRef, { id: HISTORY_PREFIX + 'clock', name: '복원 기준 시각', order: 0, createdAt: 0, stamp: serverTimestamp() })
      const clockSnapshot = await getDocFromServer(clockRef)
      guard()
      const serverNow = clockSnapshot.data()?.stamp?.toMillis()
      if (!Number.isFinite(serverNow)) throw new Error('서버 기준 시각을 확인할 수 없습니다.')
      const monotonicStart = performance.now()
      const clock = () => serverNow + performance.now() - monotonicStart
      const owner = crypto.randomUUID(), ref = doc(folderCollection, CONTROL_ID)
      const control = await runTransaction(firestore, async tx => {
        guard()
        const snapshot = await tx.get(ref), now = clock()
        const existing = snapshot.exists() ? read(CONTROL_ID, snapshot.data()) : null
        if (existing && existing.kind !== 'control') throw new Error('계정 보관 설정을 읽을 수 없습니다.')
        if (existing?.owner && existing.leaseUntil > now) return null
        const value: HistoryControl = existing ?? { id: CONTROL_ID, kind: 'control', createdAt: now, owner: '', leaseUntil: 0,
          lastAutoAt: 0, lastAutoId: '', lastGcAt: 0, usedBytes: 0, objectCount: 0 }
        value.serverNow = Math.floor(clock())
        value.owner = owner
        value.leaseUntil = now + 5 * 60 * 1000
        tx.set(ref, recordData(value))
        return value
      })
      if (!control) return undefined
      const save = async () => {
        guard()
        await runTransaction(firestore, async tx => {
          guard()
          const snapshot = await tx.get(ref)
          if (!snapshot.exists() || snapshot.data().owner !== owner) throw new Error('다른 기기가 보관 작업을 시작했습니다. 다시 시도해주세요.')
          control.leaseUntil = clock() + 5 * 60 * 1000
          tx.set(ref, recordData(control))
        })
      }
      try { return await task(control, save) }
      finally {
        if (active()) await runTransaction(firestore, async tx => {
          const snapshot = await tx.get(ref)
          if (snapshot.exists() && snapshot.data().owner === owner) tx.set(ref, { owner: '', leaseUntil: 0 }, { merge: true })
        })
      }
    },
  }
}
