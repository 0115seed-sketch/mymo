import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state'

const dragHandleKey = new PluginKey('dragHandle')

export const DragHandle = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    const handle = document.createElement('div')
    handle.classList.add('drag-handle')
    handle.textContent = '⠿'
    handle.contentEditable = 'false'
    handle.style.display = 'none'
    document.body.append(handle)

    let currentNodePos: number | null = null
    let currentNodeDOM: HTMLElement | null = null
    let hideTimeout: ReturnType<typeof setTimeout> | null = null
    let isDragging = false

    const editorView = this.editor.view

    const showHandle = (dom: HTMLElement, pos: number) => {
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }
      currentNodePos = pos
      currentNodeDOM = dom
      const rect = dom.getBoundingClientRect()
      handle.style.display = 'flex'
      handle.style.top = `${rect.top}px`
      handle.style.left = `${rect.left - 28}px`
    }

    const hideHandle = () => {
      if (isDragging) return
      hideTimeout = setTimeout(() => {
        handle.style.display = 'none'
        currentNodePos = null
        currentNodeDOM = null
      }, 200)
    }

    handle.addEventListener('mouseenter', () => {
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }
    })
    handle.addEventListener('mouseleave', () => {
      hideHandle()
    })

    // Find the top-level block at the given Y coordinate
    const findBlockAtY = (mouseY: number): { dom: HTMLElement; pos: number } | null => {
      const editorDOM = editorView.dom
      const doc = editorView.state.doc
      let pos = 0

      for (let i = 0; i < doc.childCount; i++) {
        const child = doc.child(i)
        let dom = editorView.nodeDOM(pos)

        if (dom instanceof HTMLElement) {
          let directChild: HTMLElement = dom
          while (directChild.parentElement && directChild.parentElement !== editorDOM) {
            directChild = directChild.parentElement
          }
          if (directChild.parentElement === editorDOM) {
            dom = directChild
          }
        }

        if (dom instanceof HTMLElement) {
          const rect = dom.getBoundingClientRect()
          if (mouseY >= rect.top && mouseY <= rect.bottom) {
            return { dom, pos }
          }
        }
        pos += child.nodeSize
      }
      return null
    }

    // --- Drag via manual mousedown/mousemove/mouseup ---
    let dragStartY = 0
    let dragStarted = false
    let dropLine: HTMLDivElement | null = null

    const createDropLine = () => {
      if (dropLine) return
      dropLine = document.createElement('div')
      dropLine.style.cssText = 'position:fixed;height:2px;background:#3b82f6;pointer-events:none;z-index:100;border-radius:1px;'
      document.body.append(dropLine)
    }

    const removeDropLine = () => {
      if (dropLine) { dropLine.remove(); dropLine = null }
    }

    // Find drop target — the gap between blocks closest to mouseY
    const findDropTarget = (mouseY: number): { pos: number; rect: DOMRect } | null => {
      const editorDOM = editorView.dom
      const doc = editorView.state.doc
      const children: { pos: number; dom: HTMLElement; rect: DOMRect }[] = []
      let pos = 0

      for (let i = 0; i < doc.childCount; i++) {
        const child = doc.child(i)
        let dom = editorView.nodeDOM(pos)

        if (dom instanceof HTMLElement) {
          let directChild: HTMLElement = dom
          while (directChild.parentElement && directChild.parentElement !== editorDOM) {
            directChild = directChild.parentElement
          }
          if (directChild.parentElement === editorDOM) {
            dom = directChild
          }
        }

        if (dom instanceof HTMLElement) {
          children.push({ pos, dom, rect: dom.getBoundingClientRect() })
        }
        pos += child.nodeSize
      }

      if (children.length === 0) return null

      // Check before first block
      const first = children[0]
      if (mouseY <= first.rect.top + first.rect.height / 2) {
        return { pos: first.pos, rect: first.rect }
      }

      // Check between blocks
      for (let i = 0; i < children.length - 1; i++) {
        const curr = children[i]
        const next = children[i + 1]
        const midpoint = (curr.rect.bottom + next.rect.top) / 2
        if (mouseY <= midpoint) {
          // Insert after current block
          const node = editorView.state.doc.nodeAt(curr.pos)
          return { pos: curr.pos + (node?.nodeSize || 1), rect: curr.rect }
        }
      }

      // After last block
      const last = children[children.length - 1]
      const lastNode = editorView.state.doc.nodeAt(last.pos)
      return { pos: last.pos + (lastNode?.nodeSize || 1), rect: last.rect }
    }

    const onHandleMouseDown = (e: MouseEvent) => {
      if (currentNodePos == null) return
      e.preventDefault()
      e.stopPropagation()

      isDragging = true
      dragStarted = false
      dragStartY = e.clientY

      // Select the node visually
      try {
        const tr = editorView.state.tr.setSelection(
          NodeSelection.create(editorView.state.doc, currentNodePos)
        )
        editorView.dispatch(tr)
      } catch {
        // For non-selectable nodes like table, use TextSelection at start
        try {
          const $pos = editorView.state.doc.resolve(currentNodePos)
          const tr = editorView.state.tr.setSelection(TextSelection.create(editorView.state.doc, $pos.pos))
          editorView.dispatch(tr)
        } catch { /* ignore */ }
      }

      document.addEventListener('mousemove', onDocMouseMoveDrag)
      document.addEventListener('mouseup', onDocMouseUpDrag)
    }

    const onDocMouseMoveDrag = (e: MouseEvent) => {
      if (!isDragging) return

      if (!dragStarted && Math.abs(e.clientY - dragStartY) > 3) {
        dragStarted = true
        createDropLine()
        handle.style.opacity = '0.5'
        if (currentNodeDOM) {
          currentNodeDOM.style.opacity = '0.4'
        }
      }

      if (!dragStarted || !dropLine) return

      const target = findDropTarget(e.clientY)
      if (target) {
        const editorRect = editorView.dom.getBoundingClientRect()
        dropLine.style.display = 'block'
        // Position the line at the drop point
        // Determine the Y: find the DOM element at the target pos
        let lineY = target.rect.top
        // If inserting after a node, use the bottom of that node's rect
        if (currentNodePos != null) {
          const sourceNode = editorView.state.doc.nodeAt(currentNodePos)
          if (sourceNode && target.pos > currentNodePos) {
            // Dropping below current block — show line at bottom
            lineY = target.rect.bottom
          }
        }

        // More precise: find the element right before the target pos
        const doc = editorView.state.doc
        let checkPos = 0
        for (let i = 0; i < doc.childCount; i++) {
          const child = doc.child(i)
          const nextPos = checkPos + child.nodeSize
          if (nextPos === target.pos || target.pos <= checkPos) {
            // Line goes at the top of this block
            const dom = editorView.nodeDOM(checkPos)
            if (dom instanceof HTMLElement) {
              let directChild: HTMLElement = dom
              while (directChild.parentElement && directChild.parentElement !== editorView.dom) {
                directChild = directChild.parentElement
              }
              lineY = directChild.getBoundingClientRect().top
            }
            break
          }
          if (nextPos > target.pos) {
            break
          }
          checkPos = nextPos
        }
        // If target.pos is at end of doc
        if (target.pos >= doc.content.size) {
          const lastChildPos = doc.content.size - doc.lastChild!.nodeSize
          const dom = editorView.nodeDOM(lastChildPos)
          if (dom instanceof HTMLElement) {
            let directChild: HTMLElement = dom
            while (directChild.parentElement && directChild.parentElement !== editorView.dom) {
              directChild = directChild.parentElement
            }
            lineY = directChild.getBoundingClientRect().bottom
          }
        }

        dropLine.style.top = `${lineY}px`
        dropLine.style.left = `${editorRect.left}px`
        dropLine.style.width = `${editorRect.width}px`
        ;(dropLine as any)._targetPos = target.pos
      }
    }

    const onDocMouseUpDrag = (_e: MouseEvent) => {
      document.removeEventListener('mousemove', onDocMouseMoveDrag)
      document.removeEventListener('mouseup', onDocMouseUpDrag)

      if (currentNodeDOM) {
        currentNodeDOM.style.opacity = ''
      }
      handle.style.opacity = ''

      if (dragStarted && dropLine && currentNodePos != null) {
        const targetPos = (dropLine as any)._targetPos as number | undefined
        if (targetPos != null) {
          const node = editorView.state.doc.nodeAt(currentNodePos)
          if (node) {
            const nodeSize = node.nodeSize
            const sourceFrom = currentNodePos
            const sourceTo = currentNodePos + nodeSize

            // Don't move if dropping in same position
            if (targetPos !== sourceFrom && targetPos !== sourceTo) {
              const { tr } = editorView.state
              const nodeContent = node.toJSON()

              // Delete source first, then insert at adjusted position
              tr.delete(sourceFrom, sourceTo)

              // Adjust target position after deletion
              let adjustedPos = targetPos
              if (targetPos > sourceFrom) {
                adjustedPos -= nodeSize
              }

              // Clamp to valid range
              adjustedPos = Math.max(0, Math.min(adjustedPos, tr.doc.content.size))

              const newNode = editorView.state.schema.nodeFromJSON(nodeContent)
              tr.insert(adjustedPos, newNode)
              editorView.dispatch(tr)
            }
          }
        }
      }

      isDragging = false
      dragStarted = false
      removeDropLine()
      handle.style.display = 'none'
      currentNodePos = null
      currentNodeDOM = null
    }

    handle.addEventListener('mousedown', onHandleMouseDown)

    // --- Global mousemove for Y-coordinate-based handle display ---
    const onGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging) return
      if (e.target === handle || (e.target instanceof Node && handle.contains(e.target))) return

      const editorRect = editorView.dom.getBoundingClientRect()
      // Only show handle if mouse Y is within editor's vertical range
      if (e.clientY < editorRect.top || e.clientY > editorRect.bottom) {
        hideHandle()
        return
      }

      const result = findBlockAtY(e.clientY)
      if (result) {
        showHandle(result.dom, result.pos)
      } else {
        hideHandle()
      }
    }

    document.addEventListener('mousemove', onGlobalMouseMove)

    return [
      new Plugin({
        key: dragHandleKey,
        view() {
          return {
            destroy() {
              handle.remove()
              removeDropLine()
              document.removeEventListener('mousemove', onGlobalMouseMove)
              document.removeEventListener('mousemove', onDocMouseMoveDrag)
              document.removeEventListener('mouseup', onDocMouseUpDrag)
            },
          }
        },
      }),
    ]
  },
})
