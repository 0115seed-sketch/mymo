import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    detailsBlock: {
      setDetailsBlock: () => ReturnType
    }
  }
}

export const DetailsBlock = Node.create({
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

  parseHTML() {
    return [{ tag: 'details' }]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return ['details', mergeAttributes(HTMLAttributes), 0]
  },

  addNodeView() {
    return ({ node, editor, getPos }: any) => {
      const dom = document.createElement('details')
      if (node.attrs.open) dom.setAttribute('open', '')

      const contentDOM = document.createElement('div')
      contentDOM.style.display = 'contents'
      dom.append(contentDOM)

      // Prevent browser default toggle, use ProseMirror transaction instead
      dom.addEventListener('toggle', (e: Event) => {
        e.preventDefault()
        e.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos == null) return
        const currentOpen = dom.hasAttribute('open')
        editor.chain().command(({ tr }: { tr: any }) => {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, open: currentOpen })
          return true
        }).run()
      })

      return {
        dom,
        contentDOM,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'detailsBlock') return false
          if (updatedNode.attrs.open) {
            dom.setAttribute('open', '')
          } else {
            dom.removeAttribute('open')
          }
          return true
        },
      }
    }
  },

  addCommands() {
    return {
      setDetailsBlock: () => ({ commands }: { commands: any }) => {
        return commands.insertContent({
          type: this.name,
          attrs: { open: true },
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: '토글 제목' }] },
            { type: 'detailsContent', content: [{ type: 'paragraph' }] },
          ],
        })
      },
    }
  },
})

export const DetailsSummary = Node.create({
  name: 'detailsSummary',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'summary' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes, { class: 'toggle-summary' }), 0]
  },

  addKeyboardShortcuts() {
    return {
      'Enter': ({ editor }) => {
        // When pressing Enter in summary, move focus to toggleContent
        const { $from } = editor.state.selection
        if ($from.parent.type.name === 'detailsSummary') {
          // Find the detailsContent sibling
          const detailsBlockPos = $from.before($from.depth - 1)
          const detailsBlock = editor.state.doc.nodeAt(detailsBlockPos)
          if (detailsBlock && detailsBlock.childCount >= 2) {
            const summarySize = detailsBlock.child(0).nodeSize
            const contentStartPos = detailsBlockPos + 1 + summarySize + 1 + 1
            editor.commands.setTextSelection(contentStartPos)
            return true
          }
        }
        return false
      },
    }
  },
})

export const DetailsContent = Node.create({
  name: 'detailsContent',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle-content"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle-content', class: 'toggle-content' }), 0]
  },
})
