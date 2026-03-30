import { createSignal, onMount, onCleanup, createEffect } from 'solid-js'
import type { Component } from 'solid-js'
import { Editor, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Highlight from '@tiptap/extension-highlight'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { CustomTableCell, CustomTableHeader } from '../extensions/CustomTableCell'
import { MultiColumn, Column } from '../extensions/MultiColumn'
import { ActionButton } from '../extensions/ActionButton'
import { DragHandle } from '../extensions/DragHandle'
import { KeyboardShortcuts } from '../extensions/KeyboardShortcuts'
import TextAlign from '@tiptap/extension-text-align'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import Toolbar from './Toolbar'
import { darkMode } from '../stores/settings'

// ── 테이블 확장: table-layout: fixed + 동적 너비 계산 ──
const CustomTable = Table.extend({
  renderHTML({ node, HTMLAttributes }) {
    let totalWidth = 0
    const firstRow = node.firstChild
    if (firstRow) {
      for (let i = 0; i < firstRow.childCount; i++) {
        const cell = firstRow.child(i)
        const cw = cell.attrs.colwidth
        totalWidth += (cw && cw[0]) ? cw[0] : 383
      }
    }
    return ['table', mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes,
      { style: `table-layout: fixed; width: ${totalWidth}px` }
    ), ['tbody', 0]]
  },
})

const EDGE_THRESHOLD = 6 // px from cell edge to trigger resize

