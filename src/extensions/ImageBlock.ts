import { Image } from '@tiptap/extension-image'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { NodeView } from '@tiptap/pm/view'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { EditorView as PmView } from '@tiptap/pm/view'
import { fileToOptimizedDataUrl } from '../utils/image'

/**
 * ImageBlock — 블록 레벨 이미지 확장
 * - 기본 Image를 block으로 오버라이드
 * - 붙여넣기(paste) / 드래그&드롭(drop) 으로 이미지 삽입
 * - NodeView 기반 resize 핸들 (4 모서리 드래그)
 * - DragHandle 확장이 최상위 블록을 스캔하므로 별도 수정 없이 핸들 지원됨
 */

// ──────────────────────────────────────────────
// NodeView: 이미지 + 리사이즈 핸들
// ──────────────────────────────────────────────
class ImageBlockView implements NodeView {
  dom: HTMLElement
  private inner: HTMLElement
  private img: HTMLImageElement
  private handles: HTMLElement[] = []
  private getPos: () => number | undefined
  private pmView: PmView

  constructor(node: PmNode, view: PmView, getPos: () => number | undefined) {
    this.pmView = view
    this.getPos = getPos

    // 외부 래퍼 (정렬 제어, full-width block)
    this.dom = document.createElement('div')
    this.dom.className = 'image-block'
    this.dom.setAttribute('data-align', node.attrs.align ?? 'left')

    // 내부 래퍼 (inline-block, 이미지 크기에 맞춰짐 — 핸들 기준점)
    this.inner = document.createElement('div')
    this.inner.className = 'image-block__inner'
    this.dom.appendChild(this.inner)

    // img — 브라우저 기본 드래그(복사) 차단
    this.img = document.createElement('img')
    this.img.className = 'image-block__img'
    this.img.draggable = false
    this.img.addEventListener('dragstart', (e) => e.preventDefault())
    this.img.src = node.attrs.src ?? ''
    if (node.attrs.alt) this.img.alt = node.attrs.alt
    if (node.attrs.title) this.img.title = node.attrs.title
    if (node.attrs.width) this.img.style.width = `${node.attrs.width}px`
    this.inner.appendChild(this.img)

    // 4 모서리 리사이즈 핸들 (inner 기준으로 절대 위치)
    const corners = ['nw', 'ne', 'sw', 'se'] as const
    corners.forEach((corner) => {
      const handle = document.createElement('div')
      handle.className = `image-resize-handle image-resize-handle--${corner}`
      handle.addEventListener('mousedown', (e) => this.onResizeMouseDown(e, corner))
      this.handles.push(handle)
      this.inner.appendChild(handle)
    })

    // 편집(자르기) 버튼 — 선택 시 나타남
    const editBtn = document.createElement('button')
    editBtn.className = 'image-edit-btn'
    editBtn.textContent = '✂ 자르기'
    editBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const src = this.img.src
      const pos = this.getPos()
      document.dispatchEvent(new CustomEvent('image-block:crop', {
        detail: { src, pos },
      }))
    })
    this.inner.appendChild(editBtn)
  }

  update(node: PmNode) {
    if (node.type.name !== 'imageBlock') return false
    this.img.src = node.attrs.src ?? ''
    if (node.attrs.alt) this.img.alt = node.attrs.alt
    if (node.attrs.title) this.img.title = node.attrs.title
    this.img.style.width = node.attrs.width ? `${node.attrs.width}px` : ''
    this.dom.setAttribute('data-align', node.attrs.align ?? 'left')
    return true
  }

  private onResizeMouseDown(e: MouseEvent, corner: 'nw' | 'ne' | 'sw' | 'se') {
    e.preventDefault()
    e.stopPropagation()

    const startX = e.clientX
    const startWidth = this.img.getBoundingClientRect().width
    // 왼쪽 핸들(nw, sw)은 역방향
    const dir = corner === 'nw' || corner === 'sw' ? -1 : 1

    const onMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) * dir
      const newWidth = Math.max(48, Math.round(startWidth + delta))
      this.img.style.width = `${newWidth}px`
    }

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      const delta = (ev.clientX - startX) * dir
      const newWidth = Math.max(48, Math.round(startWidth + delta))
      const pos = this.getPos()
      if (pos == null) return
      const tr = this.pmView.state.tr.setNodeMarkup(pos, undefined, {
        ...this.pmView.state.doc.nodeAt(pos)?.attrs,
        width: newWidth,
      })
      this.pmView.dispatch(tr)
    }

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  stopEvent(event: Event) {
    // mousedown on resize handle — stop PM from handling
    const target = event.target as HTMLElement
    return target.classList.contains('image-resize-handle')
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.handles.forEach((h) => h.remove())
  }
}

