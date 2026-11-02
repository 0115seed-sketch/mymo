import type { Page, CloudPage } from '../db'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function parseDocument(content: string) {
  if (!content) return { type: 'doc', content: [{ type: 'paragraph' }] }
  const doc: unknown = JSON.parse(content)
  if (!object(doc) || doc.type !== 'doc' || !Array.isArray(doc.content)) throw new Error('문서 내용 형식이 잘못되었습니다.')
  const stack: unknown[] = [doc]
  while (stack.length) {
    const node = stack.pop()
    if (!object(node) || typeof node.type !== 'string') throw new Error('문서 블록 형식이 잘못되었습니다.')
    if (node.text !== undefined && typeof node.text !== 'string') throw new Error('문서 텍스트 형식이 잘못되었습니다.')
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) throw new Error('문서 블록 목록이 잘못되었습니다.')
      stack.push(...node.content)
    }
  }
  return doc as { type: string; content: Record<string, unknown>[] }
}
export function validatePage(value: unknown): CloudPage {
  if (!object(value) || typeof value.id !== 'string' || !value.id || value.id.includes('/') || typeof value.title !== 'string' || typeof value.content !== 'string') {
    throw new Error('페이지 식별자·제목·내용을 확인해주세요.')
  }
  for (const key of ['createdAt', 'updatedAt']) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) throw new Error('페이지 날짜가 잘못되었습니다.')
  for (const key of ['deleted', 'hidden']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error('페이지 상태가 잘못되었습니다.')
  for (const key of ['folderId', 'parentPageId']) if (value[key] != null && typeof value[key] !== 'string') throw new Error('페이지 연결이 잘못되었습니다.')
  if (value.order !== undefined && (typeof value.order !== 'number' || !Number.isFinite(value.order))) throw new Error('페이지 순서가 잘못되었습니다.')
  if (value.revision !== undefined && typeof value.revision !== 'string') throw new Error('페이지 버전이 잘못되었습니다.')
  parseDocument(value.content)
  const page: Page = { id: value.id, title: value.title, content: value.content, folderId: value.folderId as string | null ?? null,
    parentPageId: value.parentPageId as string | null ?? null, deleted: value.deleted as boolean ?? false, hidden: value.hidden as boolean ?? false,
    order: value.order as number ?? 0, createdAt: value.createdAt as number, updatedAt: value.updatedAt as number }
  if (typeof value.revision === 'string') page.revision = value.revision
  return value.permanentlyDeleted === true ? { ...page, permanentlyDeleted: true } : page
}
export function validateHierarchy(pages: Page[]) {
  const map = new Map(pages.map(p => [p.id, p]))
  if (map.size !== pages.length) throw new Error('중복된 페이지 식별자가 있습니다.')
  for (const page of pages) {
    const seen = new Set<string>([page.id])
    let parent = page.parentPageId
    while (parent) {
      if (seen.has(parent)) throw new Error('페이지가 순환 연결되어 있습니다.')
      seen.add(parent)
      const next = map.get(parent)
      if (!next) throw new Error('존재하지 않는 부모 페이지가 있습니다.')
      parent = next.parentPageId
    }
  }
}
