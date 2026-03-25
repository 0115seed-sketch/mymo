import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    multiColumn: {
      setColumns: (columns: number) => ReturnType
    }
  }
}

export const MultiColumn = Node.create({
  name: 'multiColumn',
  group: 'block',
  content: 'column+',
  defining: true,

  addAttributes() {
    return {
      columns: {
        default: 2,
        parseHTML: (el) => parseInt(el.getAttribute('data-columns') || '2', 10),
        renderHTML: (attrs) => ({ 'data-columns': attrs.columns }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="multi-column"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'multi-column', class: 'multi-column' }), 0]
  },

  addCommands() {
    return {
      setColumns: (columns: number) => ({ commands }: { commands: any }) => {
        const columnNodes: Array<{ type: string; content: Array<{ type: string }> }> = []
        for (let i = 0; i < columns; i++) {
          columnNodes.push({
            type: 'column',
            content: [{ type: 'paragraph' }],
          })
        }
        return commands.insertContent({
          type: this.name,
          attrs: { columns },
          content: columnNodes,
        })
      },
    }
  },
})

export const Column = Node.create({
  name: 'column',
  group: 'column',
  content: 'block+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="column"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'column', class: 'column' }), 0]
  },
})
