import { Node, mergeAttributes, Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import TextAlign from '@tiptap/extension-text-align'
import { type NodeViewRendererProps } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    actionButton: {
      insertActionButton: () => ReturnType
    }
  }
}

export const ActionButton = Node.create({
  name: 'actionButton',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      label: { default: '블록 삽입' },
      templateContent: { default: '' }, // JSON string of template content
      insertPosition: { default: 'below' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="action-button"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'action-button' })]
  },

  addCommands() {
    return {
      insertActionButton: () => ({ commands }: { commands: any }) => {
        return commands.insertContent({
          type: 'actionButton',
          attrs: {
            label: '블록 삽입',
            templateContent: '',
            insertPosition: 'below',
          },
        })
      },
    }
  },

  addNodeView() {
    return (props: NodeViewRendererProps) => {
      const { node: initialNode, editor, getPos } = props

      // Keep track of latest node attrs for re-editing
      let currentAttrs = { ...initialNode.attrs }

      const dom = document.createElement('div')
      dom.classList.add('action-button-wrapper')
      dom.contentEditable = 'false'

      // Main button
      const btn = document.createElement('button')
      btn.classList.add('action-button-main')
      btn.textContent = currentAttrs.label

      btn.addEventListener('click', () => {
        const templateJson = currentAttrs.templateContent
        if (!templateJson) return
        let content: any
        try { content = JSON.parse(templateJson) } catch { return }
        if (!content || (Array.isArray(content) && content.length === 0)) return

        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos == null) return

        const insertPosition = currentAttrs.insertPosition
        if (insertPosition === 'top') {
          editor.chain().focus().insertContentAt(0, content).run()
        } else if (insertPosition === 'bottom') {
          const endPos = editor.state.doc.content.size
          editor.chain().focus().insertContentAt(endPos, content).run()
        } else {
          const afterPos = pos + editor.state.doc.nodeAt(pos)!.nodeSize
          editor.chain().focus().insertContentAt(afterPos, content).run()
        }
      })

      // Gear
      const gear = document.createElement('button')
      gear.classList.add('action-button-gear')
      gear.textContent = '⚙'
      gear.title = '버튼 설정'

      // Modal overlay
      let modal: HTMLDivElement | null = null
      let miniEditor: Editor | null = null

      const openModal = () => {
        if (modal) return

        modal = document.createElement('div')
        modal.classList.add('action-button-modal-overlay')

        const dialog = document.createElement('div')
        dialog.classList.add('action-button-modal')

        // Title
        const title = document.createElement('h3')
        title.textContent = '버튼 설정'
        title.classList.add('modal-title')
        dialog.append(title)

        // Label input
        const labelGroup = document.createElement('div')
        labelGroup.classList.add('setting-group')
        const labelLabel = document.createElement('label')
        labelLabel.textContent = '버튼 이름'
        const labelInput = document.createElement('input')
        labelInput.type = 'text'
        labelInput.value = currentAttrs.label
        labelInput.classList.add('setting-input')
        labelGroup.append(labelLabel, labelInput)
        dialog.append(labelGroup)

        // Position select
        const posGroup = document.createElement('div')
        posGroup.classList.add('setting-group')
        const posLabel = document.createElement('label')
        posLabel.textContent = '삽입 위치'
        const posSelect = document.createElement('select')
        posSelect.classList.add('setting-input')
        const positions = [
          { value: 'below', label: '버튼 아래' },
          { value: 'top', label: '페이지 상단' },
          { value: 'bottom', label: '페이지 하단' },
        ]
        for (const p of positions) {
          const opt = document.createElement('option')
          opt.value = p.value
          opt.textContent = p.label
          if (p.value === currentAttrs.insertPosition) opt.selected = true
          posSelect.append(opt)
        }
        posGroup.append(posLabel, posSelect)
        dialog.append(posGroup)

        // Template editor label
        const tplLabel = document.createElement('div')
        tplLabel.classList.add('setting-group')
        const tplLabelText = document.createElement('label')
        tplLabelText.textContent = '삽입할 블록 (복사-붙여넣기로 편집)'
        tplLabel.append(tplLabelText)
        dialog.append(tplLabel)

        // Mini editor element
        const editorEl = document.createElement('div')
        editorEl.classList.add('mini-editor')
        dialog.append(editorEl)

        // Parse existing template
        let initialContent: any = undefined
        if (currentAttrs.templateContent) {
          try {
            const parsed = JSON.parse(currentAttrs.templateContent)
            // Saved as array from getJSON().content — wrap in doc object
            initialContent = Array.isArray(parsed)
              ? { type: 'doc', content: parsed }
              : parsed
          } catch { /* ignore */ }
        }

        miniEditor = new Editor({
          element: editorEl,
          extensions: [
            StarterKit.configure({
              heading: { levels: [1, 2, 3] },
              link: { openOnClick: false },
            }),
            TaskList.configure(),
            TaskItem.configure({ nested: true }),
            Highlight.configure({ multicolor: true }),
            TextStyle.configure(),
            Color.configure(),
            Table.configure({ resizable: true }),
            TableRow.configure(),
            TableCell.configure().extend({
              addAttributes() {
                return {
                  ...this.parent?.(),
                  backgroundColor: {
                    default: '',
                    parseHTML: (el: HTMLElement) => el.style.backgroundColor || '',
                    renderHTML: (attrs: Record<string, any>) => {
                      if (!attrs.backgroundColor) return {}
                      return { style: `background-color: ${attrs.backgroundColor}` }
                    },
                  },
                }
              },
            }),
            TableHeader.configure().extend({
              addAttributes() {
                return {
                  ...this.parent?.(),
                  backgroundColor: {
                    default: '',
                    parseHTML: (el: HTMLElement) => el.style.backgroundColor || '',
                    renderHTML: (attrs: Record<string, any>) => {
                      if (!attrs.backgroundColor) return {}
                      return { style: `background-color: ${attrs.backgroundColor}` }
                    },
                  },
                }
              },
            }),
            Node.create({
              name: 'multiColumn',
              group: 'block',
              content: 'column+',
              defining: true,
              addAttributes() {
                return {
                  columns: {
                    default: 2,
                    parseHTML: (el: Element) => parseInt(el.getAttribute('data-columns') || '2', 10),
                    renderHTML: (attrs: Record<string, any>) => ({ 'data-columns': attrs.columns }),
                  },
                }
              },
              parseHTML() { return [{ tag: 'div[data-type="multi-column"]' }] },
              renderHTML({ HTMLAttributes }: any) {
                return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'multi-column', class: 'multi-column' }), 0]
              },
              addCommands() {
                return {
                  setColumns: (columns: number) => ({ commands }: any) => {
                    const cols = Array.from({ length: columns }, () => ({ type: 'column', content: [{ type: 'paragraph' }] }))
                    return commands.insertContent({ type: 'multiColumn', attrs: { columns }, content: cols })
                  },
                } as any
              },
            }),
            Node.create({
              name: 'column',
              group: 'column',
              content: 'block+',
              defining: true,
              isolating: true,
              parseHTML() { return [{ tag: 'div[data-type="column"]' }] },
              renderHTML({ HTMLAttributes }: any) {
                return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'column' }), 0]
              },
            }),
            // 토글(details) 지원
            Node.create({
              name: 'detailsBlock',
              group: 'block',
              content: 'detailsSummary detailsContent',
              defining: true,
              addAttributes() {
                return {
                  open: {
                    default: true,
                    parseHTML: (el: HTMLElement) => el.hasAttribute('open'),
                    renderHTML: (attrs: Record<string, any>) => attrs.open ? { open: '' } : {},
                  },
                }
              },
              parseHTML() { return [{ tag: 'details' }] },
              renderHTML({ HTMLAttributes }: any) { return ['details', mergeAttributes(HTMLAttributes), 0] },
            }),
            Node.create({
              name: 'detailsSummary',
              content: 'inline*',
              defining: true,
              parseHTML() { return [{ tag: 'summary' }] },
              renderHTML({ HTMLAttributes }: any) {
                return ['summary', mergeAttributes(HTMLAttributes, { class: 'toggle-summary' }), 0]
              },
            }),
            Node.create({
              name: 'detailsContent',
              content: 'block+',
              defining: true,
              parseHTML() { return [{ tag: 'div[data-type="toggle-content"]' }] },
              renderHTML({ HTMLAttributes }: any) {
                return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-content', class: 'toggle-content' }), 0]
              },
            }),
            TextAlign.configure({
              types: ['heading', 'paragraph'],
            }),
          ],
          content: initialContent || { type: 'doc', content: [{ type: 'paragraph' }] },
        })

        // Action buttons
        const actionRow = document.createElement('div')
        actionRow.classList.add('modal-actions')

        const cancelBtn = document.createElement('button')
        cancelBtn.textContent = '취소'
        cancelBtn.classList.add('modal-cancel-btn')
        cancelBtn.addEventListener('click', closeModal)

        const saveBtn = document.createElement('button')
        saveBtn.textContent = '저장'
        saveBtn.classList.add('setting-save-btn')
        saveBtn.addEventListener('click', () => {
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (pos == null) return
          const templateJSON = miniEditor ? JSON.stringify(miniEditor.getJSON().content) : ''

          const newAttrs = {
            label: labelInput.value || '블록 삽입',
            templateContent: templateJSON,
            insertPosition: posSelect.value,
          }

          // Use dispatch directly to avoid focus issues with mini editor
          const { tr } = editor.state
          tr.setNodeMarkup(pos, undefined, newAttrs)
          editor.view.dispatch(tr)

          // Update local tracking
          currentAttrs = { ...newAttrs }
          btn.textContent = newAttrs.label
          closeModal()
        })

        actionRow.append(cancelBtn, saveBtn)
        dialog.append(actionRow)

        modal.append(dialog)
        document.body.append(modal)

        // Click outside to close
        modal.addEventListener('click', (e) => {
          if (e.target === modal) closeModal()
        })
      }

      const closeModal = () => {
        if (miniEditor) {
          miniEditor.destroy()
          miniEditor = null
        }
        if (modal) {
          modal.remove()
          modal = null
        }
      }

      gear.addEventListener('click', (e) => {
        e.stopPropagation()
        openModal()
      })

      dom.append(btn, gear)

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'actionButton') return false
          currentAttrs = { ...updatedNode.attrs }
          btn.textContent = currentAttrs.label
          return true
        },
        destroy() {
          closeModal()
        },
      }
    }
  },
})
