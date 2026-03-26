import { createSignal, onMount, onCleanup, createEffect } from 'solid-js'
import type { Component } from 'solid-js'
import { Editor } from '@tiptap/core'
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

// ── 테이블 노드 위치 찾기 헬퍼 ──
function findTablePos(view: any, tableEl: HTMLElement): number {
  const editorDom = view.dom
  const tables = editorDom.querySelectorAll('table')
  let tableIndex = -1
  tables.forEach((t: Element, i: number) => { if (t === tableEl) tableIndex = i })
  if (tableIndex === -1) return -1

  let count = 0
  let found = -1
  view.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'table') {
      if (count === tableIndex) found = pos
      count++
    }
  })
  return found
}

// ── 행 높이 드래그 리사이즈 플러그인 ──
const RowResize = Extension.create({
  name: 'rowResize',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('rowResize'),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement
              if (!target.classList.contains('row-resize-handle')) return false

              event.preventDefault()
              event.stopPropagation()
              const cell = target.closest('td, th') as HTMLElement | null
              const tr = cell?.closest('tr') as HTMLTableRowElement | null
              const tableEl = tr?.closest('table') as HTMLTableElement | null
              if (!tr || !tableEl) return false

              const startY = event.clientY
              const startHeight = tr.offsetHeight

              const onMouseMove = (e: MouseEvent) => {
                const delta = e.clientY - startY
                const newHeight = Math.max(30, startHeight + delta)
                tr.style.height = `${newHeight}px`
                const cells = tr.querySelectorAll('td, th')
                cells.forEach(c => { (c as HTMLElement).style.height = `${newHeight}px` })
              }

              const onMouseUp = (e: MouseEvent) => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                document.body.style.cursor = ''
                document.body.style.userSelect = ''

                const finalHeight = Math.max(30, startHeight + (e.clientY - startY))
                const tablePos = findTablePos(view, tableEl)
                if (tablePos === -1) return

                const tableNode = view.state.doc.nodeAt(tablePos)
                if (!tableNode) return

                // 행 인덱스 찾기
                const allRows = tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')
                let rowIndex = -1
                allRows.forEach((r, i) => { if (r === tr) rowIndex = i })
                if (rowIndex === -1) return

                // 단일 트랜잭션으로 해당 행의 모든 셀에 rowHeight 설정
                const { tr: transaction } = view.state
                let offset = 1
                for (let r = 0; r < tableNode.childCount; r++) {
                  const row = tableNode.child(r)
                  offset += 1
                  if (r === rowIndex) {
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
                view.dispatch(transaction)
              }

              document.body.style.cursor = 'row-resize'
              document.body.style.userSelect = 'none'
              document.addEventListener('mousemove', onMouseMove)
              document.addEventListener('mouseup', onMouseUp)
              return true
            },
          },
        },
      }),
    ]
  },
})

