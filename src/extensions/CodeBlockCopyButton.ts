import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const BUTTON_SELECTOR = 'button[data-code-copy-button="true"]'

const copyText = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

const decorateCodeBlocks = (root: HTMLElement) => {
  const codeBlocks = root.querySelectorAll('pre')

  codeBlocks.forEach((pre) => {
    if (pre.querySelector(BUTTON_SELECTOR)) return

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'code-copy-button'
    button.setAttribute('data-code-copy-button', 'true')
    button.setAttribute('contenteditable', 'false')
    button.textContent = '복사'
    pre.appendChild(button)
  })
}

export const CodeBlockCopyButton = Extension.create({
  name: 'codeBlockCopyButton',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('codeBlockCopyButton'),
        view: (view) => {
          const updateButtons = () => decorateCodeBlocks(view.dom as HTMLElement)

          const onClick = async (event: Event) => {
            const target = event.target as HTMLElement | null
            const button = target?.closest(BUTTON_SELECTOR) as HTMLButtonElement | null
            if (!button) return

            event.preventDefault()
            event.stopPropagation()

            const pre = button.closest('pre')
            const code = pre?.querySelector('code')
            const text = code?.textContent ?? pre?.textContent ?? ''
            const cleanText = text.replace(/\n?복사됨?$/, '').trimEnd()

            try {
              await copyText(cleanText)
              button.textContent = '복사됨'
              window.setTimeout(() => {
                button.textContent = '복사'
              }, 1200)
            } catch {
              button.textContent = '실패'
              window.setTimeout(() => {
                button.textContent = '복사'
              }, 1200)
            }
          }

          updateButtons()
          view.dom.addEventListener('click', onClick)

          return {
            update: () => {
              updateButtons()
            },
            destroy: () => {
              view.dom.removeEventListener('click', onClick)
            },
          }
        },
      }),
    ]
  },
})
