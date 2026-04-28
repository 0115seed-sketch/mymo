import { Show, createSignal, For } from 'solid-js'
import type { Component } from 'solid-js'
import type { Editor } from '@tiptap/core'
import EmojiPicker from './EmojiPicker'
import { darkMode } from '../stores/settings'
import { fileToOptimizedDataUrl } from '../utils/image'

const TEXT_COLORS = [
  { color: '#000000', name: '검정' },
  { color: '#6b7280', name: '회색' },
  { color: '#d1d5db', name: '연회색' },
  { color: '#ffffff', name: '흰색', border: true },
  { color: '#eab308', name: '노랑' },
  { color: '#ef4444', name: '빨강' },
  { color: '#3b82f6', name: '파랑' },
  { color: '#22c55e', name: '초록' },
]

const BG_COLORS = [
  { color: '', name: '없음' },
  { color: '#000000', name: '검정' },
  { color: '#6b7280', name: '회색' },
  { color: '#d1d5db', name: '연회색' },
  { color: '#ffffff', name: '흰색', border: true },
  { color: '#fef08a', name: '노랑' },
  { color: '#fecaca', name: '빨강' },
  { color: '#bfdbfe', name: '파랑' },
  { color: '#bbf7d0', name: '초록' },
]

interface ToolbarProps {
  editor: Editor | null
  version?: number
  pageTitle?: string
  pageId?: string | null
  onCreateSubPage?: (parentPageId: string) => Promise<{ id: string; title: string; path: string } | undefined>
}

