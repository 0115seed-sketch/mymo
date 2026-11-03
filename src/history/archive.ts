import { validatePage } from '../utils/pageValidation'
import { isTombstone, type Page } from '../db'
import {
  INTERVAL, RETENTION, MAX_HISTORY_BYTES, MAX_OBJECTS, CHECKPOINT_PREFIX, OBJECT_PREFIX, CHUNK_PREFIX, timeKey,
  type Checkpoint, type HistoryObject, type HistoryChunk, type HistoryStorage, type HistoryControl,
} from './model'

const encoder = new TextEncoder()
const CHUNK_CHARACTERS = 48000
const ASSET_PREFIX = 'mymo-history://'
export async function hashText(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]))
  return value
}
export class AccountArchive {
  readonly storage: HistoryStorage
  constructor(storage: HistoryStorage) { this.storage = storage }
  private async saveObject(text: string, now: number, control: HistoryControl, save: () => Promise<void>) {
    const hash = await hashText(text)
    const existing = await this.storage.get(OBJECT_PREFIX + hash)
    if (existing?.kind === 'object') return hash
    const bytes = encoder.encode(text).length
    if (control.usedBytes + bytes > MAX_HISTORY_BYTES || control.objectCount >= MAX_OBJECTS) {
      throw new Error('복원 기록 보관 한도(64MiB 또는 5,000개 내용)에 도달했습니다. 현재 문서는 유지되며, 오래된 기록 정리 후 다시 보관합니다.')
    }
    const characters = Array.from(text)
    const chunks: HistoryChunk[] = []
    for (let i = 0; i < characters.length || i === 0; i += CHUNK_CHARACTERS) chunks.push({
      id: CHUNK_PREFIX + hash + '_' + String(chunks.length).padStart(5, '0'), kind: 'chunk', createdAt: now,
      data: characters.slice(i, i + CHUNK_CHARACTERS).join(''),
    })
    // The descriptor is the commit marker: never publish it before every part exists.
    await this.storage.put(chunks)
    const descriptor: HistoryObject = { id: OBJECT_PREFIX + hash, kind: 'object', createdAt: now, hash, parts: chunks.length, bytes }
    await this.storage.put([descriptor])
    control.usedBytes += bytes
    control.objectCount++
    await save()
    return hash
  }
  async readObject(hash: string) {
    const descriptor = await this.storage.get(OBJECT_PREFIX + hash)
    if (!descriptor || descriptor.kind !== 'object' || !Number.isInteger(descriptor.parts) || descriptor.parts < 1 || descriptor.parts > 2000) throw new Error('복원 기록의 내용을 찾을 수 없습니다.')
    const parts: string[] = []
    for (let i = 0; i < descriptor.parts; i++) {
      const chunk = await this.storage.get(CHUNK_PREFIX + hash + '_' + String(i).padStart(5, '0'))
      if (!chunk || chunk.kind !== 'chunk') throw new Error('복원 기록 일부가 없습니다. 현재 자료는 변경하지 않았습니다.')
      parts.push(chunk.data)
    }
    const text = parts.join('')
    if (await hashText(text) !== hash) throw new Error('복원 기록 검증에 실패했습니다. 현재 자료는 변경하지 않았습니다.')
    return text
  }
  private async prune(now: number, control: HistoryControl, save: () => Promise<void>) {
    const cutoff = now - RETENTION
    const expired = await this.storage.list(CHECKPOINT_PREFIX, { before: CHECKPOINT_PREFIX + timeKey(cutoff) })
    await this.storage.remove(expired.map(record => record.id))
    // Once per day; avoid re-reading all history every ten minutes on Spark.
    if (control.lastGcAt && now - control.lastGcAt < 24 * 60 * 60 * 1000) return
    const retained = await this.storage.list(CHECKPOINT_PREFIX, { after: CHECKPOINT_PREFIX + timeKey(cutoff) })
    const referenced = new Set(retained.flatMap(record => record.kind === 'checkpoint' ? record.objects : []))
    const objects = await this.storage.list(OBJECT_PREFIX)
    let usedBytes = 0, objectCount = 0, scanned = 0
    for (const object of objects) {
      if (object.kind !== 'object') continue
      // Keep recent orphan uploads so retries can reuse them after a failed publish.
      if (!referenced.has(object.hash) && object.createdAt < now - 24 * 60 * 60 * 1000) {
        // Remove the commit marker first; a partially interrupted delete cannot look complete.
        await this.storage.remove([object.id])
        const ids = Array.from({ length: object.parts }, (_, i) => CHUNK_PREFIX + object.hash + '_' + String(i).padStart(5, '0'))
        await this.storage.remove(ids)
      } else { usedBytes += object.bytes; objectCount++ }
      if (++scanned % 20 === 0) await save() // renew the cross-device lease during longer cleanups
    }
    control.usedBytes = usedBytes
    control.objectCount = objectCount
    control.lastGcAt = now
    await save()
  }
  async capture(reason: 'auto' | 'before-restore' = 'auto', now = Date.now()) {
    return this.storage.exclusive(async (control, save) => {
      now = control.serverNow ?? now
      await this.prune(now, control, save)
      if (reason === 'auto' && control.lastAutoId && Math.floor(control.lastAutoAt / INTERVAL) === Math.floor(now / INTERVAL)) {
        const old = await this.storage.get(control.lastAutoId)
        if (old?.kind === 'checkpoint') return old
      }
      const pages = (await this.storage.currentPages()).map(validatePage).filter(page => !isTombstone(page))
      const references: Checkpoint['pages'] = []
      const objects = new Set<string>()
      for (const page of pages) {
        const { revision: _revision, ...plain } = page
        // updatedAt is metadata in the manifest, not part of the deduplicated body.
        const archived = { ...plain, updatedAt: 0 }
        if (archived.content) {
          const content = JSON.parse(archived.content)
          const visit = async (value: any): Promise<void> => {
            if (!value || typeof value !== 'object') return
            for (const [key, item] of Object.entries(value)) {
              if (key === 'src' && typeof item === 'string' && item.startsWith('data:image/')) {
                const hash = await this.saveObject(item, now, control, save)
                objects.add(hash)
                value[key] = ASSET_PREFIX + hash
              } else if (key === 'templateContent' && typeof item === 'string' && item) {
                const template = JSON.parse(item); await visit(template); value[key] = JSON.stringify(canonical(template))
              } else if (item && typeof item === 'object') await visit(item)
            }
          }
          await visit(content)
          archived.content = JSON.stringify(canonical(content))
        }
        // Layout changes must not duplicate a large unchanged body.
        const { title, content, updatedAt: _updatedAt, ...layout } = archived
        const object = await this.saveObject(JSON.stringify(canonical({ title, content })), now, control, save)
        objects.add(object)
        references.push({ id: page.id, title: page.title, object, updatedAt: page.updatedAt, layout })
      }
      const checkpoint: Checkpoint = {
        id: CHECKPOINT_PREFIX + timeKey(now) + '_' + crypto.randomUUID(), kind: 'checkpoint', createdAt: now, reason,
        pages: references, objects: [...objects],
      }
      if (encoder.encode(JSON.stringify(checkpoint)).length > 750000) throw new Error('페이지 목록이 너무 커 복원 시점을 보관할 수 없습니다.')
      await save() // assert lease ownership before publishing the completed manifest
      await this.storage.put([checkpoint])
      if (reason === 'auto') { control.lastAutoAt = now; control.lastAutoId = checkpoint.id }
      await save()
      return checkpoint
    })
  }
  async nearest(time: number, now = Date.now()): Promise<Checkpoint | null> {
    if (!Number.isFinite(time) || time < now - RETENTION || time > now) return null
    const records = await this.storage.list(CHECKPOINT_PREFIX, { through: CHECKPOINT_PREFIX + timeKey(time) + '\uffff', descending: true, limit: 1 })
    const point = records.find(record => record.kind === 'checkpoint')
    return point?.kind === 'checkpoint' && point.createdAt >= now - RETENTION ? point : null
  }
  async recent(now = Date.now()): Promise<Checkpoint[]> {
    return (await this.storage.list(CHECKPOINT_PREFIX, { after: CHECKPOINT_PREFIX + timeKey(now - RETENTION), descending: true, limit: 30 }))
      .filter((record): record is Checkpoint => record.kind === 'checkpoint' && record.createdAt >= now - RETENTION)
  }
  async readPage(checkpoint: Checkpoint, id: string, now = Date.now()): Promise<Page> {
    if (checkpoint.createdAt < now - RETENTION) throw new Error('7일이 지나 만료된 복원 시점입니다.')
    const ref = checkpoint.pages.find(page => page.id === id)
    if (!ref) throw new Error('이 복원 시점에는 해당 페이지가 없습니다.')
    const archived = JSON.parse(await this.readObject(ref.object))
    if ((ref.layout && ref.layout.id !== id) || (archived.id && archived.id !== id)) throw new Error('복원 기록의 페이지 식별자가 일치하지 않습니다.')
    if (archived.content) {
      const content = JSON.parse(archived.content)
      const visit = async (value: any): Promise<void> => {
        if (!value || typeof value !== 'object') return
        for (const [key, item] of Object.entries(value)) {
          if (key === 'src' && typeof item === 'string' && item.startsWith(ASSET_PREFIX)) value[key] = await this.readObject(item.slice(ASSET_PREFIX.length))
          else if (key === 'templateContent' && typeof item === 'string' && item) {
            const template = JSON.parse(item); await visit(template); value[key] = JSON.stringify(template)
          } else if (item && typeof item === 'object') await visit(item)
        }
      }
      await visit(content)
      archived.content = JSON.stringify(content)
    }
    return validatePage({ ...(ref.layout ?? archived), title: archived.title, content: archived.content, updatedAt: ref.updatedAt })
  }
}
