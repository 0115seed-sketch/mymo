import { Show } from 'solid-js'
import type { Component } from 'solid-js'
import { darkMode, toggleDarkMode } from '../stores/settings'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

const SettingsModal: Component<SettingsModalProps> = (props) => {
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
          <div class="flex items-center justify-between mb-5">
            <span class="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>설정</span>
            <button
              class="text-lg cursor-pointer border-none bg-transparent"
              style={{ color: 'var(--text-tertiary)' }}
              onClick={() => props.onClose()}
            >✕</button>
          </div>

          {/* 다크모드 토글 */}
          <div class="flex items-center justify-between py-3" style={{ 'border-top': '1px solid var(--border-light)' }}>
            <div>
              <div class="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>다크 모드</div>
              <div class="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>어두운 테마를 사용합니다</div>
            </div>
            <button
              class="relative w-11 h-6 rounded-full cursor-pointer border-none transition-colors"
              style={{ background: darkMode() ? 'var(--accent)' : 'var(--bg-active)' }}
              onClick={toggleDarkMode}
            >
              <span
                class="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                style={{ left: darkMode() ? '22px' : '2px' }}
              />
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}

export default SettingsModal