// ── 테이블 리사이즈 플러그인 (행 높이 + 열 너비, 셀 경계 감지 방식) ──
// 드래그 중에는 ProseMirror DOM을 건드리지 않고 인디케이터만 표시.
// mouseup 시 트랜잭션을 디스패치하여 최종 크기를 반영.
const TableResize = Extension.create({
  name: 'tableResize',

  addProseMirrorPlugins() {
    let resizing: {
      type: 'row' | 'col'
      tableIndex: number   // 에디터 내 테이블 순서 인덱스
      rowIndex: number      // 행 인덱스 (행 리사이즈용)
      colIndex: number      // 열 인덱스 (열 리사이즈용)
      hasNextCell: boolean  // 오른쪽 이웃 셀 존재 여부
      startPos: number      // 드래그 시작 마우스 좌표
      startSize: number     // 드래그 시작 셀/행 크기
      nextStartSize: number // 이웃 셀 시작 크기
      indicator: HTMLDivElement // 리사이즈 인디케이터 라인
    } | null = null

    return [
      new Plugin({
        key: new PluginKey('tableResize'),
        props: {
          handleDOMEvents: {
            mousemove: (_view, event) => {
              if (resizing) return false
              const target = event.target as HTMLElement
              const cell = target.closest('td, th') as HTMLElement | null
              if (!cell) {
                document.body.style.cursor = ''
                return false
              }

              const rect = cell.getBoundingClientRect()
              const nearBottom = event.clientY > rect.bottom - EDGE_THRESHOLD
              const nearRight = event.clientX > rect.right - EDGE_THRESHOLD
              const nearLeft = !nearBottom && event.clientX < rect.left + EDGE_THRESHOLD

              if (nearBottom) {
                document.body.style.cursor = 'row-resize'
              } else if (nearRight || nearLeft) {
                document.body.style.cursor = 'col-resize'
              } else {
                document.body.style.cursor = ''
              }
              return false
            },

            mousedown: (view, event) => {
              const target = event.target as HTMLElement
              const cell = target.closest('td, th') as HTMLElement | null
              if (!cell) return false

              const rect = cell.getBoundingClientRect()
              const nearBottom = event.clientY > rect.bottom - EDGE_THRESHOLD
              const nearRight = event.clientX > rect.right - EDGE_THRESHOLD
              const nearLeft = !nearBottom && event.clientX < rect.left + EDGE_THRESHOLD

              if (!nearBottom && !nearRight && !nearLeft) return false

              event.preventDefault()
              event.stopPropagation()

              const tableEl = cell.closest('table') as HTMLTableElement | null
              if (!tableEl) return false

              // 테이블 인덱스 구하기
              const allTables = view.dom.querySelectorAll('table')
              let tableIndex = -1
              allTables.forEach((t: Element, i: number) => { if (t === tableEl) tableIndex = i })
              if (tableIndex === -1) return false

              const tableRect = tableEl.getBoundingClientRect()

              // 인디케이터 라인 생성
              const indicator = document.createElement('div')
              indicator.style.position = 'fixed'
              indicator.style.zIndex = '9999'
              indicator.style.pointerEvents = 'none'
              indicator.style.background = 'var(--accent-color, #3b82f6)'

              if (nearBottom) {
                // 행 높이 리사이즈
                const tr = cell.closest('tr') as HTMLTableRowElement
                if (!tr) return false
                const allRows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')
                let rowIndex = -1
                allRows.forEach((r, i) => { if (r === tr) rowIndex = i })
                if (rowIndex === -1) return false

                // 수평 인디케이터
                indicator.style.left = `${tableRect.left}px`
                indicator.style.width = `${tableRect.width}px`
                indicator.style.height = '2px'
                indicator.style.top = `${event.clientY}px`
                document.body.appendChild(indicator)

                resizing = {
                  type: 'row',
                  tableIndex,
                  rowIndex,
                  colIndex: -1,
                  hasNextCell: false,
                  startPos: event.clientY,
                  startSize: tr.offsetHeight,
                  nextStartSize: 0,
                  indicator,
                }
              } else {
                // 열 너비 리사이즈: nearRight이면 현재 열, nearLeft이면 이전 열
                const tr = cell.closest('tr')
                if (!tr) return false
                const cellsInRow = tr.querySelectorAll('td, th')
                let currentColIndex = -1
                cellsInRow.forEach((c, i) => { if (c === cell) currentColIndex = i })
                if (currentColIndex === -1) return false

                let resizeColIndex: number
                let resizeCell: HTMLElement
                let resizeNextCell: HTMLElement | null

                if (nearLeft && currentColIndex > 0) {
                  // 왼쪽 경계: 이전 열을 리사이즈
                  resizeColIndex = currentColIndex - 1
                  resizeCell = cellsInRow[resizeColIndex] as HTMLElement
                  resizeNextCell = cell
                } else if (nearRight) {
                  resizeColIndex = currentColIndex
                  resizeCell = cell
                  resizeNextCell = cell.nextElementSibling as HTMLElement | null
                } else {
                  return false // nearLeft but first column
                }

                // 수직 인디케이터
                indicator.style.top = `${tableRect.top}px`
                indicator.style.height = `${tableRect.height}px`
                indicator.style.width = '2px'
                indicator.style.left = `${event.clientX}px`
                document.body.appendChild(indicator)

                resizing = {
                  type: 'col',
                  tableIndex,
                  rowIndex: -1,
                  colIndex: resizeColIndex,
                  hasNextCell: !!resizeNextCell,
                  startPos: event.clientX,
                  startSize: resizeCell.offsetWidth,
                  nextStartSize: resizeNextCell ? resizeNextCell.offsetWidth : 0,
                  indicator,
                }
              }

              const onMouseMove = (e: MouseEvent) => {
                if (!resizing) return
                // ProseMirror DOM을 건드리지 않고 인디케이터 위치만 업데이트
                if (resizing.type === 'row') {
                  resizing.indicator.style.top = `${e.clientY}px`
                } else {
                  resizing.indicator.style.left = `${e.clientX}px`
                }
              }

              const onMouseUp = (e: MouseEvent) => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                document.body.style.cursor = ''
                document.body.style.userSelect = ''

                if (!resizing) return

                // 인디케이터 제거
                resizing.indicator.remove()

                // 테이블 노드 찾기 (인덱스 기반, DOM 참조 불필요)
                let tablePos = -1
                let tCount = 0
                view.state.doc.descendants((node: any, pos: number) => {
                  if (node.type.name === 'table') {
                    if (tCount === resizing!.tableIndex) tablePos = pos
                    tCount++
                  }
                })
                if (tablePos === -1) { resizing = null; return }

                const tableNode = view.state.doc.nodeAt(tablePos)
                if (!tableNode) { resizing = null; return }

                const { tr: transaction } = view.state

                if (resizing.type === 'row') {
                  const finalHeight = Math.max(30, resizing.startSize + (e.clientY - resizing.startPos))

                  let offset = 1
                  for (let r = 0; r < tableNode.childCount; r++) {
                    const row = tableNode.child(r)
                    offset += 1
                    if (r === resizing.rowIndex) {
                      for (let c = 0; c < row.childCount; c++) {
                        const cellNode = row.child(c)
                        transaction.setNodeMarkup(tablePos + offset, undefined, {
                          ...cellNode.attrs,
                          rowHeight: finalHeight,
                        })
                        offset += cellNode.nodeSize
                      }
                    } else {
                      for (let c = 0; c < row.childCount; c++) {
                        offset += row.child(c).nodeSize
                      }
                    }
                    offset += 1
                  }
                } else {
                  const delta = e.clientX - resizing.startPos
                  const newWidth = Math.max(50, resizing.startSize + delta)

                  let offset = 1
                  for (let r = 0; r < tableNode.childCount; r++) {
                    const row = tableNode.child(r)
                    offset += 1
                    for (let c = 0; c < row.childCount; c++) {
                      const cellNode = row.child(c)
                      if (c === resizing.colIndex) {
                        transaction.setNodeMarkup(tablePos + offset, undefined, {
                          ...cellNode.attrs,
                          colwidth: [newWidth],
                        })
                      }
                      offset += cellNode.nodeSize
                    }
                    offset += 1
                  }
                }

                view.dispatch(transaction)

                // table-layout:fixed에서 테이블 전체 width를 업데이트해야
                // 브라우저가 다른 열을 건드리지 않음
                if (resizing.type === 'col') {
                  const updatedTableNode = view.state.doc.nodeAt(tablePos)
                  if (updatedTableNode) {
                    let totalWidth = 0
                    const firstRow = updatedTableNode.firstChild
                    if (firstRow) {
                      for (let i = 0; i < firstRow.childCount; i++) {
                        const cell = firstRow.child(i)
                        const cw = cell.attrs.colwidth
                        totalWidth += (cw && cw[0]) ? cw[0] : 192
                      }
                    }
                    const allTables = view.dom.querySelectorAll('table')
                    const tableEl = allTables[resizing.tableIndex] as HTMLElement
                    if (tableEl) {
                      tableEl.style.width = `${totalWidth}px`
                    }
                  }
                }

                resizing = null
              }

              document.body.style.userSelect = 'none'
              document.addEventListener('mousemove', onMouseMove)
              document.addEventListener('mouseup', onMouseUp)
              return true
            },

            mouseleave: () => {
              if (!resizing) document.body.style.cursor = ''
              return false
            },
          },
        },
      }),
    ]
  },
})

