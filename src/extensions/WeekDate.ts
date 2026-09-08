import { Node, mergeAttributes } from '@tiptap/core'

const WEEKDAY_LABELS = ['이번주 월요일', '이번주 화요일', '이번주 수요일', '이번주 목요일', '이번주 금요일', '이번주 토요일', '이번주 일요일']

export const formatWeekDate = (weekday: number, reference = new Date()) => {
  const date = new Date(reference)
  const daysSinceMonday = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - daysSinceMonday + weekday)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    weekDate: {
      insertWeekDate: (weekday: number) => ReturnType
      convertAllWeekDates: () => ReturnType
    }
  }
}

export const WeekDate = Node.create({
  name: 'weekDate',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      weekday: {
        default: 0,
        parseHTML: element => Number(element.getAttribute('data-weekday') ?? 0),
        renderHTML: attributes => ({ 'data-weekday': attributes.weekday }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="week-date"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'week-date', class: 'week-date' })]
  },

  addCommands() {
    return {
      insertWeekDate: (weekday: number) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: { weekday },
      }),
      convertAllWeekDates: () => ({ state, dispatch }) => {
        const positions: number[] = []
        state.doc.descendants((node, pos) => {
          if (node.type.name === this.name) positions.push(pos)
        })
        if (positions.length === 0) return false

        const transaction = state.tr
        for (const pos of positions.reverse()) {
          const node = state.doc.nodeAt(pos)
          if (node) transaction.replaceWith(pos, pos + node.nodeSize, state.schema.text(formatWeekDate(node.attrs.weekday)))
        }
        if (dispatch) dispatch(transaction)
        return true
      },
    }
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'week-date'
      button.contentEditable = 'false'
      button.textContent = WEEKDAY_LABELS[node.attrs.weekday] ?? WEEKDAY_LABELS[0]
      button.title = '클릭하여 날짜로 변환'
      button.addEventListener('click', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (pos == null || !editor.isEditable) return
        editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, editor.state.schema.text(formatWeekDate(node.attrs.weekday))))
      })
      return { dom: button }
    }
  },
})