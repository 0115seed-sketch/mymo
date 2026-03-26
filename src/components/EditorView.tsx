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

const EDGE_THRESHOLD = 6 // px from cell edge to trigger resize

// ── 테이블 리사이즈 플러그인 (행 높이 + 열 너비, 셀 경계 감지 방식) ──
const TableResize = Extension.create({
  name: 'tableResize',

  addProseMirrorPlugins() {
    let resizing: {
      type: 'row' | 'col'
      tableEl: HTMLTableElement
      tr?: HTMLTableRowElement
      cell?: HTMLElement
      nextCell?: HTMLElement | null
      startPos: number
      startSize: number
      nextStartSize: number
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

              if (nearBottom) {
                document.body.style.cursor = 'row-resize'
              } else if (nearRight) {
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

              if (!nearBottom && !nearRight) return false

              event.preventDefault()
              event.stopPropagation()

              const tableEl = cell.closest('table') as HTMLTableElement | null
              if (!tableEl) return false

              if (nearBottom) {
                // 행 높이 리사이즈
                const tr = cell.closest('tr') as HTMLTableRowElement
                resizing = {
                  type: 'row',
                  tableEl,
                  tr,
                  startPos: event.clientY,
                  startSize: tr.offsetHeight,
                  nextStartSize: 0,
                }
              } else {
                // 열 너비 리사이즈
                const nextCell = cell.nextElementSibling as HTMLElement | null
                resizing = {
                  type: 'col',
                  tableEl,
                  cell,
                  nextCell,
                  startPos: event.clientX,
                  startSize: cell.offsetWidth,
                  nextStartSize: nextCell ? nextCell.offsetWidth : 0,
                }
              }

              const onMouseMove = (e: MouseEvent) => {
                if (!resizing) return
                if (resizing.type === 'row') {
                  const newHeight = Math.max(30, resizing.startSize + (e.clientY - resizing.startPos))
                  resizing.tr!.style.height = `${newHeight}px`
                  const cells = resizing.tr!.querySelectorAll('td, th')
                  cells.forEach(c => { (c as HTMLElement).style.height = `${newHeight}px` })
                } else {
                  const delta = e.clientX - resizing.startPos
                  const newWidth = Math.max(50, resizing.startSize + delta)
                  resizing.cell!.style.width = `${newWidth}px`
                  if (resizing.nextCell) {
                    const nextWidth = Math.max(50, resizing.nextStartSize - delta)
                    resizing.nextCell.style.width = `${nextWidth}px`
                  }
                }
              }

              const onMouseUp = (e: MouseEvent) => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                document.body.style.cursor = ''
                document.body.style.userSelect = ''

                if (!resizing) return

                const tablePos = findTablePos(view, resizing.tableEl)
                if (tablePos === -1) { resizing = null; return }

                const tableNode = view.state.doc.nodeAt(tablePos)
                if (!tableNode) { resizing = null; return }

                const { tr: transaction } = view.state

                if (resizing.type === 'row') {
                  const finalHeight = Math.max(30, resizing.startSize + (e.clientY - resizing.startPos))

                  // 행 인덱스 찾기
                  const allRows = resizing.tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')
                  let rowIndex = -1
                  allRows.forEach((r, i) => { if (r === resizing!.tr) rowIndex = i })
                  if (rowIndex === -1) { resizing = null; return }

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
                } else {
                  const delta = e.clientX - resizing.startPos
                  const newWidth = Math.max(50, resizing.startSize + delta)
                  const nextWidth = resizing.nextCell ? Math.max(50, resizing.nextStartSize - delta) : 0

                  // 열 인덱스 찾기
                  const tr = resizing.cell!.closest('tr')!
                  const cellsInRow = tr.querySelectorAll('td, th')
                  let colIndex = -1
                  cellsInRow.forEach((c, i) => { if (c === resizing!.cell) colIndex = i })
                  if (colIndex === -1) { resizing = null; return }

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
                      } else if (c === colIndex + 1 && resizing.nextCell) {
                        transaction.setNodeMarkup(tablePos + offset, undefined, {
                          ...cellNode.attrs,
                          colwidth: [nextWidth],
                        })
                      }
                      offset += cellNode.nodeSize
                    }
                    offset += 1
                  }
                }

                view.dispatch(transaction)
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