interface EditorViewProps {
  content: string
  pageId: string | null
  pageTitle: string
  sidebarVisible?: boolean
  onUpdate: (content: string) => void
  onTitleChange: (title: string) => void
  onEditorReady?: (editor: Editor | null) => void
  onCreateSubPage?: (parentPageId: string) => Promise<{ id: string; title: string; path: string } | undefined>
  onNavigateHash?: (hash: string) => void
}

const EditorView: Component<EditorViewProps> = (props) => {
  let editorElement!: HTMLDivElement
  let titleInput!: HTMLInputElement
  const [editor, setEditor] = createSignal<Editor | null>(null)
  const [editorVersion, setEditorVersion] = createSignal(0)
  let saveTimeout: ReturnType<typeof setTimeout> | null = null
  let composing = false

  onMount(() => {
    const ed = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: true },
        }),
        Placeholder.configure({
          placeholder: '여기에 입력하세요...',
        }),
        Highlight.configure({
          multicolor: true,
        }),
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        TextStyle,
        Color,
        CustomTable.configure({
          resizable: false,
        }),
        TableRow,
        CustomTableCell,
        CustomTableHeader,
        MultiColumn,
        Column,
        ActionButton,
        DragHandle,
        KeyboardShortcuts,
        TextAlign.configure({
          types: ['heading', 'paragraph'],
        }),
        TableResize,
      ],
      content: props.content ? JSON.parse(props.content) : undefined,
      onUpdate: ({ editor: e }) => {
        setEditorVersion(v => v + 1)
        if (saveTimeout) clearTimeout(saveTimeout)
        saveTimeout = setTimeout(() => {
          props.onUpdate(JSON.stringify(e.getJSON()))
        }, 300)
      },
      onSelectionUpdate: () => {
        setEditorVersion(v => v + 1)
      },
    })
    setEditor(ed)
    props.onEditorReady?.(ed)

    // 에디터 내 링크 클릭 처리: 해시 링크는 같은 탭에서 이동, 외부 링크는 새 탭
    editorElement.addEventListener('click', (e) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      e.preventDefault()
      e.stopPropagation()
      if (href.startsWith('#')) {
        const hashValue = href.slice(1)
        window.location.hash = hashValue
        // hashchange 이벤트에 의존하지 않고 직접 네비게이션
        props.onNavigateHash?.(hashValue)
      } else {
        window.open(href, '_blank', 'noopener')
      }
    })
  })

  // 페이지 변경 시에만 에디터 내용 교체 (content 변경은 무시 — 커서 리셋 방지)
  let prevPageId: string | null = null
  createEffect(() => {
    const ed = editor()
    const pageId = props.pageId
    if (ed && pageId && pageId !== prevPageId) {
      prevPageId = pageId
      const content = props.content ? JSON.parse(props.content) : { type: 'doc', content: [] }
      ed.commands.setContent(content)
    }
  })

  // 페이지 전환 시 제목 input 동기화 (IME 중복 방지를 위해 ref 사용)
  createEffect(() => {
    if (titleInput) titleInput.value = props.pageTitle
  })

  onCleanup(() => {
    if (saveTimeout) clearTimeout(saveTimeout)
    props.onEditorReady?.(null)
    editor()?.destroy()
  })

  return (
    <div class="flex-1 flex flex-col min-w-0 h-screen">
      {/* Title input */}
      <div class={props.sidebarVisible === false ? "px-6 pt-5 pb-1 ml-10" : "px-6 pt-5 pb-1"}>
        <input
          ref={titleInput}
          type="text"
          placeholder="제목 없음"
          onCompositionStart={() => { composing = true }}
          onCompositionEnd={(e) => { composing = false; props.onTitleChange(e.currentTarget.value) }}
          onInput={(e) => { if (!composing) props.onTitleChange(e.currentTarget.value) }}
          class={`w-full text-3xl font-bold outline-none border-none bg-transparent ${darkMode() ? 'text-gray-100 placeholder-gray-600' : ''}`}
        />
      </div>

      {/* Toolbar */}
      <Toolbar editor={editor()} version={editorVersion()} pageTitle={props.pageTitle} pageId={props.pageId} onCreateSubPage={props.onCreateSubPage} />

      {/* Editor */}
      <div class="flex-1 overflow-y-auto px-6 py-4">
        <div ref={editorElement} class="editor-content max-w-none prose" />
      </div>
    </div>
  )
}

export default EditorView
