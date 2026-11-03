import { createSignal, Show, For, onMount } from 'solid-js'
import type { Component } from 'solid-js'
import type { Page } from '../db'
import type { Checkpoint } from '../history/model'
import { recentCheckpoints, checkpointAt, previewArchivedPage, restoreAccountCheckpoint } from '../stores/history'

const format = (time: number) => new Date(time).toLocaleString('ko-KR', { hour12: false })
function previewText(content: string): string {
  if (!content) return '(빈 문서)'
  const lines: string[] = []
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'taskItem') lines.push(node.attrs?.checked ? '[완료] ' : '[미완료] ')
    if (typeof node.text === 'string') lines.push(node.text)
    if (node.type === 'image') lines.push('[이미지]')
    if (node.type === 'actionButton') lines.push('[반복 삽입 버튼]')
    for (const child of node.content ?? []) walk(child)
    if (['paragraph', 'heading', 'tableRow'].includes(node.type)) lines.push('\n')
  }
  walk(JSON.parse(content))
  return lines.join('').slice(0, 20000) || '(텍스트 없음)'
}
interface Props { currentPageId?: string | null; onClose: () => void; onRestored?: (id?: string) => Promise<void> }
const RestoreModal: Component<Props> = props => {
  const [points, setPoints] = createSignal<Checkpoint[]>([])
  const [selected, setSelected] = createSignal<Checkpoint | null>(null)
  const [pageId, setPageId] = createSignal('')
  const [preview, setPreview] = createSignal<Page | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [message, setMessage] = createSignal('')
  const [date, setDate] = createSignal('')
  let requestVersion = 0
  const choosePage = async (id: string, checkpoint = selected()) => {
    const version = ++requestVersion
    setPageId(id); setPreview(null); setError('')
    if (!checkpoint || !id) return
    try {
      const page = await previewArchivedPage(checkpoint, id)
      if (version === requestVersion) setPreview(page)
    } catch (e) { if (version === requestVersion) setError(e instanceof Error ? e.message : String(e)) }
  }
  const choose = async (checkpoint: Checkpoint) => {
    setPoints(previous => previous.some(p => p.id === checkpoint.id) ? previous : [checkpoint, ...previous].sort((a, b) => b.createdAt - a.createdAt))
    setSelected(checkpoint); setError(''); setMessage('')
    const id = checkpoint.pages.some(p => p.id === props.currentPageId) ? props.currentPageId! : checkpoint.pages[0]?.id ?? ''
    await choosePage(id, checkpoint)
  }
  const lookup = async (time: number) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const point = await checkpointAt(time)
      if (!point) { setSelected(null); setPreview(null); setMessage('요청 시각 이전의 7일 이내 기록이 없습니다. 이 기능을 사용하기 전의 과거 기록은 생성되지 않습니다.'); return }
      await choose(point)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  onMount(async () => {
    setBusy(true)
    try { const list = await recentCheckpoints(); setPoints(list); if (list[0]) await choose(list[0]); else setMessage('아직 계정에 보관된 복원 시점이 없습니다.') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  })
  const restore = async (single: boolean) => {
    const point = selected()
    if (!point || (single && !preview())) return
    const scope = single ? '선택한 페이지의 제목·본문' : '현재 작업 공간의 모든 페이지'
    if (!confirm(format(point.createdAt) + ' 기록으로 ' + scope + '을 복원합니다.\n복원 직전 상태도 계정에 보관합니다. 계속하시겠습니까?')) return
    setBusy(true); setError('')
    try {
      const id = await restoreAccountCheckpoint(point, single ? pageId() : undefined)
      await props.onRestored?.(id)
      setMessage('복원했습니다. 직전 상태는 복원 시점 목록에서 다시 선택할 수 있습니다.')
      const list = await recentCheckpoints()
      if (!list.some(p => p.id === point.id)) list.push(point)
      setPoints(list)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return (
    <div class="restore-overlay" role="dialog" aria-modal="true" aria-label="계정 복원 기록">
      <div class="restore-panel">
        <div class="restore-header"><strong>계정 복원 기록</strong><button disabled={busy()} onClick={props.onClose} aria-label="복원 창 닫기">닫기</button></div>
        <p class="restore-help">앱을 사용하는 동안 10분 간격으로 보관하며, 7일 지난 기록은 접속 시 정리합니다. 실제 보관 시각을 확인한 뒤 복원하세요.</p>
        <div class="restore-presets"><For each={[1, 6, 24]}>{hours => <button disabled={busy()} onClick={() => lookup(Date.now() - hours * 3600000)}>{hours}시간 전</button>}</For></div>
        <div class="restore-date"><input type="datetime-local" aria-label="복원할 시각" value={date()} onInput={e => setDate(e.currentTarget.value)} /><button disabled={busy() || !date()} onClick={() => lookup(new Date(date()).getTime())}>시각 찾기</button></div>
        <label>최근 복원 시점<select aria-label="복원 시점" disabled={busy()} value={selected()?.id ?? ''} onChange={e => { const point = points().find(p => p.id === e.currentTarget.value); if (point) void choose(point) }}>
          <option value="">선택</option><For each={points()}>{point => <option value={point.id}>{format(point.createdAt)}{point.reason === 'before-restore' ? ' · 복원 직전' : ''}</option>}</For>
        </select></label>
        <Show when={selected()}>{point => <>
          <p class="restore-help">선택된 기록: {format(point().createdAt)} · 페이지 {point().pages.length}개</p>
          <label>미리 볼 페이지<select aria-label="복원할 페이지" disabled={busy()} value={pageId()} onChange={e => { void choosePage(e.currentTarget.value) }}>
            <For each={point().pages}>{p => <option value={p.id}>{p.title || '제목 없음'}</option>}</For>
          </select></label>
          <Show when={preview()}>{p => <div class="restore-preview"><strong>{p().title || '제목 없음'}</strong><pre>{previewText(p().content)}</pre><small>텍스트 미리보기입니다. 표·이미지·서식도 복원에 포함됩니다.</small></div>}</Show>
          <div class="restore-actions"><button disabled={busy() || !preview()} onClick={() => restore(true)}>이 페이지 복원</button><button disabled={busy()} onClick={() => restore(false)}>작업 공간 전체 복원</button></div>
          <p class="restore-help">페이지 하나 복원은 다른 페이지·현재 위치·하위 페이지를 유지합니다. 완전 삭제된 페이지는 새 ID로 복구합니다.</p>
        </>}</Show>
        <Show when={busy()}><p role="status">계정 기록을 처리하는 중입니다…</p></Show>
        <Show when={message()}><p role="status">{message()}</p></Show>
        <Show when={error()}><p class="restore-error" role="alert">{error()}</p></Show>
      </div>
    </div>
  )
}
export default RestoreModal
