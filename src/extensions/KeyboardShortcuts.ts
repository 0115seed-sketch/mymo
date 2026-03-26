import { Extension } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'

// 블록 컨테이너 노드 타입들
const BLOCK_CONTAINERS = [
  'tableCell', 'tableHeader',  // 셀 → 표
  'column',                     // 열 → 멀티열
  'detailsContent',             // 토글 내용
  'table', 'multiColumn', 'detailsBlock', // 큰 블록 단위
]

export const KeyboardShortcuts = Extension.create({
  name: 'customKeyboardShortcuts',

  addKeyboardShortcuts() {
    const handleTableStructureDelete = (): boolean => {
      const { state } = this.editor
      const sel = state.selection as any

      if (!sel.$anchorCell || !this.editor.isActive('table')) {
        return false
      }

      const $anchor = sel.$anchorCell
      if (!$anchor) return false

      const tableStart = $anchor.start(-1)
      const tableNode = state.doc.nodeAt(tableStart - 1)
      if (!tableNode) return false

      const totalRows = tableNode.childCount
      const totalCols = tableNode.child(0).childCount
      const totalCells = totalRows * totalCols
      const selectedCount = sel.ranges?.length || 0

      // 전체 선택 → 표 삭제
      if (selectedCount >= totalCells) {
        return this.editor.chain().focus().deleteTable().run()
      }

      // 행 전체 선택 확인
      if (selectedCount >= totalCols && selectedCount % totalCols === 0) {
        if (typeof sel.isRowSelection === 'function' ? sel.isRowSelection() : true) {
          return this.editor.chain().focus().deleteRow().run()
        }
      }

      // 열 전체 선택 확인
      if (selectedCount >= totalRows && selectedCount % totalRows === 0) {
        if (typeof sel.isColSelection === 'function' ? sel.isColSelection() : true) {
          return this.editor.chain().focus().deleteColumn().run()
        }
      }

      return false
    }

    return {
      // Ctrl+A: 점진적 블록 단위 선택
      // 1차: 현재 셀/열/토글 내용 선택
      // 2차: 표/멀티열/토글 전체 선택
      // 3차: 페이지 전체 선택
      'Mod-a': () => {
        const { state } = this.editor
        const { from, to, $from } = state.selection

        for (let depth = $from.depth; depth >= 1; depth--) {
          const node = $from.node(depth)
          if (!BLOCK_CONTAINERS.includes(node.type.name)) continue

          const start = $from.start(depth)
          const end = $from.end(depth)

          // 이 레벨이 이미 완전히 선택되었으면 상위 레벨로
          if (from <= start && to >= end) continue

          this.editor.view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, start, end))
          )
          return true
        }

        // 모든 컨테이너가 선택된 상태 → 전체 선택
        return false
      },

      // Ctrl+D: 취소선 (Strikethrough)
      'Mod-d': () => this.editor.chain().focus().toggleStrike().run(),

      // Ctrl+↑: 제목 레벨 올리기 (p → h3 → h2 → h1)
      'Mod-ArrowUp': () => {
        const editor = this.editor
        if (editor.isActive('heading', { level: 1 })) return true
        if (editor.isActive('heading', { level: 2 })) {
          return editor.chain().focus().setHeading({ level: 1 }).run()
        }
        if (editor.isActive('heading', { level: 3 })) {
          return editor.chain().focus().setHeading({ level: 2 }).run()
        }
        return editor.chain().focus().setHeading({ level: 3 }).run()
      },

      // Ctrl+↓: 제목 레벨 내리기 (h1 → h2 → h3 → p)
      'Mod-ArrowDown': () => {
        const editor = this.editor
        if (editor.isActive('heading', { level: 1 })) {
          return editor.chain().focus().setHeading({ level: 2 }).run()
        }
        if (editor.isActive('heading', { level: 2 })) {
          return editor.chain().focus().setHeading({ level: 3 }).run()
        }
        if (editor.isActive('heading', { level: 3 })) {
          return editor.chain().focus().setParagraph().run()
        }
        return true
      },

      // Ctrl+X: 표 전체 선택 시 표 자체를 잘라내기
      'Mod-x': () => {
        const { state } = this.editor
        const { selection } = state

        // Check if it's a CellSelection (from @tiptap/pm/tables)
        if (selection.$anchorCell && this.editor.isActive('table')) {
          const cellSelection = selection as any

          if (cellSelection.$anchorCell) {
            const tableStart = cellSelection.$anchorCell.start(-1)
            const tableNode = state.doc.nodeAt(tableStart - 1)

            if (tableNode && tableNode.type.name === 'table') {
              // Count total cells in table
              let totalCells = 0
              tableNode.descendants((node) => {
                if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                  totalCells++
                }
              })

              // Count selected cells
              const selectedCells = cellSelection.ranges ? cellSelection.ranges.length : 0

              if (selectedCells >= totalCells) {
                // All cells selected — copy table to clipboard, then delete
                const tablePos = tableStart - 1
                const serializer = DOMSerializer.fromSchema(state.schema)
                const fragment = serializer.serializeFragment(
                  state.doc.slice(tablePos, tablePos + tableNode.nodeSize).content
                )
                const div = document.createElement('div')
                div.append(fragment)

                navigator.clipboard.write([
                  new ClipboardItem({
                    'text/html': new Blob([div.innerHTML], { type: 'text/html' }),
                    'text/plain': new Blob([div.textContent || ''], { type: 'text/plain' }),
                  })
                ]).catch(() => {})

                return this.editor.chain().focus().deleteTable().run()
              }
            }
          }
        }

        // Default behavior for non-table or partial selection
        return false
      },

      // 표 단축키: Ctrl+Shift+↓ 아래에 행 추가
      'Mod-Shift-ArrowDown': () => {
        if (this.editor.isActive('table')) {
          return this.editor.chain().focus().addRowAfter().run()
        }
        return false
      },

      // 표 단축키: Ctrl+Shift+↑ 위에 행 추가
      'Mod-Shift-ArrowUp': () => {
        if (this.editor.isActive('table')) {
          return this.editor.chain().focus().addRowBefore().run()
        }
        return false
      },

      // 표 단축키: Ctrl+Shift+→ 오른쪽에 열 추가
      'Mod-Shift-ArrowRight': () => {
        if (this.editor.isActive('table')) {
          return this.editor.chain().focus().addColumnAfter().run()
        }
        return false
      },

      // 표 단축키: Ctrl+Shift+← 왼쪽에 열 추가
      'Mod-Shift-ArrowLeft': () => {
        if (this.editor.isActive('table')) {
          return this.editor.chain().focus().addColumnBefore().run()
        }
        return false
      },

      // 표 단축키: Ctrl+Shift+Backspace 행 삭제
      'Mod-Shift-Backspace': () => {
        if (this.editor.isActive('table')) {
          return this.editor.chain().focus().deleteRow().run()
        }
        return false
      },

      // 표: 전체 행/열/표 선택 후 Delete → 구조 삭제
      'Delete': () => {
        return handleTableStructureDelete()
      },
      'Backspace': () => {
        return handleTableStructureDelete()
      },
    }
  },
})
