import { Show, createSignal } from 'solid-js'
import type { Component } from 'solid-js'
import {
  darkMode,
  toggleDarkMode,
  autoBackupEnabled,
  setAutoBackupEnabled,
  autoBackupIntervalMinutes,
  setAutoBackupIntervalMinutes,
} from '../stores/settings'

import type { Editor } from '@tiptap/core'
interface SettingsModalProps {
  open: boolean
  onClose: () => void
  editor?: Editor | null
  pageTitle?: string
  onReload?: () => Promise<void>
}

const SettingsModal: Component<SettingsModalProps> = (props) => {
  const [showExportMenu, setShowExportMenu] = createSignal(false)

  const runRestore = async () => {
    const m = await import('../utils/export')
    const r = await m.restoreData()
    if (r.success) {
      if (props.onReload) await props.onReload()
      alert(r.message)
      location.reload()
      return
    }
    if (r.message !== '취소되었습니다.') {
      alert(r.message)
    }
  }

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-1000 flex items-center justify-center"
        style={{ background: 'var(--bg-overlay)' }}
        onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}
      >
        <div
          class="rounded-xl p-6 w-80 max-w-90vw"
          style={{ background: 'var(--bg-modal)', 'box-shadow': 'var(--shadow-modal)' }}
        >
          <div class="flex items-center justify-between mb-3">
            <span class="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>설정</span>
            <button
              class="text-lg cursor-pointer border-none bg-transparent"
              style={{ color: 'var(--text-tertiary)' }}
              onClick={() => props.onClose()}
            >✕</button>
          </div>

          {/* 다크모드 버튼 */}
          <div class="py-1">
            <button
              type="button"
              class="w-full flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: darkMode() ? 'var(--accent)' : 'var(--bg-active)',
                color: darkMode() ? '#ffffff' : 'var(--text-primary)',
                border: darkMode() ? '1px solid transparent' : '1px solid var(--border-light)',
              }}
              onClick={toggleDarkMode}
              aria-pressed={darkMode()}
            >
              <span class="text-sm font-semibold">다크 모드</span>
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: darkMode() ? 'rgba(255,255,255,0.2)' : 'var(--bg-modal)',
                  color: darkMode() ? '#ffffff' : 'var(--text-secondary)',
                }}
              >
                {darkMode() ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          {/* 자동 JSON백업 버튼 */}
          <div class="py-1">
            <button
              type="button"
              class="w-full flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: autoBackupEnabled() ? 'var(--accent)' : 'var(--bg-active)',
                color: autoBackupEnabled() ? '#ffffff' : 'var(--text-primary)',
                border: autoBackupEnabled() ? '1px solid transparent' : '1px solid var(--border-light)',
              }}
              onClick={() => setAutoBackupEnabled(!autoBackupEnabled())}
              aria-pressed={autoBackupEnabled()}
            >
              <span class="text-sm font-semibold">자동 JSON백업</span>
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: autoBackupEnabled() ? 'rgba(255,255,255,0.2)' : 'var(--bg-modal)',
                  color: autoBackupEnabled() ? '#ffffff' : 'var(--text-secondary)',
                }}
              >
                {autoBackupEnabled() ? 'ON' : 'OFF'}
              </span>
            </button>

            <Show when={autoBackupEnabled()}>
              <div class="mt-2 flex flex-col gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                <div class="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  자동 백업 파일은 브라우저 기본 다운로드 폴더에 저장됩니다.
                </div>

                <label class="flex items-center justify-between gap-2">
                  <span>백업 주기(분)</span>
                  <select
                    class="rounded px-2 py-1"
                    style={{ background: 'var(--bg-active)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
                    value={String(autoBackupIntervalMinutes())}
                    onChange={(e) => setAutoBackupIntervalMinutes(Number(e.currentTarget.value))}
                  >
                    <option value="5">5</option>
                    <option value="10">10</option>
                    <option value="15">15</option>
                    <option value="30">30</option>
                    <option value="60">60</option>
                  </select>
                </label>
              </div>
            </Show>
          </div>

          {/* 내보내기 버튼 (하단) */}
          <div class="py-1">
            <button
              type="button"
              class="w-full flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors"
              style={{
                background: showExportMenu() ? 'var(--accent)' : 'var(--bg-active)',
                color: showExportMenu() ? '#ffffff' : 'var(--text-primary)',
                border: showExportMenu() ? '1px solid transparent' : '1px solid var(--border-light)',
              }}
              onClick={() => setShowExportMenu(!showExportMenu())}
              aria-expanded={showExportMenu()}
            >
              <span class="text-sm font-semibold">내보내기</span>
              <span class="text-xs" style={{ color: showExportMenu() ? '#ffffff' : 'var(--text-secondary)' }}>▼</span>
            </button>

            <Show when={showExportMenu() && props.editor}>
              <div class="flex flex-col gap-1 mt-2">
                <button class="color-dropdown-item" onClick={() => { import('../utils/export').then(m => m.exportAsPDF(props.editor!, props.pageTitle || '문서')) }}>
                  <span style="font-size:1.1em">📄</span> <span>PDF</span>
                </button>
                <button class="color-dropdown-item" onClick={() => { import('../utils/export').then(m => m.exportAsImage(props.editor!, props.pageTitle || '문서')) }}>
                  <span style="font-size:1.1em">🖼️</span> <span>이미지 (PNG)</span>
                </button>
                <button class="color-dropdown-item" onClick={() => { import('../utils/export').then(m => m.exportAsMarkdown(props.editor!, props.pageTitle || '문서')) }}>
                  <span style="font-size:1.1em">📝</span> <span>마크다운</span>
                </button>
                <button class="color-dropdown-item" onClick={() => { import('../utils/export').then(m => m.exportAsText(props.editor!, props.pageTitle || '문서')) }}>
                  <span style="font-size:1.1em">📃</span> <span>텍스트</span>
                </button>
                <div style="border-top: 1px solid var(--border-light); margin: 4px 0;" />
                <button class="color-dropdown-item" onClick={() => { import('../utils/export').then(m => m.backupData()) }}>
                  <span style="font-size:1.1em">💾</span> <span>백업 (.json)</span>
                </button>
                <button class="color-dropdown-item" onClick={runRestore}>
                  <span style="font-size:1.1em">📂</span> <span>불러오기</span>
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}

export default SettingsModal
