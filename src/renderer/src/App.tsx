import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import Editor from './components/Editor'
import SourceEditor from './components/SourceEditor'
import Welcome from './components/Welcome'
import StatusBar from './components/StatusBar'
import Settings from './components/Settings'
import type { AppSettings, Folder, Tab } from './types'

let tabSeq = 0
const newTabId = (): string => `tab-${Date.now()}-${tabSeq++}`

/** 取路径所在目录 */
function dirOf(path: string | null): string | null {
  if (!path) return null
  const i = path.lastIndexOf('/')
  if (i < 0) return null
  return i === 0 ? '/' : path.slice(0, i)
}

const DEFAULT_SETTINGS: AppSettings = {
  attachmentMode: 'subfolder',
  attachmentFolder: 'assets',
  imageMaxWidth: 800
}

export default function App(): JSX.Element {
  const [folder, setFolder] = useState<Folder | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [sourceMode, setSourceMode] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [showSettings, setShowSettings] = useState(false)

  const activeTab = tabs.find((t) => t.id === activeId) ?? null
  // 当前文档目录：已保存文件用其所在目录，未保存则退回已打开的文件夹根目录
  const activeDocDir = activeTab ? (dirOf(activeTab.path) ?? folder?.root ?? null) : null

  // 启动时加载设置
  useEffect(() => {
    if (window.api) window.api.getSettings().then(setSettings)
  }, [])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await window.api.setSettings(patch)
    setSettings(next)
  }, [])

  // 用 ref 保存最新状态，供原生菜单回调读取，避免闭包陈旧
  const stateRef = useRef({ tabs, activeId })
  stateRef.current = { tabs, activeId }

  // ---- 打开 ----
  const openFolder = useCallback(async () => {
    const result = await window.api.openFolder()
    if (result) setFolder(result)
  }, [])

  const openPath = useCallback(async (path: string, name: string) => {
    // 若已打开则切换
    const existing = stateRef.current.tabs.find((t) => t.path === path)
    if (existing) {
      setActiveId(existing.id)
      return
    }
    const file = await window.api.readFile(path)
    const tab: Tab = {
      id: newTabId(),
      path: file.path,
      name: name || file.name,
      content: file.content,
      dirty: false
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [])

  const openFile = useCallback(async () => {
    const file = await window.api.openFile()
    if (!file) return
    const existing = stateRef.current.tabs.find((t) => t.path === file.path)
    if (existing) {
      setActiveId(existing.id)
      return
    }
    const tab: Tab = {
      id: newTabId(),
      path: file.path,
      name: file.name,
      content: file.content,
      dirty: false
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [])

  const newFile = useCallback(() => {
    const tab: Tab = {
      id: newTabId(),
      path: null,
      name: '未命名.md',
      content: '',
      dirty: false
    }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [])

  // ---- 编辑/保存 ----
  const updateContent = useCallback((id: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, content, dirty: t.content !== content ? true : t.dirty } : t
      )
    )
  }, [])

  const saveTab = useCallback(async (id: string) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.path) {
      await window.api.writeFile(tab.path, tab.content)
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, dirty: false } : t)))
    } else {
      const result = await window.api.saveAs(tab.content, tab.name)
      if (result) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, path: result.path, name: result.name, dirty: false } : t
          )
        )
      }
    }
  }, [])

  const saveAsTab = useCallback(async (id: string) => {
    const tab = stateRef.current.tabs.find((t) => t.id === id)
    if (!tab) return
    const result = await window.api.saveAs(tab.content, tab.name)
    if (result) {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, path: result.path, name: result.name, dirty: false } : t
        )
      )
    }
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      // 关闭活动页时切换到相邻标签
      setActiveId((curr) => {
        if (curr !== id) return curr
        if (next.length === 0) return null
        return next[Math.min(idx, next.length - 1)].id
      })
      return next
    })
  }, [])

  // ---- 原生菜单动作绑定 ----
  useEffect(() => {
    // preload 未就绪时降级，避免整页崩溃
    if (!window.api) {
      console.error('window.api 不可用：preload 脚本未加载')
      return
    }
    const dispose = window.api.onMenuAction((action) => {
      switch (action) {
        case 'new-file':
          newFile()
          break
        case 'open-file':
          openFile()
          break
        case 'open-folder':
          openFolder()
          break
        case 'save':
          if (stateRef.current.activeId) saveTab(stateRef.current.activeId)
          break
        case 'save-as':
          if (stateRef.current.activeId) saveAsTab(stateRef.current.activeId)
          break
        case 'toggle-sidebar':
          setSidebarVisible((v) => !v)
          break
        case 'toggle-source':
          setSourceMode((v) => !v)
          break
      }
    })
    return dispose
  }, [newFile, openFile, openFolder, saveTab, saveAsTab])

  return (
    <div className="app">
      {sidebarVisible && (
        <Sidebar
          folder={folder}
          activePath={activeTab?.path ?? null}
          onOpenFolder={openFolder}
          onOpenFile={openPath}
          onOpenSettings={() => setShowSettings(true)}
          onRefresh={async () => {
            if (folder) {
              const tree = await window.api.readDir(folder.root)
              setFolder({ ...folder, tree })
            }
          }}
        />
      )}

      <div className="main">
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          sourceMode={sourceMode}
          onToggleSource={() => setSourceMode((v) => !v)}
          onToggleSidebar={() => setSidebarVisible((v) => !v)}
        />

        <div className="editor-area">
          {activeTab ? (
            sourceMode ? (
              <SourceEditor
                key={activeTab.id + '-src'}
                content={activeTab.content}
                onChange={(c) => updateContent(activeTab.id, c)}
              />
            ) : (
              <Editor
                key={activeTab.id}
                content={activeTab.content}
                docDir={activeDocDir}
                imageMaxWidth={settings.imageMaxWidth}
                onChange={(c) => updateContent(activeTab.id, c)}
              />
            )
          ) : (
            <Welcome onOpenFolder={openFolder} onOpenFile={openFile} onNewFile={newFile} />
          )}
        </div>

        <StatusBar tab={activeTab} sourceMode={sourceMode} />
      </div>

      {showSettings && (
        <Settings
          settings={settings}
          onChange={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
