import { Show, createSignal, createEffect } from 'solid-js'
import type { Component } from 'solid-js'
import type { Editor } from '@tiptap/core'
import { darkMode, toggleDarkMode } from '../stores/settings'
import { user } from '../stores/auth'
import { hasGuestData } from '../db'
import { historyStatus, saveAccountCheckpoint, importPreviousDeviceData } from '../stores/history'
import RestoreModal from './RestoreModal'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  editor?: Editor | null
  pageTitle?: string
  currentPageId?: string | null
  onReload?: () => Promise<void>
  onRestored?: (id?: string) => Promise<void>
}
const SettingsModal: Component<SettingsModalProps> = props => {
  const [showExport, setShowExport] = createSignal(false)
  const [showRestore, setShowRestore] = createSignal(false)
  const [guestData, setGuestData] = createSignal(false)
  const [message, setMessage] = createSignal('')
  createEffect(() => {
    if (!props.open) { setShowRestore(false); return }
    if (user()) void hasGuestData().then(setGuestData)
  })
  const save = async () => {
    setMessage('')
    try { const point = await saveAccountCheckpoint(); setMessage(point ? '계정에 보관했습니다.' : '다른 기기가 보관 중입니다. 잠시 후 다시 확인해주세요.') }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
  }
  const migrate = async () => {
    if (!confirm('이 기기의 이전 자료를 현재 계정에 복사합니다. 기존 계정 자료와 이전 기기 원본은 유지됩니다. 계속하시겠습니까?')) return
    try { const count = await importPreviousDeviceData(); await props.onReload?.(); setMessage('이전 자료 ' + count + '개를 계정에 복사했습니다.') }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <Show when={props.open}>
      <div class="restore-overlay" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
        <div class="settings-panel" role="dialog" aria-modal="true" aria-label="설정">
          <div class="restore-header"><strong>설정</strong><button onClick={props.onClose} aria-label="설정 닫기">닫기</button></div>
          <button class="settings-row" onClick={toggleDarkMode} aria-pressed={darkMode()}>다크 모드 <span>{darkMode() ? 'ON' : 'OFF'}</span></button>
          <section class="settings-history">
            <strong>계정 자동 보관</strong>
            <p>10분 간격 · 최근 7일 · 내용·이미지 중복 제거</p>
            <p class="restore-help">로그인·인터넷 연결 상태에서 앱이 열려 있을 때 작동합니다. 만료 기록은 접속 시 정리합니다. 복원 기록은 최대 64MiB까지 보관하며, 무료 사용량 한도에 도달하면 실패를 표시합니다.</p>
            <Show when={user()} fallback={<p>Google 로그인 후 사용할 수 있습니다. 로그인 전 자료는 이 기기에 저장됩니다.</p>}>
              <p role="status">{historyStatus().busy ? '계정에 보관 중…' : historyStatus().lastSavedAt ? '최근 보관: ' + new Date(historyStatus().lastSavedAt).toLocaleString('ko-KR', { hour12: false }) : '아직 성공한 계정 보관 기록이 확인되지 않았습니다.'}</p>
              <Show when={historyStatus().error}><p role="alert" class="restore-error">{historyStatus().error}</p></Show>
              <div class="restore-actions"><button disabled={historyStatus().busy} onClick={save}>계정 보관 확인·재시도</button><button onClick={() => setShowRestore(true)}>복원 기록 열기</button></div>
              <Show when={guestData()}><button class="settings-row" disabled={historyStatus().busy} onClick={migrate}>이전 기기 자료를 계정으로 복사</button></Show>
            </Show>
          </section>
          <button class="settings-row" onClick={() => setShowExport(!showExport())} aria-expanded={showExport()}>현재 문서 내보내기 <span>{showExport() ? '접기' : '펼치기'}</span></button>
          <Show when={showExport() && props.editor}><div class="settings-exports">
            <button onClick={() => { void import('../utils/export').then(m => m.exportAsPDF(props.editor!, props.pageTitle || '문서')) }}>PDF</button>
            <button onClick={() => { void import('../utils/export').then(m => m.exportAsImage(props.editor!, props.pageTitle || '문서')) }}>이미지 (PNG)</button>
            <button onClick={() => { void import('../utils/export').then(m => m.exportAsMarkdown(props.editor!, props.pageTitle || '문서')) }}>마크다운</button>
            <button onClick={() => { void import('../utils/export').then(m => m.exportAsText(props.editor!, props.pageTitle || '문서')) }}>텍스트</button>
          </div></Show>
          <Show when={message()}><p role="status">{message()}</p></Show>
        </div>
      </div>
      <Show when={showRestore()}><RestoreModal currentPageId={props.currentPageId} onClose={() => setShowRestore(false)} onRestored={props.onRestored} /></Show>
    </Show>
  )
}
export default SettingsModal