export const ImageBlock = Image.extend({
  name: 'imageBlock',

  group: 'block',
  inline: false,
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = (el as HTMLElement).getAttribute('width') || (el as HTMLElement).style.width
          if (!w) return null
          return parseInt(w, 10) || null
        },
        renderHTML: (attrs) => attrs.width ? { width: String(attrs.width) } : {},
      },
      align: {
        default: 'left',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-align') ?? 'left',
        renderHTML: (attrs) => ({ 'data-align': attrs.align ?? 'left' }),
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { class: 'image-block', 'data-align': HTMLAttributes['data-align'] ?? 'left' },
      ['img', { ...HTMLAttributes, class: 'image-block__img' }],
    ]
  },

  parseHTML() {
    return [
      {
        tag: 'div.image-block > img',
        getAttrs: (el) => {
          const img = el as HTMLImageElement
          return {
            src: img.getAttribute('src'),
            alt: img.getAttribute('alt'),
            title: img.getAttribute('title'),
            width: img.getAttribute('width') ? parseInt(img.getAttribute('width')!, 10) : null,
            align: img.closest('div[data-align]')?.getAttribute('data-align') ?? 'left',
          }
        },
      },
      { tag: 'img[src]' },
    ]
  },

  addNodeView() {
    return ({ node, view, getPos }: { node: PmNode; view: PmView; getPos: () => number | undefined }) =>
      new ImageBlockView(node, view, getPos)
  },

  addProseMirrorPlugins() {
    const imageBlockKey = new PluginKey('imageBlockPaste')

    return [
      new Plugin({
        key: imageBlockKey,
        props: {
          // ── 클립보드 붙여넣기 ──
          handlePaste: (view, event) => {
            const items = event.clipboardData?.items
            if (!items) return false

            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) {
                event.preventDefault()
                const file = item.getAsFile()
                if (!file) continue
                void fileToOptimizedDataUrl(file)
                  .then((src) => {
                    const { schema } = view.state
                    const nodeType = schema.nodes.imageBlock
                    if (!nodeType) return
                    const node = nodeType.create({ src })
                    const tr = view.state.tr.replaceSelectionWith(node)
                    view.dispatch(tr)
                  })
                  .catch((err) => {
                    const message = err instanceof Error ? err.message : '이미지를 삽입할 수 없습니다.'
                    alert(message)
                  })
                return true
              }
            }
            return false
          },

          // ── 파일 드래그&드롭 ──
          handleDrop: (view, event) => {
            const files = event.dataTransfer?.files
            if (!files || files.length === 0) return false

            const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
            if (imageFiles.length === 0) return false

            event.preventDefault()
            const coords = { left: event.clientX, top: event.clientY }
            const pos = view.posAtCoords(coords)?.pos ?? view.state.doc.content.size

            void (async () => {
              let insertPos = pos
              for (const file of imageFiles) {
                try {
                  const src = await fileToOptimizedDataUrl(file)
                  const { schema } = view.state
                  const nodeType = schema.nodes.imageBlock
                  if (!nodeType) continue
                  const node = nodeType.create({ src })
                  const tr = view.state.tr.insert(insertPos, node)
                  view.dispatch(tr)
                  insertPos += node.nodeSize
                } catch (err) {
                  const message = err instanceof Error ? err.message : '이미지를 삽입할 수 없습니다.'
                  alert(message)
                }
              }
            })()
            return true
          },
        },
      }),
    ]
  },
})
