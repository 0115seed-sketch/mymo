import { For, Show, createSignal, createMemo, createEffect } from 'solid-js'
import type { Component } from 'solid-js'
import type { Page } from '../db'
import { darkMode } from '../stores/settings'

interface SidebarProps {
  rootPages: Page[]
  subPages: (parentPageId: string) => Page[]
  trashedPages: Page[]
  currentPageId: string | null
  showTrash: boolean
  pageById: (id: string) => Page | null
  ancestorIds: (pageId: string) => string[]
  onSelectPage: (id: string) => void
  onCreatePage: (parentPageId?: string | null) => void
  onTrashPage: (id: string) => void
  onRestorePage: (id: string) => void
  onDeletePage: (id: string) => void
  onEmptyTrash: () => void
  onToggleTrash: () => void
  onHideSidebar: () => void
  onReorderPage: (pageId: string, newIndex: number, parentPageId: string | null) => void
  onMovePageToParent: (pageId: string, newParentPageId: string | null) => void
}

const Sidebar: Component<SidebarProps> = (props) => {
  const [expandedPages, setExpandedPages] = createSignal<Set<string>>(new Set<string>())
  const [searchQuery, setSearchQuery] = createSignal('')
  const [draggedPageId, setDraggedPageId] = createSignal<string | null>(null)
  const [dropIndicator, setDropIndicator] = createSignal<{ parentPageId: string | null; index: number } | null>(null)
  const [dropAsChild, setDropAsChild] = createSignal<string | null>(null)
  const forcedExpandedAncestors = createMemo(() => {
    const pageId = props.currentPageId
    if (!pageId) return new Set<string>()
    return new Set<string>([...props.ancestorIds(pageId), pageId])
  })

  const togglePage = (id: string) => {
    const next = new Set<string>(expandedPages())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedPages(next)
  }

  const collapseAll = () => {
    setExpandedPages(new Set<string>())
  }

  // currentPageId 변경 시 조상 경로 자동 펼침
  createEffect(() => {
    const pageId = props.currentPageId
    if (!pageId) return
    props.pageById(pageId)
    const ancestors = props.ancestorIds(pageId)
    const next = new Set<string>(expandedPages())
    next.add(pageId)
    for (const aid of ancestors) next.add(aid)
    setExpandedPages(next)
  })

  const allActivePages = () => {
    const collect = (pages: Page[]): Page[] => {
      const result: Page[] = []
      for (const p of pages) {
        result.push(p)
        result.push(...collect(props.subPages(p.id)))
      }
      return result
    }
    return collect(props.rootPages)
  }

  // JSON content에서 텍스트 추출
  const extractText = (content: string): string => {
    if (!content) return ''
    try {
      const doc = JSON.parse(content)
      const texts: string[] = []
      const walk = (node: any) => {
        if (node.text) texts.push(node.text)
        if (node.content) node.content.forEach(walk)
      }
      walk(doc)
      return texts.join(' ')
    } catch { return '' }
  }

  const filteredPages = createMemo(() => {
    const q = searchQuery().trim().toLowerCase()
    if (!q) return null
    return allActivePages().filter(p => {
      const titleMatch = (p.title || '').toLowerCase().includes(q)
      if (titleMatch) return true
      const textContent = extractText(p.content)
      return textContent.toLowerCase().includes(q)
    })
  })

  const PageItem = (p: { page: Page; depth?: number; index: number; parentPageId: string | null }) => {
    const children = () => props.subPages(p.page.id)
    const hasChildren = () => children().length > 0
    const isExpanded = () => expandedPages().has(p.page.id) || forcedExpandedAncestors().has(p.page.id)
    const depth = p.depth ?? 0

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer!.dropEffect = 'move'
      if (!draggedPageId() || draggedPageId() === p.page.id) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const y = e.clientY - rect.top
      const h = rect.height
      if (y < h * 0.25) {
        setDropIndicator({ parentPageId: p.parentPageId, index: p.index })
        setDropAsChild(null)
      } else if (y > h * 0.75) {
        setDropIndicator({ parentPageId: p.parentPageId, index: p.index + 1 })
        setDropAsChild(null)
      } else {
        setDropIndicator(null)
        setDropAsChild(p.page.id)
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const pageId = draggedPageId()
      if (!pageId) return
      const asChild = dropAsChild()
      const indicator = dropIndicator()
      if (asChild && asChild !== pageId) {
        props.onMovePageToParent(pageId, asChild)
        if (!expandedPages().has(asChild)) togglePage(asChild)
      } else if (indicator) {
        const draggedPage = props.pageById(pageId)
        if (draggedPage && draggedPage.parentPageId !== indicator.parentPageId) {
          props.onMovePageToParent(pageId, indicator.parentPageId)
        }
        props.onReorderPage(pageId, indicator.index, indicator.parentPageId)
      }
      setDraggedPageId(null)
      setDropIndicator(null)
      setDropAsChild(null)
    }

    const isDropBefore = () => {
      const ind = dropIndicator()
      return ind && ind.parentPageId === p.parentPageId && ind.index === p.index && !!draggedPageId()
    }
    const isDropAfter = () => {
      const ind = dropIndicator()
      return ind && ind.parentPageId === p.parentPageId && ind.index === p.index + 1 && !!draggedPageId()
    }
    const isDropOnto = () => dropAsChild() === p.page.id && !!draggedPageId()

    const itemClass = () => {
      if (isDropOnto()) return 'bg-blue-100 dark:bg-blue-900/40'
      if (props.currentPageId === p.page.id) return darkMode() ? 'bg-gray-700 font-medium' : 'bg-gray-200 font-medium'
      return darkMode() ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
    }
    const arrowClass = () => darkMode() ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'

    return (
      <>
        <Show when={isDropBefore()}>
          <div class="h-0.5 mx-2 bg-blue-500 rounded" />
        </Show>
        <div
          class={"group flex items-center py-1.5 mx-1 rounded cursor-pointer text-sm transition-colors " + itemClass()}
          style={{ "padding-left": (12 + depth * 16) + "px", "padding-right": "12px" }}
          onClick={() => props.onSelectPage(p.page.id)}
          draggable={true}
          onDragStart={(e) => {
            e.stopPropagation()
            setDraggedPageId(p.page.id)
            e.dataTransfer!.effectAllowed = 'move'
          }}
          onDragEnd={() => { setDraggedPageId(null); setDropIndicator(null); setDropAsChild(null) }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <Show when={hasChildren()}>
            <span
              class={"mr-1 text-xs select-none " + arrowClass()}
              onClick={(e) => { e.stopPropagation(); togglePage(p.page.id) }}
            >{isExpanded() ? '\u25BC' : '\u25B6'}</span>
          </Show>
          <Show when={!hasChildren()}>
            <span class="mr-1 text-xs select-none text-transparent">{'\u25B6'}</span>
          </Show>
          <span class="flex-1 truncate">{p.page.title || '\uC81C\uBAA9 \uC5C6\uC74C'}</span>
          <button
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 ml-1 text-xs transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              props.onCreatePage(p.page.id)
              if (!isExpanded()) togglePage(p.page.id)
            }}
            title="서브페이지 추가"
          >+</button>
          <button
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-0.5 text-xs transition-opacity"
            onClick={(e) => { e.stopPropagation(); props.onTrashPage(p.page.id) }}
            title="삭제"
          >{'\u2715'}</button>
        </div>
        <Show when={isExpanded()}>
          <For each={children()}>
            {(child, i) => <PageItem page={child} depth={depth + 1} index={i()} parentPageId={p.page.id} />}
          </For>
        </Show>
        <Show when={isDropAfter()}>
          <div class="h-0.5 mx-2 bg-blue-500 rounded" />
        </Show>
      </>
    )
  }

  const trashItemClass = () => darkMode() ? 'hover:bg-gray-700' : 'hover:bg-gray-100'

  const TrashPageItem = (p: { page: Page }) => (
    <div
      class={"group flex items-center py-1.5 px-3 mx-1 rounded cursor-pointer text-sm transition-colors " + trashItemClass()}
      onClick={() => props.onSelectPage(p.page.id)}
    >
      <span class="flex-1 truncate">{p.page.title || '\uC81C\uBAA9 \uC5C6\uC74C'}</span>
      <button
        class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-green-600 ml-1 text-xs transition-opacity"
        onClick={(e) => { e.stopPropagation(); props.onRestorePage(p.page.id) }}
        title="복원"
      >{'\u21A9'}</button>
      <button
        class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-0.5 text-xs transition-opacity"
        onClick={(e) => { e.stopPropagation(); props.onDeletePage(p.page.id) }}
        title="완전 삭제"
      >{'\u2715'}</button>
    </div>
  )

  const handleRootDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
  }
  const handleRootDrop = (e: DragEvent) => {
    e.preventDefault()
    const pageId = draggedPageId()
    if (pageId) {
      props.onMovePageToParent(pageId, null)
      setDraggedPageId(null)
      setDropIndicator(null)
      setDropAsChild(null)
    }
  }

  const sidebarClass = () => "w-60 h-screen border-r flex flex-col flex-shrink-0 " + (darkMode() ? 'bg-[#1e1f36] border-gray-700' : 'bg-gray-50 border-gray-200')
  const headerClass = () => "p-3 border-b flex items-center justify-between " + (darkMode() ? 'border-gray-700' : 'border-gray-200')
  const searchInputClass = () => "w-full text-sm rounded px-2 py-1 outline-none border " + (darkMode() ? 'bg-gray-800 border-gray-600 text-gray-200 placeholder-gray-500' : 'bg-white border-gray-300 placeholder-gray-400')
  const emptyClass = () => "px-3 py-4 text-sm text-center " + (darkMode() ? 'text-gray-500' : 'text-gray-400')
  const trashBorderClass = () => "border-t " + (darkMode() ? 'border-gray-700' : 'border-gray-200')
  const trashRowClass = () => "flex items-center px-3 py-2 cursor-pointer text-sm transition-colors " + (darkMode() ? 'hover:bg-gray-700' : 'hover:bg-gray-100')
  const trashCountClass = () => "text-xs mr-1 " + (darkMode() ? 'text-gray-500' : 'text-gray-400')
  const trashEmptyClass = () => "px-3 py-2 text-xs text-center " + (darkMode() ? 'text-gray-500' : 'text-gray-400')
  const searchResultClass = (pageId: string) =>
    "group flex items-center py-1.5 px-3 mx-1 rounded cursor-pointer text-sm transition-colors " +
    (props.currentPageId === pageId
      ? (darkMode() ? 'bg-gray-700 font-medium' : 'bg-gray-200 font-medium')
      : (darkMode() ? 'hover:bg-gray-700' : 'hover:bg-gray-100'))

  return (
    <div class={sidebarClass()}>
      <div class={headerClass()}>
        <span class="font-bold text-base cursor-pointer" onClick={collapseAll} title="모두 접기">mymo</span>
        <div class="flex gap-1">
          <button
            class="btn text-lg leading-none"
            onClick={() => props.onCreatePage()}
            title="새 페이지"
          >+</button>
          <button
            class="btn text-xs"
            onClick={() => props.onHideSidebar()}
            title="사이드바 숨기기"
          >{'\u25C0'}</button>
        </div>
      </div>

      <div class="px-2 py-1.5">
        <input
          type="text"
          placeholder="페이지 검색..."
          class={searchInputClass()}
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.currentTarget.value)}
        />
      </div>

      <div
        class="flex-1 overflow-y-auto py-1"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        <Show when={filteredPages()} fallback={
          <>
            <For each={props.rootPages}>
              {(page, i) => <PageItem page={page} index={i()} parentPageId={null} />}
            </For>
            <Show when={props.rootPages.length === 0}>
              <div class={emptyClass()}>
                페이지가 없습니다
              </div>
            </Show>
          </>
        }>
          {(pages) => (
            <>
              <For each={pages()}>
                {(page) => (
                  <div
                    class={searchResultClass(page.id)}
                    onClick={() => props.onSelectPage(page.id)}
                  >
                    <span class="flex-1 truncate">{page.title || '\uC81C\uBAA9 \uC5C6\uC74C'}</span>
                  </div>
                )}
              </For>
              <Show when={pages().length === 0}>
                <div class={emptyClass()}>
                  검색 결과 없음
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>

      <div class={trashBorderClass()}>
        <div
          class={trashRowClass()}
          onClick={() => props.onToggleTrash()}
        >
          <span class="mr-1.5">{'\uD83D\uDDD1\uFE0F'}</span>
          <span class="flex-1">휴지통</span>
          <Show when={props.trashedPages.length > 0}>
            <span class={trashCountClass()}>{props.trashedPages.length}</span>
          </Show>
          <span class="text-xs">{props.showTrash ? '\u25BC' : '\u25B6'}</span>
        </div>
        <Show when={props.showTrash}>
          <div class="max-h-40 overflow-y-auto">
            <For each={props.trashedPages}>
              {(page) => <TrashPageItem page={page} />}
            </For>
            <Show when={props.trashedPages.length === 0}>
              <div class={trashEmptyClass()}>비어있음</div>
            </Show>
            <Show when={props.trashedPages.length > 0}>
              <button
                class="w-full text-xs text-red-400 hover:text-red-600 py-1 transition-colors"
                onClick={() => props.onEmptyTrash()}
              >
                휴지통 비우기
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

export default Sidebar