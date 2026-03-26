import { createSignal } from 'solid-js'

const STORAGE_KEY = 'mymo-dark-mode'

const getInitialDark = (): boolean => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored !== null) return stored === 'true'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

const [darkMode, setDarkModeSignal] = createSignal(getInitialDark())

// 초기 적용
if (darkMode()) document.documentElement.classList.add('dark')

export { darkMode }

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
