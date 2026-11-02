import type { Editor } from '@tiptap/core'
import { db } from '../db'
import { flushPendingWrites, trackWrite } from '../stores/persistence'
import { validateBackup, restoreBackup } from './backup'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const buildBackupFilename = () => {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '-')
  return `mymo-backup-${date}-${time}.json`
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

// Read one transactionally consistent snapshot after pending edits are saved.
export async function backupData() {
  const source = db
  await flushPendingWrites()
  if (source !== db) throw new Error('계정이 변경되었습니다. 다시 백업해주세요.')
  const backup = await source.transaction('r', [source.pages, source.folders], async () => ({
    app: 'mymo', version: 4, exportedAt: Date.now(), pages: await source.pages.toArray(), folders: await source.folders.toArray(),
  }))
  download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }), buildBackupFilename())
}

export async function exportRecoveryBackup() {
  const snapshot = await db.recovery.orderBy('createdAt').last()
  if (!snapshot) { alert('복원 전 저장된 자료가 없습니다.'); return }
  const backup = { app: 'mymo', version: 4, exportedAt: snapshot.createdAt, pages: snapshot.pages, folders: snapshot.folders }
  download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }), 'mymo-before-restore.json')
}

export async function restoreData(): Promise<{ success: boolean; message: string }> {
  const target = db
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.oncancel = () => resolve({ success: false, message: '취소되었습니다.' })
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve({ success: false, message: '취소되었습니다.' })
      try {
        const data = validateBackup(JSON.parse(await file.text()))
        if (!confirm('현재 작업 공간을 백업 파일의 페이지 ' + data.pages.length + '개로 교체합니다.\n기존 자료는 복원 전 백업으로 보존됩니다. 계속하시겠습니까?')) {
          resolve({ success: false, message: '취소되었습니다.' }); return
        }
        await flushPendingWrites()
        if (target !== db) throw new Error('계정이 변경되었습니다. 다시 불러와주세요.')
        await trackWrite(restoreBackup(target, data))
        window.dispatchEvent(new Event('mymo:local-change'))
        resolve({ success: true, message: '복원 완료: 페이지 ' + data.pages.length + '개. 기존 자료는 설정의 복원 전 백업에서 내려받을 수 있습니다.' })
      } catch (error) {
        resolve({ success: false, message: '복원하지 않았습니다. ' + (error instanceof Error ? error.message : String(error)) })
      }
    }
    input.click()
  })
}
