import type { Page } from '../db'
export const INTERVAL = 10 * 60 * 1000
export const RETENTION = 7 * 24 * 60 * 60 * 1000
export const HISTORY_PREFIX = '__mymo_history__'
export const CHECKPOINT_PREFIX = HISTORY_PREFIX + 'point_'
export const OBJECT_PREFIX = HISTORY_PREFIX + 'object_'
export const CHUNK_PREFIX = HISTORY_PREFIX + 'chunk_'
export const CONTROL_ID = HISTORY_PREFIX + 'control'
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024
export const MAX_OBJECTS = 5000
export const isHistoryId = (id: string) => id.startsWith(HISTORY_PREFIX)
export const timeKey = (time: number) => Math.floor(time).toString().padStart(13, '0')
export interface PageReference { id: string; title: string; object: string; updatedAt: number; layout?: Omit<Page, 'title' | 'content' | 'revision' | 'updatedAt'> }
export interface Checkpoint {
  id: string; kind: 'checkpoint'; createdAt: number; reason: 'auto' | 'before-restore'
  pages: PageReference[]; objects: string[]
}
export interface HistoryObject { id: string; kind: 'object'; createdAt: number; hash: string; parts: number; bytes: number }
export interface HistoryChunk { id: string; kind: 'chunk'; createdAt: number; data: string }
export interface HistoryControl {
  id: string; kind: 'control'; createdAt: number; owner: string; leaseUntil: number
  serverNow?: number; lastAutoAt: number; lastAutoId: string; lastGcAt: number; usedBytes: number; objectCount: number
}
export type HistoryRecord = Checkpoint | HistoryObject | HistoryChunk | HistoryControl
export interface ListOptions { before?: string; through?: string; after?: string; limit?: number; descending?: boolean }
export interface HistoryStorage {
  get(id: string): Promise<HistoryRecord | null>
  list(prefix: string, options?: ListOptions): Promise<HistoryRecord[]>
  put(records: HistoryRecord[]): Promise<void>
  remove(ids: string[]): Promise<void>
  currentPages(): Promise<Page[]>
  exclusive<T>(task: (control: HistoryControl, save: () => Promise<void>) => Promise<T>): Promise<T | undefined>
}
