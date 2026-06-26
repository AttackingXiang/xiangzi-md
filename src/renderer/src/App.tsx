import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import Editor from './components/Editor'
import SourceEditor from './components/SourceEditor'
import Welcome from './components/Welcome'
import StatusBar from './components/StatusBar'
import Settings from './components/Settings'
import Outline from './components/Outline'
import FindBar from './components/FindBar'
import { parseOutline } from './lib/outline'
import type { AppSettings, Folder, Tab } from './types'

let tabSeq = 0
const newTabId = (): string => `tab-${Date.now()}-${tabSeq++}`

function dirOf(path: string | null): string | null {
  if (!path) return null
  const i = path.lastIndexOf('/')
  if (i < 0) return null
  return i === 0 ? '/' : path.slice(0, i)
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

const DEFAULT_SETTINGS: AppSettings = {
  attachmentMode: 'subfolder',
  attachmentFolder: 'assets',
  imageMaxWidth: 800,
  theme: 'system',
  autoSave: false,
  recentFiles: [],
  recentFolders: [],
  favorites: []
}

export default function App(): JSX.Element {
  const [folder, setFolder] = useState<Folder | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)

  const activeTab = tabs.find((t) => t.id === activeId) ?? null
  const activeDocDir = activeTab ? (dirOf(activeTab.path) ?? folder?.root ?? null) : null
  const outline = useMemo(
    () => (activeTab ? parseOutline(activeTab.content) : []),
    [activeTab?.content]
  )

  const stateRef = useRef({ tabs, activeId })
  stateRef.current = { tabs, activeId }

  // ---- 设置 ----
  useEffect(() => {
    if (window.api) window.api.getSettings().then(setSettings)
  }, [])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await window.api.setSettings(patch)
    setSettings(next)
  }, [])

  // 历史与收藏（用函数式更新避免陈旧，并异步持久化）
  const pushRecentFile = useCallback((p: string) => {
    setSettings((prev) => {
      const recentFiles = [p, ...prev.recentFiles.filter((x) => x !== p)].slice(0, 15)
      window.api.setSettings({ recentFiles })
      return { ...prev, recentFiles }
    })
  }, [])

  const pushRecentFolder = useCallback((p: string) => {
    setSettings((prev) => {
      const recentFolders = [p, ...prev.recentFolders.filter((x) => x !== p)].slice(0, 15)
      window.api.setSettings({ recentFolders })
      return { ...prev, recentFolders }
    })
  }, [])

  const toggleFavorite = useCallback((p: string) => {
    setSettings((prev) => {
      const has = prev.favorites.includes(p)
      const favorites = has ? prev.favorites.filter((x) => x !== p) : [...prev.favorites, p]
      window.api.setSettings({ favorites })
      return { ...prev, favorites }
    })
  }, [])

  // ---- 主题 ----
  useEffect(() => {
    const apply = (): void => {
      let t: 'light' | 'dark'
      if (settings.theme === 'system') {
        t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      } else {
        t = settings.theme
      }
      document.documentElement.dataset.theme = t
    }
    apply()
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    return undefined
  }, [settings.theme])

  // ---- 打开 ----
  const openFolder = useCallback(async () => {
    const result = await window.api.openFolder()
    if (result) {
      setFolder(result)
      pushRecentFolder(result.root)
    }
  }, [pushRecentFolder])

  const openFolderByPath = useCallback(
    async (root: string) => {
      const result = await window.api.openFolderPath(root)
      if (result) {
        setFolder(result)
        pushRecentFolder(result.root)
      } else {
        window.alert('文件夹不存在或无法打开：\n' + root)
      }
    },
    [pushRecentFolder]
  )

  const openPath = useCallback(
    async (path: string, name?: string) => {
      const existing = stateRef.current.tabs.find((t) => t.path === path)
      if (existing) {
        setActiveId(existing.id)
        return
      }
      let file
      try {
        file = await window.api.readFile(path)
      } catch {
        window.alert('文件不存在或无法打开：\n' + path)
        return
      }
      const tab: Tab = {
        id: newTabId(),
        path: file.path,
        name: name || file.name,
        content: file.content,
        dirty: false
      }
      setTabs((prev) => [...prev, tab])
      setActiveId(tab.id)
      pushRecentFile(file.path)
    },
    [pushRecentFile]
  )

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
    pushRecentFile(file.path)
  }, [pushRecentFile])

  const newFile = useCallback(() => {
    const tab: Tab = { id: newTabId(), path: null, name: '未命名.md', content: '', dirty: false }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [])

  // ---- 编辑/保存 ----
  const updateContent = useCallback((id: string, content: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, content, dirty: t.content !== content || t.dirty } : t))
    )
  }, [])

  const saveTab = useCallback(
    async (id: string) => {
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
          pushRecentFile(result.path)
        }
      }
    },
    [pushRecentFile]
  )

  const saveAsTab = useCallback(
    async (id: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      if (!tab) return
      const result = await window.api.saveAs(tab.content, tab.name)
      if (result) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, path: result.path, name: result.name, dirty: false } : t
          )
        )
        pushRecentFile(result.path)
      }
    },
    [pushRecentFile]
  )

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      setActiveId((curr) => {
        if (curr !== id) return curr
        if (next.length === 0) return null
        return next[Math.min(idx, next.length - 1)].id
      })
      return next
    })
  }, [])

  // ---- 导出 ----
  const exportPDF = useCallback(async () => {
    if (!stateRef.current.activeId) return
    const tab = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeId)
    const res = await window.api.exportPDF(tab?.name ?? 'document')
    if (res) window.alert('已导出 PDF：\n' + res.path)
  }, [])

  const exportHTML = useCallback(async () => {
    if (!stateRef.current.activeId) return
    const tab = stateRef.current.tabs.find((t) => t.id === stateRef.current.activeId)
    const el = document.querySelector('.milkdown')
    const inner = el ? el.innerHTML : ''
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>${tab?.name ?? 'document'}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;line-height:1.7;color:#2c2c2c;max-width:780px;margin:40px auto;padding:0 20px}
  pre{background:#f5f5f5;padding:14px;border-radius:8px;overflow:auto}
  code{font-family:'SF Mono',Menlo,monospace}
  img{max-width:100%}
  blockquote{border-left:3px solid #ddd;margin:0;padding-left:16px;color:#666}
  table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:6px 10px}
</style></head><body><article>${inner}</article></body></html>`
    const res = await window.api.exportHTML(html, tab?.name ?? 'document')
    if (res) window.alert('已导出 HTML：\n' + res.path)
  }, [])

  const scrollToHeading = useCallback((index: number) => {
    const els = document.querySelectorAll(
      '.milkdown h1, .milkdown h2, .milkdown h3, .milkdown h4, .milkdown h5, .milkdown h6'
    )
    const el = els[index] as HTMLElement | undefined
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  // ---- 自动保存 ----
  useEffect(() => {
    if (!settings.autoSave || !activeTab || !activeTab.path || !activeTab.dirty) return
    const id = setTimeout(() => saveTab(activeTab.id), 1200)
    return () => clearTimeout(id)
  }, [settings.autoSave, activeTab?.content, activeTab?.dirty, activeTab?.id, activeTab, saveTab])

  // ---- 原生菜单动作 ----
  useEffect(() => {
    if (!window.api) return undefined
    const dispose = window.api.onMenuAction((action) => {
      const id = stateRef.current.activeId
      switch (action) {
        case 'new-file': newFile(); break
        case 'open-file': openFile(); break
        case 'open-folder': openFolder(); break
        case 'save': if (id) saveTab(id); break
        case 'save-as': if (id) saveAsTab(id); break
        case 'close-tab': if (id) closeTab(id); break
        case 'toggle-sidebar': setSidebarVisible((v) => !v); break
        case 'toggle-outline': setOutlineVisible((v) => !v); break
        case 'toggle-source': setSourceMode((v) => !v); break
        case 'find': setShowFind(true); break
        case 'open-settings': setShowSettings(true); break
        case 'export-pdf': exportPDF(); break
        case 'export-html': exportHTML(); break
      }
    })
    return dispose
  }, [newFile, openFile, openFolder, saveTab, saveAsTab, closeTab, exportPDF, exportHTML])

  return (
    <div className="app">
      {sidebarVisible && (
        <Sidebar
          folder={folder}
          activePath={activeTab?.path ?? null}
          favorites={settings.favorites}
          recentFiles={settings.recentFiles}
          onOpenFolder={openFolder}
          onOpenFolderPath={openFolderByPath}
          onOpenFile={openPath}
          onOpenSettings={() => setShowSettings(true)}
          onToggleFavorite={toggleFavorite}
          onRefresh={async () => {
            if (folder) {
              const tree = await window.api.readDir(folder.root)
              setFolder({ ...folder, tree })
            }
          }}
        />
      )}

      <div className={`main${sidebarVisible ? '' : ' no-sidebar'}`}>
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          sourceMode={sourceMode}
          outlineVisible={outlineVisible}
          onToggleSource={() => setSourceMode((v) => !v)}
          onToggleSidebar={() => setSidebarVisible((v) => !v)}
          onToggleOutline={() => setOutlineVisible((v) => !v)}
        />

        {showFind && <FindBar onClose={() => setShowFind(false)} />}

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
            <Welcome
              recentFiles={settings.recentFiles}
              recentFolders={settings.recentFolders}
              onOpenFolder={openFolder}
              onOpenFile={openFile}
              onNewFile={newFile}
              onOpenRecentFile={(p) => openPath(p, baseName(p))}
              onOpenRecentFolder={openFolderByPath}
            />
          )}

          {outlineVisible && activeTab && (
            <Outline items={outline} onSelect={scrollToHeading} onClose={() => setOutlineVisible(false)} />
          )}
        </div>

        <StatusBar tab={activeTab} sourceMode={sourceMode} autoSave={settings.autoSave} />
      </div>

      {showSettings && (
        <Settings settings={settings} onChange={saveSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
