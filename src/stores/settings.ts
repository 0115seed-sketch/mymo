import { createSignal } from 'solid-js'

const STORAGE_KEY = 'mymo-dark-mode'
const AUTO_BACKUP_ENABLED_KEY = 'mymo-auto-backup-enabled'
const AUTO_BACKUP_INTERVAL_KEY = 'mymo-auto-backup-interval-minutes'

const getInitialDark = (): boolean => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored !== null) return stored === 'true'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const getInitialAutoBackupEnabled = (): boolean => {
  const stored = localStorage.getItem(AUTO_BACKUP_ENABLED_KEY)
  return stored === 'true'
}

const getInitialAutoBackupInterval = (): number => {
  const stored = Number(localStorage.getItem(AUTO_BACKUP_INTERVAL_KEY) || '30')
  if (!Number.isFinite(stored) || stored < 1) return 30
  return Math.floor(stored)
}

const [darkMode, setDarkModeSignal] = createSignal(getInitialDark())
const [autoBackupEnabled, setAutoBackupEnabledSignal] = createSignal(getInitialAutoBackupEnabled())
const [autoBackupIntervalMinutes, setAutoBackupIntervalMinutesSignal] = createSignal(getInitialAutoBackupInterval())

// 초기 적용
if (darkMode()) document.documentElement.classList.add('dark')

export { darkMode }
export { autoBackupEnabled, autoBackupIntervalMinutes }

export const setDarkMode = (value: boolean) => {
  setDarkModeSignal(value)
  localStorage.setItem(STORAGE_KEY, String(value))
  if (value) {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export const toggleDarkMode = () => setDarkMode(!darkMode())

export const setAutoBackupEnabled = (value: boolean) => {
  setAutoBackupEnabledSignal(value)
  localStorage.setItem(AUTO_BACKUP_ENABLED_KEY, String(value))
}

export const setAutoBackupIntervalMinutes = (value: number) => {
  const next = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 30
  setAutoBackupIntervalMinutesSignal(next)
  localStorage.setItem(AUTO_BACKUP_INTERVAL_KEY, String(next))
}
