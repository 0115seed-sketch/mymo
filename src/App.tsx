import { onMount, onCleanup, Show, createSignal, createEffect } from 'solid-js'
import { createPageStore } from './stores/pages'
import { user, authLoading, loginWithGoogle, logout } from './stores/auth'
import { pullFromCloud, startRealtimeSync, stopRealtimeSync } from './stores/sync'
import { darkMode } from './stores/settings'
import Sidebar from './components/Sidebar'
import EditorView from './components/EditorView'
import SettingsModal from './components/SettingsModal'

function App() {
  const store = createPageStore()
  const [sidebarVisible, setSidebarVisible] = createSignal(true)
  const [showSettings, setShowSettings] = createSignal(false)

  onMount(async () => {
    await store.loadAll()
    if (store.activePages().length === 0) {
      await store.createPage('주간 할일')
    }
  })

  // 로그인 상태 변화 감지 → 클라우드 동기화 시작/종료
  let prevUid: string | null = null
  createEffect(async () => {
    const u = user()
    if (u && u.uid !== prevUid) {
      prevUid = u.uid
      // 로그인: 클라우드 데이터 가져온 뒤 실시간 구독 시작
      await pullFromCloud(u.uid)
      await store.loadAll()
      startRealtimeSync(u.uid, () => store.loadAll())
    } else if (!u && prevUid) {
      prevUid = null
      stopRealtimeSync()
    }
  })
  onCleanup(() => { stopRealtimeSync() })

  return (
    <div class={`flex h-screen overflow-hidden ${darkMode() ? 'bg-[#1a1b2e] text-gray-200' : 'bg-white text-gray-900'}`}>
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
          onMovePageToFolder={(pageId: string, folderId: string | null) => store.movePageToFolder(pageId, folderId)}
          onReorderPage={(pageId: string, newIndex: number, folderId: string | null) => store.reorderPage(pageId, newIndex, folderId)}
        />
      </Show>

      {/* Sidebar show button when hidden */}
      <Show when={!sidebarVisible()}>
        <button
          class={`absolute top-3 left-3 z-50 border rounded px-2 py-1 text-sm cursor-pointer transition-colors ${darkMode() ? 'bg-gray-800 hover:bg-gray-700 border-gray-600 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 border-gray-300'}`}
          onClick={() => setSidebarVisible(true)}
          title="사이드바 표시"
        >▶</button>
      </Show>

      {/* 로그인/로그아웃 버튼 */}
      <Show when={!authLoading()}>
        <div class="absolute top-2 right-3 z-50 flex items-center gap-2">
          {/* 설정 버튼 */}
          <button
            class={`cursor-pointer border rounded-lg px-2 py-1.5 text-xs transition-colors shadow-sm ${darkMode() ? 'bg-gray-800 border-gray-600 hover:bg-gray-700 text-gray-300' : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'}`}
            onClick={() => setShowSettings(true)}
            title="설정"
          >⚙️</button>
          <Show
            when={user()}
            fallback={
              <button
                class={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-xs cursor-pointer shadow-sm transition-colors ${darkMode() ? 'bg-gray-800 border-gray-600 hover:bg-gray-700 text-gray-300' : 'bg-white border-gray-300 hover:bg-gray-50 text-gray-700'}`}
                onClick={loginWithGoogle}
                title="Google로 동기화 로그인"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                로그인
              </button>
            }
          >
            {(u) => (
              <div class="flex items-center gap-2">
                <span class={`text-xs hidden sm:inline ${darkMode() ? 'text-gray-400' : 'text-gray-500'}`}>{u().displayName}</span>
                <img
                  src={u().photoURL ?? ''}
                  alt="프로필"
                  class={`w-6 h-6 rounded-full border ${darkMode() ? 'border-gray-600' : 'border-gray-200'}`}
                  title={u().email ?? ''}
                />
                <button
                  class={`text-xs cursor-pointer transition-colors ${darkMode() ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
                  onClick={logout}
                  title="로그아웃"
                >로그아웃</button>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <Show
        when={store.currentPage()}
        fallback={
          <div class={`flex-1 flex items-center justify-center ${darkMode() ? 'text-gray-500' : 'text-gray-400'}`}>
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

      <SettingsModal open={showSettings()} onClose={() => setShowSettings(false)} />
    </div>
  )
}

export default App
