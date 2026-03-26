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
import Toolbar from './Toolbar'
import { darkMode } from '../stores/settings'

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
