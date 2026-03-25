/**
 * sync.ts — 로컬 우선(Local-First) Firestore 동기화
 *
 * 규칙:
 * - 모든 쓰기는 IndexedDB에 먼저 저장 (UI 즉시 반영)
 * - Firestore 동기화는 항상 백그라운드에서 fire-and-forget
 * - 충돌 해결: updatedAt 기준 최신 값 우선 (Last Write Wins)
 */

import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  type Unsubscribe,
} from 'firebase/firestore'
import { db as firestore } from '../lib/firebase'
import { db as localDb, type Page, type Folder } from '../db'

// ── 백그라운드 Firestore 쓰기 (에러 무시 — 로컬은 이미 저장됨) ──────────────

export const syncPageToCloud = (userId: string, page: Page) => {
  const ref = doc(firestore, 'users', userId, 'pages', page.id)
  setDoc(ref, page).catch(() => {/* 오프라인이면 Firestore가 큐에 보관 */})
}

export const syncFolderToCloud = (userId: string, folder: Folder) => {
  const ref = doc(firestore, 'users', userId, 'folders', folder.id)
  setDoc(ref, folder).catch(() => {})
}

export const deletePageFromCloud = (userId: string, pageId: string) => {
  const ref = doc(firestore, 'users', userId, 'pages', pageId)
  deleteDoc(ref).catch(() => {})
}

export const deleteFolderFromCloud = (userId: string, folderId: string) => {
  const ref = doc(firestore, 'users', userId, 'folders', folderId)
  deleteDoc(ref).catch(() => {})
}

// ── 로그인 시 Firestore → IndexedDB 초기 병합 ───────────────────────────────

export const pullFromCloud = async (userId: string) => {
  const [pagesSnap, foldersSnap] = await Promise.all([
    getDocs(collection(firestore, 'users', userId, 'pages')),
    getDocs(collection(firestore, 'users', userId, 'folders')),
  ])

  // 페이지: 클라우드 데이터가 더 최신이면 로컬에 덮어씀
  for (const docSnap of pagesSnap.docs) {
    const cloudPage = docSnap.data() as Page
    const localPage = await localDb.pages.get(cloudPage.id)
    if (!localPage || cloudPage.updatedAt > localPage.updatedAt) {
      await localDb.pages.put(cloudPage)
    }
  }

  // 폴더: 로컬에 없는 항목만 추가
  for (const docSnap of foldersSnap.docs) {
    const cloudFolder = docSnap.data() as Folder
    const localFolder = await localDb.folders.get(cloudFolder.id)
    if (!localFolder) {
      await localDb.folders.put(cloudFolder)
    }
  }
}

// ── 실시간 구독: 다른 기기 변경 → 로컬 IndexedDB 갱신 ──────────────────────

let unsubscribePages: Unsubscribe | null = null
let unsubscribeFolders: Unsubscribe | null = null

export const startRealtimeSync = (
  userId: string,
  onRemoteChange: () => void,
) => {
  // 기존 구독 해제
  stopRealtimeSync()

  unsubscribePages = onSnapshot(
    collection(firestore, 'users', userId, 'pages'),
    (snap) => {
      snap.docChanges().forEach(async (change) => {
        const cloudPage = change.doc.data() as Page
        if (change.type === 'removed') {
          await localDb.pages.delete(cloudPage.id)
        } else {
          const localPage = await localDb.pages.get(cloudPage.id)
          // 클라우드가 더 최신일 때만 로컬 갱신 (내 방금 저장한 값을 덮어쓰지 않음)
          if (!localPage || cloudPage.updatedAt > localPage.updatedAt) {
            await localDb.pages.put(cloudPage)
            onRemoteChange()
          }
        }
      })
    },
  )

  unsubscribeFolders = onSnapshot(
    collection(firestore, 'users', userId, 'folders'),
    (snap) => {
      snap.docChanges().forEach(async (change) => {
        const cloudFolder = change.doc.data() as Folder
        if (change.type === 'removed') {
          await localDb.folders.delete(cloudFolder.id)
        } else {
          const localFolder = await localDb.folders.get(cloudFolder.id)
          if (!localFolder) {
            await localDb.folders.put(cloudFolder)
            onRemoteChange()
          }
        }
      })
    },
  )
}

export const stopRealtimeSync = () => {
  unsubscribePages?.()
  unsubscribeFolders?.()
  unsubscribePages = null
  unsubscribeFolders = null
}
