import { For, Show, createSignal } from 'solid-js'
import type { Component } from 'solid-js'
import type { Page, Folder } from '../db'
import { darkMode } from '../stores/settings'

interface SidebarProps {
  folders: Folder[]
  rootPages: Page[]
  pagesInFolder: (folderId: string) => Page[]
  subPages: (parentPageId: string) => Page[]
  trashedPages: Page[]
  currentPageId: string | null
  showTrash: boolean
  onSelectPage: (id: string) => void
  onCreatePage: (folderId?: string | null) => void
  onCreateSubPage: (parentPageId: string) => void
  onTrashPage: (id: string) => void
  onRestorePage: (id: string) => void
  onDeletePage: (id: string) => void
  onEmptyTrash: () => void
  onCreateFolder: () => void
  onRenameFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
  onToggleTrash: () => void
  onHideSidebar: () => void
  onMovePageToFolder: (pageId: string, folderId: string | null) => void
  onReorderPage: (pageId: string, newIndex: number, folderId: string | null) => void
}

const Sidebar: Component<SidebarProps> = (props) => {
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())
  const [expandedPages, setExpandedPages] = createSignal<Set<string>>(new Set())
  const [editingFolderId, setEditingFolderId] = createSignal<string | null>(null)
  const [draggedPageId, setDraggedPageId] = createSignal<string | null>(null)
  const [dropTarget, setDropTarget] = createSignal<{ folderId: string | null; index: number } | null>(null)

  const toggleFolder = (id: string) => {
    const next = new Set(expandedFolders())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedFolders(next)
  }

  const togglePage = (id: string) => {
    const next = new Set(expandedPages())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedPages(next)
  }

  const PageItem = (p: { page: Page; isTrash?: boolean; depth?: number; index?: number; folderId?: string | null }) => {
    const children = () => props.subPages(p.page.id)
    const hasChildren = () => children().length > 0
    const isExpanded = () => expandedPages().has(p.page.id)
    const depth = p.depth ?? 0

    const handlePageDragOver = (e: DragEvent) => {
      if (!draggedPageId() || p.isTrash) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer!.dropEffect = 'move'
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const idx = p.index ?? 0
      const newTarget = e.clientY < midY
        ? { folderId: p.folderId ?? null, index: idx }
        : { folderId: p.folderId ?? null, index: idx + 1 }
      setDropTarget(newTarget)
    }

    const handlePageDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const pageId = draggedPageId()
      const dt = dropTarget()
      if (pageId && dt) {
        props.onReorderPage(pageId, dt.index, dt.folderId)
      }
      setDraggedPageId(null)
      setDropTarget(null)
    }

    const isDropBefore = () => {
      const dt = dropTarget()
      return dt && dt.folderId === (p.folderId ?? null) && dt.index === (p.index ?? 0) && !!draggedPageId()
    }

    const isDropAfter = () => {
      const dt = dropTarget()
      return dt && dt.folderId === (p.folderId ?? null) && dt.index === (p.index ?? 0) + 1 && !!draggedPageId()
    }

    return (
      <>
        <Show when={isDropBefore()}>
          <div class="h-0.5 mx-2 bg-blue-500 rounded" />
        </Show>
        <div
          class={`group flex items-center py-1.5 mx-1 rounded cursor-pointer text-sm transition-colors ${
            props.currentPageId === p.page.id
              ? darkMode() ? 'bg-gray-700 font-medium' : 'bg-gray-200 font-medium'
              : darkMode() ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
          }`}
          style={{ "padding-left": `${12 + depth * 16}px`, "padding-right": "12px" }}
          onClick={() => props.onSelectPage(p.page.id)}
          draggable={!p.isTrash}
          onDragStart={(e) => {
            e.stopPropagation()
            setDraggedPageId(p.page.id)
            e.dataTransfer!.effectAllowed = 'move'
          }}
          onDragEnd={() => { setDraggedPageId(null); setDropTarget(null) }}
          onDragOver={handlePageDragOver}
          onDrop={handlePageDrop}
        >
          <Show when={!p.isTrash && hasChildren()}>
            <span
              class={`mr-1 text-xs select-none ${darkMode() ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
              onClick={(e) => { e.stopPropagation(); togglePage(p.page.id) }}
            >{isExpanded() ? '▼' : '▶'}</span>
          </Show>
          <Show when={!p.isTrash && !hasChildren()}>
            <span class="mr-1 text-xs select-none text-transparent">▶</span>
          </Show>
          <span class="flex-1 truncate">{p.page.title || '제목 없음'}</span>
          <Show when={p.isTrash}>
            <button
              class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-green-600 ml-1 text-xs transition-opacity"
              onClick={(e) => { e.stopPropagation(); props.onRestorePage(p.page.id) }}
              title="복원"
            >↩</button>
            <button
              class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-0.5 text-xs transition-opacity"
              onClick={(e) => { e.stopPropagation(); props.onDeletePage(p.page.id) }}
              title="완전 삭제"
            >✕</button>
          </Show>
          <Show when={!p.isTrash}>
            <button
              class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 ml-1 text-xs transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                props.onCreateSubPage(p.page.id)
                if (!isExpanded()) togglePage(p.page.id)
              }}
              title="서브페이지 추가"
            >+</button>
            <button
              class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-0.5 text-xs transition-opacity"
              onClick={(e) => { e.stopPropagation(); props.onTrashPage(p.page.id) }}
              title="삭제"
            >✕</button>
          </Show>
        </div>
        <Show when={!p.isTrash && isExpanded()}>
          <For each={children()}>
            {(child) => <PageItem page={child} depth={depth + 1} />}
          </For>
        </Show>
        <Show when={isDropAfter()}>
          <div class="h-0.5 mx-2 bg-blue-500 rounded" />
        </Show>
      </>
    )
  }

  const FolderItem = (f: { folder: Folder }) => {
    const isExpanded = () => expandedFolders().has(f.folder.id)
    const isEditing = () => editingFolderId() === f.folder.id
    let inputRef!: HTMLInputElement

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'
      ;(e.currentTarget as HTMLElement).classList.add('bg-blue-50')
    }
    const handleDragLeave = (e: DragEvent) => {
      ;(e.currentTarget as HTMLElement).classList.remove('bg-blue-50')
    }
    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).classList.remove('bg-blue-50')
      const pageId = draggedPageId()
      if (pageId) {
        props.onMovePageToFolder(pageId, f.folder.id)
        setDraggedPageId(null)
      }
    }

    return (
      <div>
        <div
          class={`group flex items-center px-3 py-1.5 mx-1 rounded cursor-pointer text-sm transition-colors ${darkMode() ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
          onClick={() => toggleFolder(f.folder.id)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <span class="mr-1 text-xs select-none">{isExpanded() ? '▼' : '▶'}</span>
          <span class="mr-1 text-xs">📁</span>
          <Show when={!isEditing()} fallback={
            <input
              ref={inputRef}
              class={`flex-1 text-sm border rounded px-1 outline-none ${darkMode() ? 'border-blue-500 bg-gray-800 text-gray-200' : 'border-blue-300 bg-white'}`}
              value={f.folder.name}
              onBlur={(e) => {
                props.onRenameFolder(f.folder.id, e.currentTarget.value)
                setEditingFolderId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  props.onRenameFolder(f.folder.id, e.currentTarget.value)
                  setEditingFolderId(null)
                }
                if (e.key === 'Escape') setEditingFolderId(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          }>
            <span class="flex-1 truncate">{f.folder.name}</span>
          </Show>
          <button
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 ml-1 text-xs transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              props.onCreatePage(f.folder.id)
              if (!isExpanded()) toggleFolder(f.folder.id)
            }}
            title="페이지 추가"
          >+</button>
          <button
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 ml-0.5 text-xs transition-opacity"
            onClick={(e) => {
              e.stopPropagation()
              setEditingFolderId(f.folder.id)
              setTimeout(() => inputRef?.focus(), 0)
            }}
            title="이름 변경"
          >✎</button>
          <button
            class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 ml-0.5 text-xs transition-opacity"
            onClick={(e) => { e.stopPropagation(); props.onDeleteFolder(f.folder.id) }}
            title="폴더 삭제"
          >✕</button>
        </div>
        <Show when={isExpanded()}>
          <div class="pl-4">
            <For each={props.pagesInFolder(f.folder.id)}>
              {(page, i) => <PageItem page={page} index={i()} folderId={f.folder.id} />}
            </For>
          </div>
        </Show>
      </div>
    )
  }

  // Root drop zone — move page out of folder
  const handleRootDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer!.dropEffect = 'move'
  }
  const handleRootDrop = (e: DragEvent) => {
    e.preventDefault()
    const pageId = draggedPageId()
    if (pageId) {
      props.onMovePageToFolder(pageId, null)
      setDraggedPageId(null)
    }
  }

  return (
    <div class={`w-60 h-screen border-r flex flex-col flex-shrink-0 ${darkMode() ? 'bg-[#1e1f36] border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
      {/* Header */}
      <div class={`p-3 border-b flex items-center justify-between ${darkMode() ? 'border-gray-700' : 'border-gray-200'}`}>
        <span class="font-bold text-base">mymo</span>
        <div class="flex gap-1">
          <button
            class="btn text-xs"
            onClick={() => props.onCreateFolder()}
            title="새 폴더"
          >📁+</button>
          <button
            class="btn text-lg leading-none"
            onClick={() => props.onCreatePage()}
            title="새 페이지"
          >+</button>
          <button
            class="btn text-xs"
            onClick={() => props.onHideSidebar()}
            title="사이드바 숨기기"
          >◀</button>
        </div>
      </div>

      {/* Folders + Pages */}
      <div
        class="flex-1 overflow-y-auto py-1"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
      >
        {/* Folders */}
        <For each={props.folders}>
          {(folder) => <FolderItem folder={folder} />}
        </For>

        {/* Root pages (no folder) */}
        <For each={props.rootPages}>
          {(page, i) => <PageItem page={page} index={i()} folderId={null} />}
        </For>

        <Show when={props.folders.length === 0 && props.rootPages.length === 0}>
          <div class={`px-3 py-4 text-sm text-center ${darkMode() ? 'text-gray-500' : 'text-gray-400'}`}>
            페이지가 없습니다
          </div>
        </Show>
      </div>

      {/* Trash section */}
      <div class={`border-t ${darkMode() ? 'border-gray-700' : 'border-gray-200'}`}>
        <div
          class={`flex items-center px-3 py-2 cursor-pointer text-sm transition-colors ${darkMode() ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
          onClick={() => props.onToggleTrash()}
        >
          <span class="mr-1.5">🗑️</span>
          <span class="flex-1">휴지통</span>
          <Show when={props.trashedPages.length > 0}>
            <span class={`text-xs mr-1 ${darkMode() ? 'text-gray-500' : 'text-gray-400'}`}>{props.trashedPages.length}</span>
          </Show>
          <span class="text-xs">{props.showTrash ? '▼' : '▶'}</span>
        </div>
        <Show when={props.showTrash}>
          <div class="max-h-40 overflow-y-auto">
            <For each={props.trashedPages}>
              {(page) => <PageItem page={page} isTrash={true} />}
            </For>
            <Show when={props.trashedPages.length === 0}>
              <div class={`px-3 py-2 text-xs text-center ${darkMode() ? 'text-gray-500' : 'text-gray-400'}`}>비어있음</div>
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
