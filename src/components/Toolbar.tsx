import { Show, createSignal, For } from 'solid-js'
import type { Component } from 'solid-js'
import type { Editor } from '@tiptap/core'
import EmojiPicker from './EmojiPicker'
import { darkMode } from '../stores/settings'

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

          {/* Link */}
          <button
            class={isActive('link')}
            onClick={() => {
              if (props.editor!.isActive('link')) {
                props.editor!.chain().focus().unsetLink().run()
              } else {
                const url = window.prompt('URL을 입력하세요:')
                if (url) {
                  props.editor!.chain().focus().setLink({ href: url }).run()
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
              const { $from } = state.selection
              for (let d = $from.depth; d >= 0; d--) {
                const node = $from.node(d)
                if (node.type.name === 'table') {
                  const tableStart = $from.start(d) - 1
                  const tableDom = ed.view.nodeDOM(tableStart) as HTMLElement | null
                  const tableWrapper = tableDom?.closest('.tableWrapper') as HTMLElement | null
                  const tableEl = tableWrapper?.querySelector('table') || tableDom
                  const tableWidth = tableEl?.getBoundingClientRect().width || 600
                  const firstRow = node.child(0)
                  const colCount = firstRow.childCount
                  const equalWidth = Math.round(tableWidth / colCount)
                  const { tr } = state
                  let offset = 1
                  for (let r = 0; r < node.childCount; r++) {
                    const row = node.child(r)
                    offset += 1
                    for (let c = 0; c < row.childCount; c++) {
                      const cell = row.child(c)
                      tr.setNodeMarkup(tableStart + offset, undefined, {
                        ...cell.attrs,
                        colwidth: [equalWidth],
                      })
                      offset += cell.nodeSize
                    }
                    offset += 1
                  }
                  ed.view.dispatch(tr)
                  break
                }
              }
            }} title="셀 너비 같게">⇔너비</button>
            <button class="btn" onClick={() => {
              const ed = props.editor!
              const { state } = ed
              const { $from } = state.selection
              for (let d = $from.depth; d >= 0; d--) {
                const node = $from.node(d)
                if (node.type.name === 'table') {
                  const tableStart = $from.start(d) - 1
                  const tableDom = ed.view.nodeDOM(tableStart) as HTMLElement | null
                  const tableEl = tableDom?.querySelector('table') || tableDom?.closest('table') || tableDom
                  if (!tableEl) break

                  // 선택된 행 인덱스를 구함 (CellSelection이면 선택된 셀의 행만, 아니면 전체)
                  const sel = state.selection as any
                  const selectedRowIndices = new Set<number>()

                  if (sel.constructor.name === 'CellSelection' && sel.ranges) {
                    // CellSelection: 선택된 셀이 속한 행만
                    let offset = tableStart + 1
                    for (let r = 0; r < node.childCount; r++) {
                      const row = node.child(r)
                      offset += 1
                      for (let c = 0; c < row.childCount; c++) {
                        const cellNode = row.child(c)
                        const cellStart = offset
                        for (const range of sel.ranges) {
                          if (range.$from.pos >= cellStart && range.$from.pos < cellStart + cellNode.nodeSize) {
                            selectedRowIndices.add(r)
                            break
                          }
                        }
                        offset += cellNode.nodeSize
                      }
                      offset += 1
                    }
                  } else {
                    // 일반 커서: 전체 행
                    for (let r = 0; r < node.childCount; r++) selectedRowIndices.add(r)
                  }

                  if (selectedRowIndices.size === 0) break

                  // 선택된 행들의 총 높이를 구해서 균등 분배
                  const rowEls = (tableEl as HTMLElement).querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')
                  let totalSelectedHeight = 0
                  selectedRowIndices.forEach(r => {
                    const rowEl = rowEls[r]
                    if (rowEl) totalSelectedHeight += (rowEl as HTMLElement).offsetHeight
                  })
                  const equalHeight = Math.round(totalSelectedHeight / selectedRowIndices.size)

                  const { tr } = state
                  let offset = 1
                  for (let r = 0; r < node.childCount; r++) {
                    const row = node.child(r)
                    offset += 1
                    if (selectedRowIndices.has(r)) {
                      for (let c = 0; c < row.childCount; c++) {
                        const cell = row.child(c)
                        tr.setNodeMarkup(tableStart + offset, undefined, {
                          ...cell.attrs,
                          rowHeight: equalHeight,
                        })
                        offset += cell.nodeSize
                      }
                    } else {
                      for (let c = 0; c < row.childCount; c++) {
                        offset += row.child(c).nodeSize
                      }
                    }
                    offset += 1
                  }
                  ed.view.dispatch(tr)
                  break
                }
              }
            }} title="셀 높이 같게">⇕높이</button>
          </>}

          <div class="w-px h-5 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Action Button */}
          <button class="btn" onClick={() => props.editor!.chain().focus().insertActionButton().run()}>
            ⚡ 버튼
          </button>
        </Show>
      </div>
    </Show>
  )
}

export default Toolbar