// ── 열 너비 드래그 리사이즈 플러그인 (Ctrl+Z 지원) ──
const ColResize = Extension.create({
  name: 'colResize',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('colResize'),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement
              if (!target.classList.contains('col-resize-handle')) return false

              event.preventDefault()
              event.stopPropagation()
              const cell = target.closest('td, th') as HTMLElement | null
              const tableEl = cell?.closest('table') as HTMLTableElement | null
              if (!cell || !tableEl) return false

              const startX = event.clientX
              const startWidth = cell.offsetWidth

              // 오른쪽 이웃 셀 찾기
              const nextCell = cell.nextElementSibling as HTMLElement | null
              const nextStartWidth = nextCell ? nextCell.offsetWidth : 0

              const onMouseMove = (e: MouseEvent) => {
                const delta = e.clientX - startX
                const newWidth = Math.max(50, startWidth + delta)
                cell.style.width = `${newWidth}px`
                if (nextCell) {
                  const nextWidth = Math.max(50, nextStartWidth - delta)
                  nextCell.style.width = `${nextWidth}px`
                }
              }

              const onMouseUp = (e: MouseEvent) => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                document.body.style.cursor = ''
                document.body.style.userSelect = ''

                const delta = e.clientX - startX
                const newWidth = Math.max(50, startWidth + delta)
                const nextWidth = nextCell ? Math.max(50, nextStartWidth - delta) : 0

                const tablePos = findTablePos(view, tableEl)
                if (tablePos === -1) return

                const tableNode = view.state.doc.nodeAt(tablePos)
                if (!tableNode) return

                // 현재 셀의 열 인덱스 찾기
                const tr = cell.closest('tr')
                if (!tr) return
                const cellsInRow = tr.querySelectorAll('td, th')
                let colIndex = -1
                cellsInRow.forEach((c, i) => { if (c === cell) colIndex = i })
                if (colIndex === -1) return

                // 단일 트랜잭션: 모든 행에서 해당 열(+옆 열)의 colwidth 업데이트
                const { tr: transaction } = view.state
                let offset = 1
                for (let r = 0; r < tableNode.childCount; r++) {
                  const row = tableNode.child(r)
                  offset += 1
                  for (let c = 0; c < row.childCount; c++) {
                    const cellNode = row.child(c)
                    if (c === colIndex) {
                      transaction.setNodeMarkup(tablePos + offset, undefined, {
                        ...cellNode.attrs,
                        colwidth: [newWidth],
                      })
                    } else if (c === colIndex + 1 && nextCell) {
                      transaction.setNodeMarkup(tablePos + offset, undefined, {
                        ...cellNode.attrs,
                        colwidth: [nextWidth],
                      })
                    }
                    offset += cellNode.nodeSize
                  }
                  offset += 1
                }
                view.dispatch(transaction)
              }

              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
              document.addEventListener('mousemove', onMouseMove)
              document.addEventListener('mouseup', onMouseUp)
              return true
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
}

const EditorView: Component<EditorViewProps> = (props) => {
  let editorElement!: HTMLDivElement
  const [editor, setEditor] = createSignal<Editor | null>(null)
  const [editorVersion, setEditorVersion] = createSignal(0)
  let saveTimeout: ReturnType<typeof setTimeout> | null = null

  onMount(() => {
    const ed = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: true, autolink: true },
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
        Table.configure({
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
        RowResize,
        ColResize,
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

    // 테이블 셀에 리사이즈 핸들 자동 삽입
    const addResizeHandles = () => {
      const cells = editorElement.querySelectorAll('.tiptap table td, .tiptap table th')
      cells.forEach(cell => {
        // 행 높이 핸들 (하단)
        if (!cell.querySelector('.row-resize-handle')) {
          const handle = document.createElement('div')
          handle.className = 'row-resize-handle'
          cell.appendChild(handle)
        }
        // 열 너비 핸들 (우측)
        if (!cell.querySelector('.col-resize-handle')) {
          const handle = document.createElement('div')
          handle.className = 'col-resize-handle'
          cell.appendChild(handle)
        }
      })
    }

    // 초기 실행 + DOM 변경 감시
    setTimeout(addResizeHandles, 100)
    const observer = new MutationObserver(() => {
      requestAnimationFrame(addResizeHandles)
    })
    observer.observe(editorElement, { childList: true, subtree: true })

    onCleanup(() => observer.disconnect())
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

  onCleanup(() => {
    if (saveTimeout) clearTimeout(saveTimeout)
    editor()?.destroy()
  })

  return (
    <div class="flex-1 flex flex-col min-w-0 h-screen">
      {/* Title input */}
      <div class={props.sidebarVisible === false ? "px-6 pt-5 pb-1 ml-10" : "px-6 pt-5 pb-1"}>
        <input
          type="text"
          value={props.pageTitle}
          onInput={(e) => props.onTitleChange(e.currentTarget.value)}
          placeholder="제목 없음"
          class={`w-full text-3xl font-bold outline-none border-none bg-transparent ${darkMode() ? 'text-gray-100 placeholder-gray-600' : ''}`}
        />
      </div>

      {/* Toolbar */}
      <Toolbar editor={editor()} version={editorVersion()} pageTitle={props.pageTitle} />

      {/* Editor */}
      <div class="flex-1 overflow-y-auto px-6 py-4">
        <div ref={editorElement} class="editor-content max-w-none prose" />
      </div>
    </div>
  )
}

export default EditorView
