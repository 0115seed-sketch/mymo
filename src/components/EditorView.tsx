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

// ── 행 높이 드래그 리사이즈 플러그인 ──
const rowResizePluginKey = new PluginKey('rowResize')

const RowResize = Extension.create({
  name: 'rowResize',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: rowResizePluginKey,
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement
              if (!target.classList.contains('row-resize-handle')) return false

              event.preventDefault()
              const tr = target.closest('tr') as HTMLTableRowElement | null
              if (!tr) return false

              const startY = event.clientY
              const startHeight = tr.offsetHeight

              const onMouseMove = (e: MouseEvent) => {
                const newHeight = Math.max(30, startHeight + (e.clientY - startY))
                tr.style.height = `${newHeight}px`
                const cells = tr.querySelectorAll('td, th')
                cells.forEach(c => { (c as HTMLElement).style.height = `${newHeight}px` })
              }

              const onMouseUp = (e: MouseEvent) => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
                document.body.style.cursor = ''

                const finalHeight = Math.max(30, startHeight + (e.clientY - startY))

                // ProseMirror 트랜잭션으로 rowHeight 설정 (Ctrl+Z 가능)
                const { state } = view
                const tableEl = tr.closest('table')
                if (!tableEl) return

                // 에디터 DOM에서 table 노드를 찾기
                const editorDom = view.dom
                const tables = editorDom.querySelectorAll('table')
                let tableIndex = -1
                tables.forEach((t, i) => { if (t === tableEl) tableIndex = i })
                if (tableIndex === -1) return

                // 문서에서 table 노드 위치 찾기
                let tableCount = 0
                let tablePos = -1
                state.doc.descendants((node, pos) => {
                  if (node.type.name === 'table') {
                    if (tableCount === tableIndex) {
                      tablePos = pos
                    }
                    tableCount++
                  }
                })
                if (tablePos === -1) return

                const tableNode = state.doc.nodeAt(tablePos)
                if (!tableNode) return

                // 해당 행의 인덱스 찾기
                const rows = tr.parentElement?.querySelectorAll('tr')
                if (!rows) return
                let rowIndex = -1
                rows.forEach((r, i) => { if (r === tr) rowIndex = i })
                if (rowIndex === -1) return

                // 트랜잭션 생성
                const { tr: transaction } = state
                let offset = 1 // table 시작 후 첫 행까지
                for (let r = 0; r < tableNode.childCount; r++) {
                  const row = tableNode.child(r)
                  offset += 1 // tableRow 노드 시작
                  if (r === rowIndex) {
                    for (let c = 0; c < row.childCount; c++) {
                      const cell = row.child(c)
                      transaction.setNodeMarkup(tablePos + offset, undefined, {
                        ...cell.attrs,
                        rowHeight: finalHeight,
                      })
                      offset += cell.nodeSize
                    }
                  } else {
                    for (let c = 0; c < row.childCount; c++) {
                      offset += row.child(c).nodeSize
                    }
                  }
                  offset += 1 // tableRow 노드 끝
                }
                view.dispatch(transaction)
              }

              document.body.style.cursor = 'row-resize'
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
          resizable: true,
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

    // 테이블 셀에 row-resize-handle 자동 삽입
    const addRowResizeHandles = () => {
      const cells = editorElement.querySelectorAll('.tiptap table td, .tiptap table th')
      cells.forEach(cell => {
        if (!cell.querySelector('.row-resize-handle')) {
          const handle = document.createElement('div')
          handle.className = 'row-resize-handle'
          cell.appendChild(handle)
        }
      })
    }

    // 초기 실행 + DOM 변경 감시
    setTimeout(addRowResizeHandles, 100)
    const observer = new MutationObserver(() => {
      setTimeout(addRowResizeHandles, 50)
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
