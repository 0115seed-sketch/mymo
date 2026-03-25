import type { Editor } from '@tiptap/core'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const EXPORT_CSS = `
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #111827; line-height: 1.7; }
h1 { font-size: 2em; font-weight: 700; margin: 0 0 0.5em 0; }
h2 { font-size: 1.5em; font-weight: 600; margin-top: 1em; }
h3 { font-size: 1.25em; font-weight: 600; margin-top: 1em; }
p { line-height: 1.7; margin: 0.3em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
td, th { border: 1px solid #d1d5db; padding: 0.5em 0.75em; }
th { font-weight: 600; background: #f9fafb; }
ul[data-type="taskList"] { list-style: none; padding-left: 0; }
ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
ul[data-type="taskList"] li[data-checked="true"] p { text-decoration: line-through; color: #9ca3af; }
mark { background-color: #fef08a; padding: 0.1em 0.2em; border-radius: 2px; }
a { color: #2563eb; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 1em 0; }
div[data-type="multiColumn"] { display: grid; gap: 1em; }
div[data-type="multiColumn"][data-columns="2"] { grid-template-columns: 1fr 1fr; }
div[data-type="multiColumn"][data-columns="3"] { grid-template-columns: 1fr 1fr 1fr; }
div[data-type="column"] { border: 1px dashed #d1d5db; border-radius: 6px; padding: 0.75em; }
`

function buildExportHTML(editor: Editor, title: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>${EXPORT_CSS}</style></head><body><h1>${title}</h1>${editor.getHTML()}</body></html>`
}

// TipTap HTML → Markdown 변환
function htmlToMarkdown(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html

  function processNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || ''
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    const children = Array.from(el.childNodes).map(processNode).join('')

    switch (tag) {
      case 'h1': return `# ${children}\n\n`
      case 'h2': return `## ${children}\n\n`
      case 'h3': return `### ${children}\n\n`
      case 'p': return `${children}\n\n`
      case 'strong': return `**${children}**`
      case 'em': return `*${children}*`
      case 'u': return `<u>${children}</u>`
      case 's': return `~~${children}~~`
      case 'del': return `~~${children}~~`
      case 'code': return `\`${children}\``
      case 'mark': return `==${children}==`
      case 'a': return `[${children}](${el.getAttribute('href') || ''})`
      case 'br': return '\n'
      case 'hr': return '---\n\n'
      case 'ul': {
        if (el.getAttribute('data-type') === 'taskList') {
          return children
        }
        return children
      }
      case 'li': {
        if (el.closest('ul[data-type="taskList"]')) {
          const checked = el.getAttribute('data-checked') === 'true'
          const text = Array.from(el.querySelectorAll('p')).map(p => p.textContent).join(' ')
          return `- [${checked ? 'x' : ' '}] ${text}\n`
        }
        return `- ${children}`
      }
      case 'ol': return children
      case 'blockquote': return `> ${children.trim()}\n\n`
      case 'pre': {
        const code = el.querySelector('code')
        return `\`\`\`\n${code?.textContent || children}\n\`\`\`\n\n`
      }
      case 'table': {
        const rows = Array.from(el.querySelectorAll('tr'))
        if (rows.length === 0) return ''

        const result: string[] = []
        rows.forEach((row, idx) => {
          const cells = Array.from(row.querySelectorAll('td, th'))
          const line = '| ' + cells.map(c => (c.textContent || '').trim()).join(' | ') + ' |'
          result.push(line)
          if (idx === 0) {
            result.push('| ' + cells.map(() => '---').join(' | ') + ' |')
          }
        })
        return result.join('\n') + '\n\n'
      }
      case 'div': return children
      default: return children
    }
  }

  return Array.from(div.childNodes).map(processNode).join('').trim() + '\n'
}

export function exportAsPDF(editor: Editor, title: string) {
  const htmlContent = buildExportHTML(editor, title)
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(htmlContent)
  win.document.close()
  win.onload = () => {
    win.print()
  }
}

export async function exportAsImage(_editor: Editor, title: string) {
  const html2canvas = (await import('html2canvas')).default
  // 에디터의 실제 DOM 요소를 직접 캡처
  const editorEl = document.querySelector('.tiptap') as HTMLElement
  if (!editorEl) return

  const canvas = await html2canvas(editorEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
  })
  canvas.toBlob((blob) => {
    if (blob) download(blob, `${title || '문서'}.png`)
  }, 'image/png')
}

export function exportAsMarkdown(editor: Editor, title: string) {
  const html = editor.getHTML()
  const md = `# ${title}\n\n${htmlToMarkdown(html)}`
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  download(blob, `${title || '문서'}.md`)
}

export function exportAsText(editor: Editor, title: string) {
  const text = `${title}\n${'='.repeat(title.length || 4)}\n\n${editor.getText()}`
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  download(blob, `${title || '문서'}.txt`)
}

// 백업: 전체 DB를 JSON으로 내보내기
export async function backupData() {
  const { db } = await import('../db')
  const pages = await db.pages.toArray()
  const folders = await db.folders.toArray()

  const backup = {
    app: 'mymo',
    version: 3,
    exportedAt: Date.now(),
    pages,
    folders,
  }

  const json = JSON.stringify(backup, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const date = new Date().toISOString().slice(0, 10)
  download(blob, `mymo-backup-${date}.json`)
}

// 불러오기: JSON 파일에서 DB 복원
export async function restoreData(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve({ success: false, message: '파일이 선택되지 않았습니다.' })

      try {
        const text = await file.text()
        const data = JSON.parse(text)

        if (data.app !== 'mymo' || !Array.isArray(data.pages) || !Array.isArray(data.folders)) {
          return resolve({ success: false, message: '올바른 mymo 백업 파일이 아닙니다.' })
        }

        if (!confirm(`백업 파일을 불러오면 현재 데이터가 모두 삭제됩니다.\n\n페이지 ${data.pages.length}개, 폴더 ${data.folders.length}개를 복원합니다.\n계속하시겠습니까?`)) {
          return resolve({ success: false, message: '취소되었습니다.' })
        }

        const { db } = await import('../db')
        await db.pages.clear()
        await db.folders.clear()
        await db.pages.bulkAdd(data.pages)
        await db.folders.bulkAdd(data.folders)

        resolve({ success: true, message: `복원 완료! 페이지 ${data.pages.length}개, 폴더 ${data.folders.length}개` })
      } catch {
        resolve({ success: false, message: '파일을 읽을 수 없습니다.' })
      }
    }
    input.click()
  })
}
