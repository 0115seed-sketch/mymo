import { defineConfig, presetUno, presetIcons } from 'unocss'

export default defineConfig({
  presets: [
    presetUno({ dark: 'class' }),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/',
    }),
  ],
  shortcuts: {
    'btn': 'px-2 py-1 rounded cursor-pointer text-gray-700 dark:text-gray-300 bg-transparent dark:bg-transparent hover:bg-gray-100 dark:hover:bg-[#32344d] transition-colors text-sm',
    'btn-active': 'bg-gray-200 text-gray-900 dark:bg-[#3d3f5c] dark:text-white',
  },
})
