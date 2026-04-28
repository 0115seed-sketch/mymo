import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'

const dragHandleKey = new PluginKey('dragHandle')
const multiSelectKey = new PluginKey('multiBlockSelect')
const multiBlockClipboardMime = 'application/x-mymo-blocks'

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
    let copiedBlockJSON: Record<string, any>[] = []
    // 핸들 조작 중인지 (선택 초기화 방지용)
    let isHandleAction = false

    const editorView = this.editor.view

    const showHandle = (dom: HTMLElement, pos: number) => {
      if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null }
      currentNodePos = pos
      currentNodeDOM = dom
      const rect = dom.getBoundingClientRect()
      handle.style.display = 'flex'
      // inline-block 요소(가로 배치 이미지 등)는 왼쪽에 핸들을 두면
      // 이웃 요소 위를 지나야 닿을 수 있으므로 요소 내부 좌상단에 배치
      const isInline = window.getComputedStyle(dom).display === 'inline-block'
      if (isInline) {
        handle.style.top = `${rect.top + 4}px`
        handle.style.left = `${rect.left + 4}px`
        handle.dataset.mode = 'inline'
      } else {
        handle.style.top = `${rect.top}px`
        handle.style.left = `${rect.left - 28}px`
        handle.dataset.mode = 'block'
      }
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

    const getTopLevelBlockFromDom = (target: HTMLElement): { dom: HTMLElement; pos: number } | null => {
      const editorDOM = editorView.dom
      const doc = editorView.state.doc
      let directChild: HTMLElement = target

      while (directChild.parentElement && directChild.parentElement !== editorDOM) {
        directChild = directChild.parentElement
      }

      if (directChild.parentElement !== editorDOM) return null

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

        if (dom instanceof HTMLElement && dom === directChild) {
          return { dom, pos }
        }
        pos += child.nodeSize
      }
      return null
    }

    // Find the top-level block at the given pointer coordinate.
    // Y-only 탐색 대신 elementFromPoint를 우선 사용해 같은 줄의 블록도 정확히 집는다.
    const findBlockAtPoint = (mouseX: number, mouseY: number): { dom: HTMLElement; pos: number } | null => {
      const hit = document.elementFromPoint(mouseX, mouseY)
      if (hit instanceof HTMLElement) {
        const resolved = getTopLevelBlockFromDom(hit)
        if (resolved) return resolved
      }

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
    let dragStartX = 0
    let dragStarted = false
    let dropLine: HTMLDivElement | null = null

    const createDropLine = () => {
      if (dropLine) return
      dropLine = document.createElement('div')
      dropLine.style.cssText = 'position:fixed;background:#3b82f6;pointer-events:none;z-index:100;border-radius:1px;'
      document.body.append(dropLine)
    }

    const removeDropLine = () => {
      if (dropLine) { dropLine.remove(); dropLine = null }
    }

    type DropTarget = {
      pos: number
      rect: DOMRect
      isImage: boolean
      // isImage=true: insertBefore=true → 이미지 왼쪽에 세로선, false → 이미지 오른쪽에 세로선
      // isImage=false: lineY = 가로 선 Y 위치
      insertBefore: boolean
      lineY: number
    }

    // Find drop target — X,Y 모두 사용해 이미지면 좌/우, 아니면 상/하 판단
    const findDropTarget = (mouseX: number, mouseY: number): DropTarget | null => {
      const editorDOM = editorView.dom
      const doc = editorView.state.doc

      // ① 커서 아래 요소에서 .image-block 탐색
      const pointEl = document.elementFromPoint(mouseX, mouseY)
      if (pointEl) {
        let imgEl: HTMLElement | null = null
        let el: HTMLElement | null = pointEl as HTMLElement
        while (el && el !== editorDOM) {
          if (el.classList.contains('image-block')) { imgEl = el; break }
          el = el.parentElement
        }
        if (imgEl) {
          const block = getTopLevelBlockFromDom(imgEl)
          if (block) {
            // 드래그 중인 이미지 자신은 제외 — 자기 자신 위에 있어도 이웃으로 처리 안 함
            const imgRect = imgEl.getBoundingClientRect()
            const midX = imgRect.left + imgRect.width / 2
            const insertBefore = mouseX < midX
            const lineX = insertBefore ? imgRect.left : imgRect.right
            return {
              pos: insertBefore ? block.pos : block.pos + doc.nodeAt(block.pos)!.nodeSize,
              rect: imgRect,
              isImage: true,
              insertBefore,
              lineY: lineX, // 이미지일 땐 lineY를 lineX로 재활용
            }
          }
        }
      }

      // ② 이미지 위가 아닌 경우 — Y 기반 가로선 (기존 로직)
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
          if (directChild.parentElement === editorDOM) dom = directChild
        }
        if (dom instanceof HTMLElement) children.push({ pos, dom, rect: dom.getBoundingClientRect() })
        pos += child.nodeSize
      }
      if (children.length === 0) return null

      const first = children[0]
      if (mouseY <= first.rect.top + first.rect.height / 2) {
        return { pos: first.pos, rect: first.rect, isImage: false, insertBefore: true, lineY: first.rect.top }
      }
      for (let i = 0; i < children.length - 1; i++) {
        const curr = children[i]
        const next = children[i + 1]
        const midpoint = (curr.rect.bottom + next.rect.top) / 2
        if (mouseY <= midpoint) {
          const node = doc.nodeAt(curr.pos)
          return { pos: curr.pos + (node?.nodeSize || 1), rect: curr.rect, isImage: false, insertBefore: false, lineY: curr.rect.bottom }
        }
      }
      const last = children[children.length - 1]
      const lastNode = doc.nodeAt(last.pos)
      return { pos: last.pos + (lastNode?.nodeSize || 1), rect: last.rect, isImage: false, insertBefore: false, lineY: last.rect.bottom }
    }

    // 데코레이션만 갱신하는 헬퍼 (선택 범위 변경 없음, 블록별 개별 처리)
    const applyBlockSelection = () => {
      if (selectedBlockPositions.length === 0) return
      isHandleAction = true
      const tr = editorView.state.tr.setMeta(multiSelectKey, true)
      editorView.dispatch(tr)
      // focus() 가 PM의 selection-change 트랜잭션을 유발할 수 있으므로
      // isHandleAction 리셋을 한 프레임 뒤로 미뤄 appendTransaction 오작동 방지
      editorView.focus()
      requestAnimationFrame(() => { isHandleAction = false })
    }

    const clearBlockSelection = () => {
      if (selectedBlockPositions.length === 0) return
      selectedBlockPositions = []
      isHandleAction = true
      editorView.dispatch(editorView.state.tr.setMeta(multiSelectKey, true))
      requestAnimationFrame(() => { isHandleAction = false })
    }

    const getSelectedBlocks = () => {
      const doc = editorView.state.doc
      return [...selectedBlockPositions]
        .sort((a, b) => a - b)
        .map((pos) => doc.nodeAt(pos))
        .filter((node): node is NonNullable<typeof node> => !!node)
    }

    const writeSelectedBlocksToClipboard = (event?: ClipboardEvent) => {
      const nodes = getSelectedBlocks()
      if (nodes.length === 0) return false

      copiedBlockJSON = nodes.map((node) => node.toJSON())

      const fragment = Fragment.from(nodes)
      const serializer = DOMSerializer.fromSchema(editorView.state.schema)
      const div = document.createElement('div')
      div.appendChild(serializer.serializeFragment(fragment))

      if (event?.clipboardData) {
        event.preventDefault()
        event.clipboardData.clearData()
        event.clipboardData.setData(multiBlockClipboardMime, JSON.stringify(copiedBlockJSON))
        event.clipboardData.setData('text/html', div.innerHTML)
        event.clipboardData.setData('text/plain', div.textContent || '')
      }

      return true
    }

    const deleteSelectedBlocks = () => {
      if (selectedBlockPositions.length === 0) return false

      const sorted = [...selectedBlockPositions].sort((a, b) => b - a)
      const { tr } = editorView.state
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
      editorView.dispatch(tr)
      isHandleAction = false
      return true
    }

    const insertCopiedBlocks = (event?: ClipboardEvent) => {
      const raw = event?.clipboardData?.getData(multiBlockClipboardMime)
      const nodeJSON = raw ? JSON.parse(raw) : copiedBlockJSON
      if (!Array.isArray(nodeJSON) || nodeJSON.length === 0) return false

      const { schema } = editorView.state
      let tr = editorView.state.tr
      let insertPos = tr.selection.from

      for (const json of nodeJSON) {
        const node = schema.nodeFromJSON(json)
        tr = tr.insert(insertPos, node)
        insertPos += node.nodeSize
      }

      if (event) event.preventDefault()
      isHandleAction = true
      editorView.dispatch(tr.scrollIntoView())
      isHandleAction = false
      clearBlockSelection()
      return true
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
      dragStartX = e.clientX

      applyBlockSelection()

      document.addEventListener('mousemove', onDocMouseMoveDrag)
      document.addEventListener('mouseup', onDocMouseUpDrag)
    }

    const onDocMouseMoveDrag = (e: MouseEvent) => {
      if (!isDragging) return

      if (!dragStarted && (Math.abs(e.clientY - dragStartY) > 4 || Math.abs(e.clientX - dragStartX) > 4)) {
        dragStarted = true
        createDropLine()
        handle.style.opacity = '0.5'
        if (currentNodeDOM) {
          currentNodeDOM.style.opacity = '0.4'
        }
      }

      if (!dragStarted || !dropLine) return

      const target = findDropTarget(e.clientX, e.clientY)
      if (target) {
        dropLine.style.display = 'block'

        if (target.isImage) {
          // 이미지: 좌/우 세로선
          const lineX = target.lineY // lineY를 lineX로 재활용한 값
          dropLine.style.width = '5px'
          dropLine.style.height = `${target.rect.height}px`
          dropLine.style.top = `${target.rect.top}px`
          dropLine.style.left = `${lineX - 2}px`
        } else {
          // 일반 블록: 상/하 가로선
          const editorRect = editorView.dom.getBoundingClientRect()
          dropLine.style.height = '5px'
          dropLine.style.width = `${editorRect.width}px`
          dropLine.style.top = `${target.lineY}px`
          dropLine.style.left = `${editorRect.left}px`
        }

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

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (selectedBlockPositions.length === 0) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      event.preventDefault()
      deleteSelectedBlocks()
    }

    const onDocumentCopy = (event: ClipboardEvent) => {
      if (selectedBlockPositions.length === 0) return
      writeSelectedBlocksToClipboard(event)
    }

    const onDocumentCut = (event: ClipboardEvent) => {
      if (selectedBlockPositions.length === 0) return
      if (!writeSelectedBlocksToClipboard(event)) return
      deleteSelectedBlocks()
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

      const result = findBlockAtPoint(e.clientX, e.clientY)
      if (result) {
        showHandle(result.dom, result.pos)
      } else {
        hideHandle()
      }
    }

    document.addEventListener('mousemove', onGlobalMouseMove)
    document.addEventListener('keydown', onDocumentKeyDown)
    document.addEventListener('copy', onDocumentCopy)
    document.addEventListener('cut', onDocumentCut)
    // paste는 PM handleDOMEvents.paste 에서만 처리 (이중 삽입 방지)

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
              document.removeEventListener('keydown', onDocumentKeyDown)
              document.removeEventListener('copy', onDocumentCopy)
              document.removeEventListener('cut', onDocumentCut)
            },
          }
        },
      }),
      // 멀티 블록 선택 데코레이션 + 선택 변경 감지
      new Plugin({
        key: multiSelectKey,
        props: {
          handleKeyDown(_view, event) {
            if (selectedBlockPositions.length === 0) return false
            // Delete/Backspace: 선택된 블록만 삭제
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault()
              return deleteSelectedBlocks()
            }
            return false
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const me = event as MouseEvent
              const target = me.target as HTMLElement | null
              if (!target) return false

              // 리사이즈 핸들 / 편집 버튼은 직접 처리하도록 패스
              if (
                target.classList.contains('image-resize-handle') ||
                target.classList.contains('image-edit-btn')
              ) return false

              // 클릭한 요소에서 가장 가까운 .image-block 찾기
              const editorDOM = editorView.dom
              let imgBlockEl: HTMLElement | null = null
              let el: HTMLElement | null = target
              while (el && el !== editorDOM) {
                if (el.classList.contains('image-block')) { imgBlockEl = el; break }
                el = el.parentElement
              }

              if (!imgBlockEl) {
                // 이미지 바깥 클릭: 수정자 없으면 선택 초기화
                if (!me.ctrlKey && !me.metaKey && !me.shiftKey && selectedBlockPositions.length > 0) {
                  clearBlockSelection()
                }
                return false
              }

              const block = getTopLevelBlockFromDom(imgBlockEl)
              if (!block) return false

              const clickedPos = block.pos
              const doc = view.state.doc

              me.preventDefault()
              me.stopPropagation()

              // Ctrl/Cmd: 개별 토글
              if (me.ctrlKey || me.metaKey) {
                const idx = selectedBlockPositions.indexOf(clickedPos)
                if (idx >= 0) {
                  selectedBlockPositions.splice(idx, 1)
                } else {
                  selectedBlockPositions.push(clickedPos)
                }
                lastSelectedPos = clickedPos
                applyBlockSelection()
                return true
              }

              // Shift: 범위 선택
              if (me.shiftKey && lastSelectedPos != null) {
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
                return true
              }

              // 일반 클릭: 단일 선택 + 드래그 시작
              lastSelectedPos = clickedPos
              selectedBlockPositions = [clickedPos]
              currentNodePos = clickedPos
              currentNodeDOM = block.dom
              applyBlockSelection()

              isDragging = true
              dragStarted = false
              dragStartY = me.clientY
              dragStartX = me.clientX
              document.addEventListener('mousemove', onDocMouseMoveDrag)
              document.addEventListener('mouseup', onDocMouseUpDrag)

              return true
            },
            copy(_view, event) {
              if (selectedBlockPositions.length === 0) return false
              return writeSelectedBlocksToClipboard(event as ClipboardEvent)
            },
            cut(_view, event) {
              if (selectedBlockPositions.length === 0) return false
              if (!writeSelectedBlocksToClipboard(event as ClipboardEvent)) return false
              return deleteSelectedBlocks()
            },
            paste(_view, event) {
              return insertCopiedBlocks(event as ClipboardEvent)
            },
          },
          decorations(state) {
            const doc = state.doc
            if (selectedBlockPositions.length >= 1) {
              // 단일 선택일 때만 --sole 클래스 추가 (리사이즈 핸들/편집 버튼 표시용)
              const isSole = selectedBlockPositions.length === 1
              const decorations: Decoration[] = []
              for (const blockPos of selectedBlockPositions) {
                const node = doc.nodeAt(blockPos)
                if (node) {
                  decorations.push(
                    Decoration.node(blockPos, blockPos + node.nodeSize, {
                      class: isSole
                        ? 'multi-selected-block multi-selected-block--sole'
                        : 'multi-selected-block',
                    })
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
