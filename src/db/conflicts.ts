import { type AppDatabase, type Page, nextTime, putLocalPages, revisionKey, revisionOf } from './index'

// Called inside pageTables transactions. Preserve a source revision only once,
// including across retries and tabs; never delete existing copies automatically.
export async function preserveConflict(database: AppDatabase, page: Page) {
  const key = revisionKey(page.id, revisionOf(page))
  if (await database.conflicts.get(key)) return false
  const id = crypto.randomUUID()
  const title = (page.title || '제목 없음').replace(/(?: \(충돌 복사본\))+$/, '') + ' (충돌 복사본)'
  const copy: Page = { ...page, id, title, parentPageId: null, folderId: null, hidden: false, deleted: false,
    updatedAt: nextTime(page.updatedAt) }
  await putLocalPages(database, [copy])
  await database.conflicts.put({ key, copyId: id })
  return true
}
