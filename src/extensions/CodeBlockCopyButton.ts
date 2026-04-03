import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

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

export const CodeBlockCopyButton = Extension.create({
  name: 'codeBlockCopyButton',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('codeBlockCopyButton'),
        view: (view) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'code-copy-button'
          button.textContent = '📋'
          button.title = '코드 복사'
          button.setAttribute('aria-label', '코드 복사')
          button.style.position = 'fixed'
          button.style.display = 'none'
          button.style.zIndex = '120'
          button.setAttribute('contenteditable', 'false')
          document.body.appendChild(button)

          let activePre: HTMLElement | null = null
          let hideTimer: number | null = null

          const placeButton = (pre: HTMLElement) => {
            const rect = pre.getBoundingClientRect()
            button.style.left = `${Math.max(8, rect.right - 64)}px`
            button.style.top = `${Math.max(8, rect.top + 8)}px`
            button.style.display = 'inline-flex'
          }

          const hideButton = () => {
            activePre = null
            button.style.display = 'none'
          }

          const onMouseMove = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null
            const pre = target?.closest('pre') as HTMLElement | null
            if (!pre || !view.dom.contains(pre)) {
              if (button.matches(':hover')) return
              hideButton()
              return
            }

            activePre = pre
            placeButton(pre)
          }

          const onMouseLeaveEditor = () => {
            if (button.matches(':hover')) return
            hideButton()
          }

          const onWindowScroll = () => {
            if (activePre) placeButton(activePre)
          }

          const onButtonMouseLeave = () => {
            hideTimer = window.setTimeout(() => {
              if (!button.matches(':hover')) hideButton()
            }, 120)
          }

          const onButtonMouseEnter = () => {
            if (hideTimer) {
              window.clearTimeout(hideTimer)
              hideTimer = null
            }
          }

          const onClickButton = async (event: Event) => {
            event.preventDefault()
            event.stopPropagation()
            if (!activePre) return

            const code = activePre.querySelector('code')
            const text = code?.textContent ?? activePre.textContent ?? ''

            try {
              await copyText(text.trimEnd())
              button.textContent = '✅'
              window.setTimeout(() => {
                button.textContent = '📋'
              }, 1200)
            } catch {
              button.textContent = '⚠️'
              window.setTimeout(() => {
                button.textContent = '📋'
              }, 1200)
            }
          }

          view.dom.addEventListener('mousemove', onMouseMove)
          view.dom.addEventListener('mouseleave', onMouseLeaveEditor)
          window.addEventListener('scroll', onWindowScroll, true)
          button.addEventListener('click', onClickButton)
          button.addEventListener('mouseenter', onButtonMouseEnter)
          button.addEventListener('mouseleave', onButtonMouseLeave)

          return {
            update: () => {
              if (activePre && !view.dom.contains(activePre)) {
                hideButton()
              } else if (activePre) {
                placeButton(activePre)
              }
            },
            destroy: () => {
              view.dom.removeEventListener('mousemove', onMouseMove)
              view.dom.removeEventListener('mouseleave', onMouseLeaveEditor)
              window.removeEventListener('scroll', onWindowScroll, true)
              button.removeEventListener('click', onClickButton)
              button.removeEventListener('mouseenter', onButtonMouseEnter)
              button.removeEventListener('mouseleave', onButtonMouseLeave)
              if (hideTimer) window.clearTimeout(hideTimer)
              button.remove()
            },
          }
        },
      }),
    ]
  },
})
