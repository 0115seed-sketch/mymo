import { onMount, Show, createSignal } from 'solid-js'
import { createPageStore } from './stores/pages'
import Sidebar from './components/Sidebar'
import EditorView from './components/EditorView'

function App() {
  const store = createPageStore()
  const [sidebarVisible, setSidebarVisible] = createSignal(true)

  onMount(async () => {
    await store.loadAll()
    if (store.activePages().length === 0) {
      await store.createPage('주간 할일')
    }
  })

  return (
    <div class="flex h-screen bg-white text-gray-900 overflow-hidden">
      <Show when={sidebarVisible()}>
        <Sidebar
          folders={store.folders()}
          rootPages={store.rootPages()}
          pagesInFolder={(fid: string) => store.pagesInFolder(fid)}
          subPages={(pid: string) => store.subPages(pid)}
          trashedPages={store.trashedPages()}
          currentPageId={store.currentPageId()}
          showTrash={store.showTrash()}
          onSelectPage={(id: string) => store.setCurrentPageId(id)}
          onCreatePage={(folderId?: string | null) => store.createPage(undefined, folderId ?? null)}
          onCreateSubPage={(parentPageId: string) => store.createPage('새 페이지', null, parentPageId)}
          onTrashPage={(id: string) => store.trashPage(id)}
          onRestorePage={(id: string) => store.restorePage(id)}
          onDeletePage={(id: string) => store.deletePage(id)}
          onEmptyTrash={() => store.emptyTrash()}
          onCreateFolder={() => store.createFolder()}
          onRenameFolder={(id: string, name: string) => store.renameFolder(id, name)}
          onDeleteFolder={(id: string) => store.deleteFolder(id)}
          onToggleTrash={() => store.setShowTrash(!store.showTrash())}
          onHideSidebar={() => setSidebarVisible(false)}
          onMovePageToFolder={(pageId: string, folderId: string | null) => store.updatePage(pageId, { folderId })}
        />
      </Show>

      {/* Sidebar show button when hidden */}
      <Show when={!sidebarVisible()}>
        <button
          class="absolute top-3 left-3 z-50 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded px-2 py-1 text-sm cursor-pointer transition-colors"
          onClick={() => setSidebarVisible(true)}
          title="사이드바 표시"
        >▶</button>
      </Show>

      <Show
        when={store.currentPage()}
        fallback={
          <div class="flex-1 flex items-center justify-center text-gray-400">
            페이지를 선택하거나 새로 만들어주세요
          </div>
        }
      >
        {(page) => (
          <EditorView
            pageId={page().id}
            content={page().content}
            pageTitle={page().title}
            sidebarVisible={sidebarVisible()}
            onUpdate={(content) => store.updatePage(page().id, { content })}
            onTitleChange={(title) => store.updatePage(page().id, { title })}
          />
        )}
      </Show>
    </div>
  )
}

export default App
