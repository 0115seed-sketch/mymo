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
  colwidth: {
    default: [192],
    parseHTML: (element: HTMLElement) => {
      const w = element.getAttribute('colwidth') || element.getAttribute('data-colwidth')
      if (w) return w.split(',').map(Number)
      const sw = element.style.width
      if (sw && sw.endsWith('px')) return [parseInt(sw, 10)]
      return [192]
    },
    renderHTML: (attributes: Record<string, any>) => {
      const cw = attributes.colwidth || [192]
      const w = cw[0]
      return {
        'data-colwidth': cw.join(','),
        style: `width: ${w}px`,
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
