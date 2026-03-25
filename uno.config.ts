import { defineConfig, presetUno, presetIcons } from 'unocss'

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons({
      scale: 1.2,
      cdn: 'https://esm.sh/',
    }),
  ],
  shortcuts: {
    'btn': 'px-2 py-1 rounded cursor-pointer hover:bg-gray-200 transition-colors text-sm',
    'btn-active': 'bg-gray-300',
  },
})