const Toolbar: Component<ToolbarProps> = (props) => {
  const [showEmoji, setShowEmoji] = createSignal(false)
  const [showTextColor, setShowTextColor] = createSignal(false)
  const [showBgColor, setShowBgColor] = createSignal(false)
  const [showCellColor, setShowCellColor] = createSignal(false)
  const [showTextGroup, setShowTextGroup] = createSignal(false)
  const [showInsertGroup, setShowInsertGroup] = createSignal(false)

  const isActive = (name: string, attrs?: Record<string, unknown>) => {
    void props.version
    return props.editor?.isActive(name, attrs) ? 'btn btn-active' : 'btn'
  }

  const tableActive = () => {
    void props.version
    return !!props.editor?.isActive('table')
  }

  const groupBtnClass = (open: boolean) =>
    `btn font-medium ${open ? (darkMode() ? '!bg-[#3d3f5c] !text-white' : '!bg-gray-200') : ''}`

  const normalizeHref = (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) return ''

    if (trimmed.startsWith('#')) return trimmed
    if (trimmed.startsWith('/')) return `#${trimmed}`
    if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed
    if (/^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(trimmed)) return `https://${trimmed}`

    return trimmed
  }

  return (
    <Show when={props.editor}>
      <div class={`flex items-center gap-0.5 px-3 py-1.5 border-b flex-wrap ${darkMode() ? 'border-gray-700 bg-[#1a1b2e]' : 'border-gray-200 bg-white'}`}>

        {/* ── 글자 설정 ── */}
        <button class={groupBtnClass(showTextGroup())} onClick={() => setShowTextGroup(!showTextGroup())}>
          {showTextGroup() ? '▼' : '▶'} 글자 설정
        </button>

        <Show when={showTextGroup()}>
          {/* Headings */}
          <button class={isActive('heading', { level: 1 })} onClick={() => props.editor!.chain().focus().toggleHeading({ level: 1 }).run()}>
            H1
          </button>
          <button class={isActive('heading', { level: 2 })} onClick={() => props.editor!.chain().focus().toggleHeading({ level: 2 }).run()}>
            H2
          </button>
          <button class={isActive('heading', { level: 3 })} onClick={() => props.editor!.chain().focus().toggleHeading({ level: 3 }).run()}>
            H3
          </button>

          <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Text formatting */}
          <button class={isActive('bold')} onClick={() => props.editor!.chain().focus().toggleBold().run()}>
            <strong>B</strong>
          </button>
          <button class={isActive('italic')} onClick={() => props.editor!.chain().focus().toggleItalic().run()}>
            <em>I</em>
          </button>
          <button class={isActive('underline')} onClick={() => props.editor!.chain().focus().toggleUnderline().run()}>
            <u>U</u>
          </button>
          <button class={isActive('strike')} onClick={() => props.editor!.chain().focus().toggleStrike().run()}>
            <s>S</s>
          </button>
          <button class={isActive('highlight')} onClick={() => props.editor!.chain().focus().toggleHighlight().run()}>
            <span class="bg-yellow-200 px-0.5">H</span>
          </button>

          <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Text color */}
          <div class="relative">
            <button class="btn" onClick={() => { setShowTextColor(!showTextColor()); setShowBgColor(false) }}>
              <span style={`color: ${props.editor?.getAttributes('textStyle').color || '#000'}`}>●</span> 글자색
            </button>
            <Show when={showTextColor()}>
              <div class="color-dropdown">
                <For each={TEXT_COLORS}>
                  {(c) => (
                    <button
                      class="color-dropdown-item"
                      onClick={() => { props.editor!.chain().focus().setColor(c.color).run(); setShowTextColor(false) }}
                    >
                      <span class="color-dot" style={`background:${c.color};${c.border ? 'border:1px solid #d1d5db;' : ''}`} />
                      <span>{c.name}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Background color */}
          <div class="relative">
            <button class="btn" onClick={() => { setShowBgColor(!showBgColor()); setShowTextColor(false) }}>
              <span class="px-0.5" style={`background: ${props.editor?.getAttributes('highlight').color || '#fef08a'}`}>A</span> 배경색
            </button>
            <Show when={showBgColor()}>
              <div class="color-dropdown">
                <For each={BG_COLORS}>
                  {(c) => (
                    <button
                      class="color-dropdown-item"
                      onClick={() => {
                        if (c.color === '') {
                          props.editor!.chain().focus().unsetHighlight().run()
                        } else {
                          props.editor!.chain().focus().toggleHighlight({ color: c.color }).run()
                        }
                        setShowBgColor(false)
                      }}
                    >
                      <span class="color-dot" style={c.color === '' ? 'background:white;border:1px dashed #d1d5db;' : `background:${c.color};${c.border ? 'border:1px solid #d1d5db;' : ''}`} />
                      <span>{c.name}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Text alignment */}
          <button class={isActive('paragraph', { textAlign: 'left' }) === 'btn btn-active' || (!props.editor?.isActive({ textAlign: 'center' }) && !props.editor?.isActive({ textAlign: 'right' })) ? 'btn btn-active' : 'btn'} onClick={() => props.editor!.chain().focus().setTextAlign('left').run()} title="왼쪽 정렬">
            ◧
          </button>
          <button class={props.editor?.isActive({ textAlign: 'center' }) ? 'btn btn-active' : 'btn'} onClick={() => props.editor!.chain().focus().setTextAlign('center').run()} title="중앙 정렬">
            ◫
          </button>
          <button class={props.editor?.isActive({ textAlign: 'right' }) ? 'btn btn-active' : 'btn'} onClick={() => props.editor!.chain().focus().setTextAlign('right').run()} title="오른쪽 정렬">
            ◨
          </button>
        </Show>

        {/* 글자 설정이 펼쳐져 있으면 줄바꿈 */}
        <Show when={showTextGroup()}>
          <div class="basis-full h-0" />
        </Show>

        {/* ── 삽입 ── */}
        <button class={groupBtnClass(showInsertGroup())} onClick={() => setShowInsertGroup(!showInsertGroup())}>
          {showInsertGroup() ? '▼' : '▶'} 삽입
        </button>

        <Show when={showInsertGroup()}>
          {/* Task list */}
          <button class={isActive('taskList')} onClick={() => props.editor!.chain().focus().toggleTaskList().run()}>
            ☑ 할일
          </button>

          {/* Code block */}
          <button class={isActive('codeBlock')} onClick={() => props.editor!.chain().focus().toggleCodeBlock().run()}>
            {'</>'} 코드
          </button>

          {/* Link */}
          <button
            class={isActive('link')}
            onClick={() => {
              if (props.editor!.isActive('link')) {
                const currentHref = String(props.editor!.getAttributes('link').href ?? '')
                const nextHref = window.prompt('링크를 수정하세요. 비워두면 링크가 삭제됩니다:', currentHref)
                if (nextHref === null) return

                const trimmed = nextHref.trim()
                if (!trimmed) {
                  props.editor!.chain().focus().unsetLink().run()
                } else {
                  const normalized = normalizeHref(trimmed)
                  props.editor!.chain().focus().setLink({
                    href: normalized,
                    target: normalized.startsWith('#') ? null : '_blank',
                  }).run()
                }
              } else {
                const url = window.prompt('URL을 입력하세요:')
                if (url) {
                  const trimmed = url.trim()
                  if (!trimmed) return
                  const normalized = normalizeHref(trimmed)
                  props.editor!.chain().focus().setLink({
                    href: normalized,
                    target: normalized.startsWith('#') ? null : '_blank',
                  }).run()
                }
              }
            }}
          >
            🔗 링크
          </button>

          {/* Emoji */}
          <div class="relative">
            <button class="btn" onClick={() => setShowEmoji(!showEmoji())}>
              😀 이모지
            </button>
            <Show when={showEmoji()}>
              <EmojiPicker
                onSelect={(emoji) => props.editor!.chain().focus().insertContent(emoji).run()}
                onClose={() => setShowEmoji(false)}
              />
            </Show>
          </div>

          {/* Image upload */}
          <button
            class="btn"
            title="이미지 삽입"
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.multiple = true
              input.onchange = () => {
                const files = Array.from(input.files ?? [])
                void (async () => {
                  for (const file of files) {
                    try {
                      const src = await fileToOptimizedDataUrl(file)
                      ;(props.editor as any)!.chain().focus().insertContent({
                        type: 'imageBlock',
                        attrs: { src, width: 300 },
                      }).run()
                    } catch (err) {
                      const message = err instanceof Error ? err.message : '이미지를 삽입할 수 없습니다.'
                      alert(message)
                    }
                  }
                })()
              }
              input.click()
            }}
          >
            🖼 이미지
          </button>

          <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Columns */}
          <button class="btn" onClick={() => (props.editor as any)!.chain().focus().setColumns(2).run()}>
            ▐▐ 2열
          </button>
          <button class="btn" onClick={() => (props.editor as any)!.chain().focus().setColumns(3).run()}>
            ▐▐▐ 3열
          </button>

          <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Table */}
          <button class="btn" onClick={() => props.editor!.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()}>
            ▦ 표
          </button>
          {tableActive() && <>
            <button class="btn" onClick={() => props.editor!.chain().focus().addRowBefore().run()} title="위에 행 추가">↑+행</button>
            <button class="btn" onClick={() => props.editor!.chain().focus().addRowAfter().run()} title="아래에 행 추가">↓+행</button>
            <button class="btn" onClick={() => props.editor!.chain().focus().addColumnBefore().run()} title="왼쪽에 열 추가">←+열</button>
            <button class="btn" onClick={() => props.editor!.chain().focus().addColumnAfter().run()} title="오른쪽에 열 추가">→+열</button>
            <div class="relative">
              <button class="btn" onClick={() => { setShowCellColor(!showCellColor()) }} title="셀 색상">🎨셀색</button>
              <Show when={showCellColor()}>
                <div class="color-dropdown">
                  <For each={BG_COLORS}>
                    {(c) => (
                      <button
                        class="color-dropdown-item"
                        onClick={() => {
                          if (c.color === '') {
                            props.editor!.chain().focus().setCellAttribute('backgroundColor', '').run()
                          } else {
                            props.editor!.chain().focus().setCellAttribute('backgroundColor', c.color).run()
                          }
                          setShowCellColor(false)
                        }}
                      >
                        <span class="color-dot" style={c.color === '' ? 'background:white;border:1px dashed #d1d5db;' : `background:${c.color};${c.border ? 'border:1px solid #d1d5db;' : ''}`} />
                        <span>{c.name}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
            <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />
            <button class="btn" onClick={() => {
              const ed = props.editor!
              const { state } = ed
              const sel = state.selection as any
              if (!sel.$anchorCell) return
              const { $from } = state.selection
              let tableNode: any = null, tableStart = 0
              for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type.name === 'table') {
                  tableNode = $from.node(d)
                  tableStart = $from.start(d) - 1
                  break
                }
              }
              if (!tableNode) return

              // $anchorCell.pos, $headCell.pos로 선택된 열 범위 결정
              const anchorPos = sel.$anchorCell.pos
              const headPos = sel.$headCell.pos
              let anchorCol = -1, headCol = -1
              let off = tableStart + 1
              for (let r = 0; r < tableNode.childCount; r++) {
                const row = tableNode.child(r)
                off += 1
                for (let c = 0; c < row.childCount; c++) {
                  if (off === anchorPos) anchorCol = c
                  if (off === headPos) headCol = c
                  off += row.child(c).nodeSize
                }
                off += 1
              }
              if (anchorCol < 0 || headCol < 0) return
              const minCol = Math.min(anchorCol, headCol)
              const maxCol = Math.max(anchorCol, headCol)
              const numCols = maxCol - minCol + 1

              // 첫 번째 행 DOM에서 선택된 열들의 너비 합산
              let totalWidth = 0
              off = tableStart + 1 + 1 // 첫 번째 행 진입 (첫 번째 셀 위치)
              const firstRow = tableNode.child(0)
              for (let c = 0; c < firstRow.childCount; c++) {
                if (c >= minCol && c <= maxCol) {
                  const dom = ed.view.nodeDOM(off) as HTMLElement | null
                  if (dom) totalWidth += dom.offsetWidth
                }
                off += firstRow.child(c).nodeSize
              }
              if (totalWidth === 0) return
              const equalW = Math.round(totalWidth / numCols)

              // 모든 행의 해당 열에 colwidth 적용
              const { tr } = state
              off = tableStart + 1
              for (let r = 0; r < tableNode.childCount; r++) {
                const row = tableNode.child(r)
                off += 1
                for (let c = 0; c < row.childCount; c++) {
                  const cell = row.child(c)
                  if (c >= minCol && c <= maxCol) {
                    tr.setNodeMarkup(off, undefined, { ...cell.attrs, colwidth: [equalW] })
                  }
                  off += cell.nodeSize
                }
                off += 1
              }
              ed.view.dispatch(tr)
            }} title="셀 너비 같게">⇔너비</button>
            <button class="btn" onClick={() => {
              const ed = props.editor!
              const { state } = ed
              const sel = state.selection as any
              if (!sel.$anchorCell) return
              const { $from } = state.selection
              let tableNode: any = null, tableStart = 0
              for (let d = $from.depth; d >= 0; d--) {
                if ($from.node(d).type.name === 'table') {
                  tableNode = $from.node(d)
                  tableStart = $from.start(d) - 1
                  break
                }
              }
              if (!tableNode) return

              // $anchorCell.pos, $headCell.pos로 선택된 행 범위 결정
              const anchorPos = sel.$anchorCell.pos
              const headPos = sel.$headCell.pos
              let anchorRow = -1, headRow = -1
              let off = tableStart + 1
              for (let r = 0; r < tableNode.childCount; r++) {
                const row = tableNode.child(r)
                off += 1
                for (let c = 0; c < row.childCount; c++) {
                  if (off === anchorPos) anchorRow = r
                  if (off === headPos) headRow = r
                  off += row.child(c).nodeSize
                }
                off += 1
              }
              if (anchorRow < 0 || headRow < 0) return
              const minRow = Math.min(anchorRow, headRow)
              const maxRow = Math.max(anchorRow, headRow)
              const numRows = maxRow - minRow + 1

              // 선택된 행들의 DOM 높이 합산
              let totalHeight = 0
              off = tableStart + 1
              for (let r = 0; r < tableNode.childCount; r++) {
                if (r >= minRow && r <= maxRow) {
                  const dom = ed.view.nodeDOM(off) as HTMLElement | null
                  if (dom) totalHeight += dom.offsetHeight
                }
                off += tableNode.child(r).nodeSize
              }
              if (totalHeight === 0) return
              const equalH = Math.round(totalHeight / numRows)

              // 선택된 행의 모든 셀에 rowHeight 적용
              const { tr } = state
              off = tableStart + 1
              for (let r = 0; r < tableNode.childCount; r++) {
                const row = tableNode.child(r)
                off += 1
                for (let c = 0; c < row.childCount; c++) {
                  const cell = row.child(c)
                  if (r >= minRow && r <= maxRow) {
                    tr.setNodeMarkup(off, undefined, { ...cell.attrs, rowHeight: equalH })
                  }
                  off += cell.nodeSize
                }
                off += 1
              }
              ed.view.dispatch(tr)
            }} title="셀 높이 같게">⇕높이</button>
          </>}

          <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Action Button */}
          <button class="btn" onClick={() => props.editor!.chain().focus().insertActionButton().run()}>
            ⚡ 버튼
          </button>

          {/* Sub-page insert */}
          <Show when={props.pageId && props.onCreateSubPage}>
            <button class="btn" onClick={async () => {
              const pageId = props.pageId
              if (!pageId || !props.onCreateSubPage) return
              const sub = await props.onCreateSubPage(pageId)
              if (sub) {
                props.editor!.chain().focus().insertContent({
                  type: 'text',
                  text: `📄 ${sub.title}`,
                  marks: [{ type: 'link', attrs: { href: `#${sub.id}`, target: null } }],
                }).run()
              }
            }}>
              📄+ 서브페이지
            </button>
          </Show>
        </Show>
      </div>
    </Show>
  )
}

export default Toolbar
