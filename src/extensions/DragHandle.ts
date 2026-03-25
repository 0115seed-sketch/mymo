import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'

const dragHandleKey = new PluginKey('dragHandle')
const multiSelectKey = new PluginKey('multiBlockSelect')

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
    let lastSelectedPos: number | null = null
    // 핸들로 선택된 블록 위치 목록
    let selectedBlockPositions: number[] = []
    // 핸들 조작 중인지 (선택 초기화 방지용)
    let isHandleAction = false

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

    // 데코레이션만 갱신하는 헬퍼 (선택 범위 변경 없음, 블록별 개별 처리)
    const applyBlockSelection = () => {
      if (selectedBlockPositions.length === 0) return
      isHandleAction = true
      const tr = editorView.state.tr.setMeta(multiSelectKey, true)
      editorView.dispatch(tr)
      isHandleAction = false
      // 에디터 포커스 복원 (사이드바 등 외부 클릭 후에도 키보드/클립보드 동작하도록)
      editorView.focus()
    }

    const onHandleMouseDown = (e: MouseEvent) => {
      if (currentNodePos == null) return
      e.preventDefault()
      e.stopPropagation()

      const clickedPos = currentNodePos
      const doc = editorView.state.doc
      const clickedNode = doc.nodeAt(clickedPos)
      if (!clickedNode) return

      // Shift+클릭: 마지막 선택 블록부터 현재 블록까지 범위의 모든 블록 선택
      if (e.shiftKey && lastSelectedPos != null) {
        const fromPos = Math.min(lastSelectedPos, clickedPos)
        const toPos = Math.max(lastSelectedPos, clickedPos)
        selectedBlockPositions = []
        let pos = 0
        for (let i = 0; i < doc.childCount; i++) {
          const child = doc.child(i)
          if (pos >= fromPos && pos <= toPos) {
            selectedBlockPositions.push(pos)
          }
          pos += child.nodeSize
        }
        applyBlockSelection()
        return
      }

      // Ctrl+클릭: 개별 블록 토글
      if (e.ctrlKey || e.metaKey) {
        const idx = selectedBlockPositions.indexOf(clickedPos)
        if (idx >= 0) {
          selectedBlockPositions.splice(idx, 1)
        } else {
          selectedBlockPositions.push(clickedPos)
        }
        lastSelectedPos = clickedPos
        applyBlockSelection()
        return
      }

      // 일반 클릭: 단일 블록 선택 + 드래그 시작
      lastSelectedPos = clickedPos
      selectedBlockPositions = [clickedPos]
      isDragging = true
      dragStarted = false
      dragStartY = e.clientY

      applyBlockSelection()

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
      // 멀티 블록 선택 데코레이션 + 선택 변경 감지
      new Plugin({
        key: multiSelectKey,
        props: {
          handleKeyDown(view, event) {
            if (selectedBlockPositions.length === 0) return false
            // Delete/Backspace: 선택된 블록만 삭제
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault()
              const sorted = [...selectedBlockPositions].sort((a, b) => b - a)
              const { tr } = view.state
              for (const pos of sorted) {
                const mapped = tr.mapping.map(pos)
                const node = tr.doc.nodeAt(mapped)
                if (node) {
                  tr.delete(mapped, mapped + node.nodeSize)
                }
              }
              selectedBlockPositions = []
              tr.setMeta(multiSelectKey, true)
              isHandleAction = true
              view.dispatch(tr)
              isHandleAction = false
              return true
            }
            return false
          },
          handleDOMEvents: {
            copy(view, event) {
              if (selectedBlockPositions.length === 0) return false
              const ce = event as ClipboardEvent
              const sorted = [...selectedBlockPositions].sort((a, b) => a - b)
              const doc = view.state.doc
              const nodes: any[] = []
              for (const pos of sorted) {
                const node = doc.nodeAt(pos)
                if (node) nodes.push(node)
              }
              if (nodes.length === 0) return false
              const fragment = Fragment.from(nodes)
              const serializer = DOMSerializer.fromSchema(view.state.schema)
              const div = document.createElement('div')
              div.appendChild(serializer.serializeFragment(fragment))
              ce.preventDefault()
              ce.clipboardData?.clearData()
              ce.clipboardData?.setData('text/html', div.innerHTML)
              ce.clipboardData?.setData('text/plain', div.textContent || '')
              return true
            },
            cut(view, event) {
              if (selectedBlockPositions.length === 0) return false
              const ce = event as ClipboardEvent
              const sorted = [...selectedBlockPositions].sort((a, b) => a - b)
              const doc = view.state.doc
              const nodes: any[] = []
              for (const pos of sorted) {
                const node = doc.nodeAt(pos)
                if (node) nodes.push(node)
              }
              if (nodes.length === 0) return false
              const fragment = Fragment.from(nodes)
              const serializer = DOMSerializer.fromSchema(view.state.schema)
              const div = document.createElement('div')
              div.appendChild(serializer.serializeFragment(fragment))
              ce.preventDefault()
              ce.clipboardData?.clearData()
              ce.clipboardData?.setData('text/html', div.innerHTML)
              ce.clipboardData?.setData('text/plain', div.textContent || '')
              // 선택된 블록만 삭제
              const sortedDesc = [...selectedBlockPositions].sort((a, b) => b - a)
              const { tr } = view.state
              for (const pos of sortedDesc) {
                const mapped = tr.mapping.map(pos)
                const node = tr.doc.nodeAt(mapped)
                if (node) {
                  tr.delete(mapped, mapped + node.nodeSize)
                }
              }
              selectedBlockPositions = []
              tr.setMeta(multiSelectKey, true)
              isHandleAction = true
              view.dispatch(tr)
              isHandleAction = false
              return true
            },
          },
          decorations(state) {
            const doc = state.doc
            // 핸들로 블록이 선택된 경우 (1개 이상)
            if (selectedBlockPositions.length >= 1) {
              const decorations: Decoration[] = []
              for (const blockPos of selectedBlockPositions) {
                const node = doc.nodeAt(blockPos)
                if (node) {
                  decorations.push(
                    Decoration.node(blockPos, blockPos + node.nodeSize, { class: 'multi-selected-block' })
                  )
                }
              }
              if (decorations.length > 0) {
                return DecorationSet.create(doc, decorations)
              }
            }
            return DecorationSet.empty
          },
        },
        // 선택이 변경될 때 핸들 선택 초기화 (핸들 조작이 아닌 경우)
        appendTransaction(transactions: readonly Transaction[], _oldState, newState) {
          // 핸들 조작 중이면 초기화하지 않음
          if (isHandleAction) return null
          // 우리 meta가 있으면 무시
          for (const tr of transactions) {
            if (tr.getMeta(multiSelectKey)) return null
          }
          // 선택이 변경된 트랜잭션이 있으면 초기화
          const selChanged = transactions.some(tr => tr.selectionSet || tr.docChanged)
          if (selChanged && selectedBlockPositions.length > 0) {
            selectedBlockPositions = []
            // 데코레이션 갱신을 위한 빈 트랜잭션
            return newState.tr.setMeta(multiSelectKey, true)
          }
          return null
        },
      }),
    ]
  },
})
