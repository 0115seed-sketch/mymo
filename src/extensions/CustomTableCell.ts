import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'

const sharedAttributes = {
  backgroundColor: {
    default: '',
    parseHTML: (element: HTMLElement) => element.style.backgroundColor || '',
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes.backgroundColor) return {}
      return { style: `background-color: ${attributes.backgroundColor}` }
    },
  },
  rowHeight: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const h = element.getAttribute('data-row-height')
      return h ? parseInt(h, 10) : null
    },
    renderHTML: (attributes: Record<string, any>) => {
      if (!attributes.rowHeight) return {}
      return {
        'data-row-height': attributes.rowHeight,
        style: `height: ${attributes.rowHeight}px`,
      }
    },
  },
}

export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...sharedAttributes,
    }
  },
})

export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...sharedAttributes,
    }
  },
})
