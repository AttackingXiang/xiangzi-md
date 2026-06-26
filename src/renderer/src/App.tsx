import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import SourceEditor from './components/SourceEditor'

const Editor = lazy(() => import('./components/Editor'))
import Welcome from './components/Welcome'
import StatusBar from './components/StatusBar'
import Settings from './components/Settings'
import Outline from './components/Outline'
import FindBar from './components/FindBar'
import Lightbox from './components/Lightbox'
import Shortcuts from './components/Shortcuts'
import ContextMenu, { type MenuItem } from './components/ContextMenu'
import InputDialog from './components/InputDialog'
import SearchPanel from './components/SearchPanel'
import CommandPalette, { type Command } from './components/CommandPalette'
import { editorCmd, clipboardCmd, hasWysiwyg } from './lib/editorCommands'
import { getLang, t } from './lib/i18n'
import { baseName, dirName } from './lib/path'
import {
  Bold, Italic, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, SquareCode, Pilcrow,
  Copy, Scissors, ClipboardPaste, TextSelect
} from 'lucide-react'
import { parseOutline } from './lib/outline'
import type { Folder } from './types'
import { useSettings } from './hooks/useSettings'
import { useFileOps } from './hooks/useFileOps'
import { useTreeOps } from './hooks/useTreeOps'

interface FileEntry { path: string; name: string }

export default function App(): JSX.Element {
  // ── Settings (theme, width, i18n, CSS side-effects all live here) ──────────
  const {
    settings,
    settingsReady,
    saveSettings,
    pushRecentFile,
    pushRecentFolder,
    toggleFavorite
  } = useSettings()

  const lang = settings?.language ?? 'zh'

  // ── Folder state ───────────────────────────────────────────────────────────
  const [folder, setFolder] = useState<Folder | null>(null)
  const setFolderUpdater = useCallback(
    (updater: (prev: Folder | null) => Folder | null) => setFolder(updater),
    []
  )

  // ── File / tab operations ──────────────────────────────────────────────────
  const {
    tabs, setTabs, activeId, setActiveId, activeTab, stateRef,
    openPath, openFile, newFile, saveTab, saveAsTab,
    closeTab, closeOthers, closeAllTabs, closeLeft, closeRight,
    updateContent, restoreSession, hasDirtyTabs
  } = useFileOps({ pushRecentFile, lang })

  const activeDocDir = activeTab ? (dirName(activeTab.path) ?? folder?.root ?? null) : null
  const outline = useMemo(
    () => (activeTab ? parseOutline(activeTab.content) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTab?.content]
  )

  // ── Panel widths (drag-to-resize) ──────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const [outlineWidth, setOutlineWidth] = useState(240)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  const outlineWidthRef = useRef(outlineWidth)
  outlineWidthRef.current = outlineWidth

  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidthRef.current
    const onMove = (ev: MouseEvent): void =>
      setSidebarWidth(Math.max(160, Math.min(520, startW + ev.clientX - startX)))
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const startOutlineResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = outlineWidthRef.current
    // Outline is on the right; dragging left widens it
    const onMove = (ev: MouseEvent): void =>
      setOutlineWidth(Math.max(160, Math.min(520, startW + startX - ev.clientX)))
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // ── Reveal active file in sidebar ──────────────────────────────────────────
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const folderRef = useRef(folder)
  folderRef.current = folder

  // Auto-clear reveal highlight after 2 s (enough time for the tree to scroll)
  useEffect(() => {
    if (!revealPath) return
    const t = setTimeout(() => setRevealPath(null), 2000)
    return () => clearTimeout(t)
  }, [revealPath])

  const revealActiveFile = useCallback(async () => {
    const { tabs, activeId: aid } = stateRef.current
    const tab = tabs.find((tb) => tb.id === aid)
    if (!tab?.path) return
    setSidebarVisible(true)
    setSearchView(false)
    const fileParent = dirName(tab.path)
    if (!fileParent) return
    const currentFolder = folderRef.current
    const isUnderFolder =
      currentFolder?.root &&
      (tab.path.startsWith(currentFolder.root + '/') ||
        tab.path.startsWith(currentFolder.root + '\\'))
    if (!isUnderFolder) {
      const result = await window.api.openFolderPath(fileParent)
      if (result) { setFolder(result); pushRecentFolder(result.root) }
    }
    setRevealPath(tab.path)
  }, [pushRecentFolder])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showFind, setShowFind] = useState(false)
  const [findInitial, setFindInitial] = useState('')
  const [findLine, setFindLine] = useState<number | undefined>(undefined)
  const [searchView, setSearchView] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; items: MenuItem[]; preserveSelection?: boolean
  } | null>(null)
  const [inputDialog, setInputDialog] = useState<{
    title: string; initial?: string; confirmText?: string
    onSubmit: (value: string) => void
  } | null>(null)

  // Resolved theme for the Editor key (determines CodeMirror theme)
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    const apply = (): void => {
      const t =
        settings?.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
          : (settings?.theme ?? 'light')
      setResolvedTheme(t as 'light' | 'dark')
    }
    apply()
    if (settings?.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    return undefined
  }, [settings?.theme])

  // ── Session restore (runs once after settings load) ─────────────────────
  const didRestore = useRef(false)
  useEffect(() => {
    if (!settingsReady || didRestore.current || !settings) return
    didRestore.current = true
    ;(async () => {
      if (settings.session?.folder) {
        const res = await window.api.openFolderPath(settings.session.folder)
        if (res) setFolder(res)
      }
      if (settings.session?.openFiles?.length) {
        await restoreSession(settings.session.openFiles, settings.session.activePath)
      }
    })()
  }, [settingsReady, settings, restoreSession])

  // ── Session persistence (debounced, single write) ─────────────────────────
  const sessionReadyRef = useRef(false)
  useEffect(() => {
    if (settingsReady) sessionReadyRef.current = true
  }, [settingsReady])

  // Stable key that only changes when tab paths change, not when content changes.
  // Without this, every keystroke would restart the 500ms debounce timer.
  const tabPathsKey = tabs.map((t) => t.path ?? '').join('\0')
  useEffect(() => {
    if (!sessionReadyRef.current) return
    const session = {
      folder: folder?.root ?? null,
      openFiles: tabs.filter((t) => t.path).map((t) => t.path as string),
      activePath: activeTab?.path ?? null
    }
    const timer = setTimeout(() => window.api.setSettings({ session }), 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder?.root, tabPathsKey, activeTab?.path])

  // ── File tree ops ──────────────────────────────────────────────────────────
  const { treeKey, refreshTree, createFileIn, createFolderIn, openNodeContext, openRootContext } =
    useTreeOps({
      folder,
      setFolder: setFolderUpdater,
      openPath,
      closeTab,
      tabs,
      setCtxMenu,
      setInputDialog
    })

  // ── Folder open ────────────────────────────────────────────────────────────
  const openFolder = useCallback(async () => {
    const result = await window.api.openFolder()
    if (result) { setFolder(result); pushRecentFolder(result.root) }
  }, [pushRecentFolder])

  const openFolderByPath = useCallback(
    async (root: string) => {
      const result = await window.api.openFolderPath(root)
      if (result) {
        setFolder(result)
        pushRecentFolder(result.root)
      } else {
        window.alert(
          (getLang() === 'en' ? 'Folder not found:\n' : '文件夹不存在：\n') + root
        )
      }
    },
    [pushRecentFolder]
  )

  // ── System open-path (file association / double-click) ────────────────────
  useEffect(() => {
    if (!window.api) return undefined
    const dispose = window.api.onOpenPath((p) => openPath(p, baseName(p)))
    window.api.notifyReady()
    return dispose
  }, [openPath])

  // ── Tab context menu ───────────────────────────────────────────────────────
  const openTabContext = useCallback(
    (id: string, x: number, y: number) => {
      const list = stateRef.current.tabs
      const idx = list.findIndex((tb) => tb.id === id)
      const items: MenuItem[] = [
        { label: t('关闭'), onClick: () => closeTab(id) },
        { label: t('关闭其他'), onClick: () => closeOthers(id) }
      ]
      if (idx > 0) items.push({ label: t('关闭左侧全部'), onClick: () => closeLeft(id) })
      if (idx >= 0 && idx < list.length - 1)
        items.push({ label: t('关闭右侧全部'), onClick: () => closeRight(id) })
      items.push({ label: t('关闭全部'), onClick: closeAllTabs, separatorBefore: true })
      setCtxMenu({ x, y, items })
    },
    [closeTab, closeOthers, closeLeft, closeRight, closeAllTabs]
  )

  // ── Editor right-click menu ────────────────────────────────────────────────
  const openEditorContext = useCallback((x: number, y: number) => {
    const sz = 15
    const items: MenuItem[] = [
      { label: t('剪切'), icon: <Scissors size={sz} />, hint: '⌘X', onClick: clipboardCmd.cut },
      { label: t('复制'), icon: <Copy size={sz} />, hint: '⌘C', onClick: clipboardCmd.copy },
      { label: t('粘贴'), icon: <ClipboardPaste size={sz} />, hint: '⌘V', onClick: clipboardCmd.paste }
    ]
    if (hasWysiwyg()) {
      items.push(
        { label: t('加粗'), icon: <Bold size={sz} />, hint: '⌘B', onClick: editorCmd.bold, separatorBefore: true },
        { label: t('斜体'), icon: <Italic size={sz} />, hint: '⌘I', onClick: editorCmd.italic },
        { label: t('行内代码'), icon: <Code size={sz} />, hint: '⌘E', onClick: editorCmd.inlineCode },
        { label: t('标题 1'), icon: <Heading1 size={sz} />, onClick: () => editorCmd.heading(1), separatorBefore: true },
        { label: t('标题 2'), icon: <Heading2 size={sz} />, onClick: () => editorCmd.heading(2) },
        { label: t('标题 3'), icon: <Heading3 size={sz} />, onClick: () => editorCmd.heading(3) },
        { label: t('正文'), icon: <Pilcrow size={sz} />, onClick: editorCmd.paragraph },
        { label: t('无序列表'), icon: <List size={sz} />, onClick: editorCmd.bulletList, separatorBefore: true },
        { label: t('有序列表'), icon: <ListOrdered size={sz} />, onClick: editorCmd.orderedList },
        { label: t('引用'), icon: <Quote size={sz} />, onClick: editorCmd.quote },
        { label: t('代码块'), icon: <SquareCode size={sz} />, onClick: editorCmd.codeBlock }
      )
    }
    items.push({
      label: t('全选'), icon: <TextSelect size={sz} />, hint: '⌘A',
      onClick: clipboardCmd.selectAll, separatorBefore: true
    })
    setCtxMenu({ x, y, items, preserveSelection: true })
  }, [])

  // ── Search ─────────────────────────────────────────────────────────────────
  const openSearchResult = useCallback(
    (path: string, query: string, lineNumber?: number) => {
      openPath(path, baseName(path))
      setFindInitial(query)
      setFindLine(lineNumber)
      setShowFind(true)
    },
    [openPath]
  )

  // ── Outline navigation ─────────────────────────────────────────────────────
  const scrollToHeading = useCallback((index: number) => {
    const els = document.querySelectorAll(
      '.milkdown h1, .milkdown h2, .milkdown h3, .milkdown h4, .milkdown h5, .milkdown h6'
    )
    ;(els[index] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const reorderSection = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    import('./lib/outlineReorder').then(({ reorderHeadingSections }) => {
      reorderHeadingSections(fromIndex, toIndex)
    })
  }, [])

  // ── Export ────────────────────────────────────────────────────────────────
  /** Build a self-contained HTML string that renders identically to the app view */
  const generateExportHTML = useCallback(async (title: string): Promise<string | null> => {
    // Target only the ProseMirror content node — not the full .milkdown wrapper
    // (which contains floating toolbars, bubble menus and other editor chrome)
    const pm =
      document.querySelector<HTMLElement>('.milkdown .ProseMirror') ??
      document.querySelector<HTMLElement>('.milkdown [contenteditable="true"]') ??
      document.querySelector<HTMLElement>('.milkdown')
    if (!pm) return null

    const clone = pm.cloneNode(true) as HTMLElement

    // Strip Milkdown UI decorations: table handles, drag handles, toolbars…
    // These are ProseMirror decoration nodes, not actual document content.
    clone.querySelectorAll(
      '[class*="milkdown-"], .handle, .drag-preview, [data-role], [data-show]'
    ).forEach((el) => el.remove())

    // Remove editor selection state classes that look wrong in a static export
    clone.querySelectorAll('.selectedCell, .ProseMirror-selectednode').forEach((el) => {
      el.classList.remove('selectedCell', 'ProseMirror-selectednode')
    })

    // Inline xmd:// images as base64 so the HTML is fully self-contained
    const imgs = Array.from(clone.querySelectorAll('img[src]')) as HTMLImageElement[]
    await Promise.all(
      imgs.map(async (img) => {
        const src = img.getAttribute('src') ?? ''
        if (!src.startsWith('xmd://')) return
        try {
          const res = await fetch(src)
          const blob = await res.blob()
          const b64 = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          img.setAttribute('src', b64)
        } catch { /* leave original src */ }
      })
    )

    // Collect all live <style> tags — includes Milkdown styles, code highlighting,
    // theme variables, etc. — so the export renders with the exact same CSS.
    const liveStyles = Array.from(document.querySelectorAll('style'))
      .map((s) => s.outerHTML)
      .join('\n')

    // Preserve dark / light theme
    const theme = document.documentElement.getAttribute('data-theme') ?? ''

    return `<!doctype html>
<html${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8" /><title>${title}</title>
${liveStyles}
<style>
  *{scrollbar-width:none}*::-webkit-scrollbar{display:none}
  html,body{margin:0;padding:0;background:var(--bg,#fff)}
  .milkdown{padding:0;background:var(--bg,#fff)}
  .ProseMirror.export-content{max-width:800px;margin:0 auto;padding:48px 40px 80px;outline:none}
</style>
</head><body>
<div class="milkdown"><div class="ProseMirror export-content">${clone.innerHTML}</div></div>
</body></html>`
  }, [])

  const exportPDF = useCallback(async () => {
    const { activeId: id } = stateRef.current
    if (!id) return
    const tab = stateRef.current.tabs.find((t) => t.id === id)
    const html = await generateExportHTML(tab?.name ?? 'document')
    if (!html) return
    const res = await window.api.exportPDF(html, tab?.name ?? 'document')
    if (res) window.alert((getLang() === 'en' ? 'Exported PDF:\n' : '已导出 PDF：\n') + res.path)
  }, [generateExportHTML])

  const exportImage = useCallback(async () => {
    const { activeId: id } = stateRef.current
    if (!id) return
    const tab = stateRef.current.tabs.find((t) => t.id === id)
    const html = await generateExportHTML(tab?.name ?? 'document')
    if (!html) return
    const res = await window.api.exportImage(html, tab?.name ?? 'document')
    if (res) window.alert((getLang() === 'en' ? 'Exported image:\n' : '已导出图片：\n') + res.path)
  }, [generateExportHTML])

  // ── Palette files (background scan) ───────────────────────────────────────
  const [paletteFiles, setPaletteFiles] = useState<FileEntry[]>([])
  useEffect(() => {
    if (!folder) { setPaletteFiles([]); return }
    let cancelled = false
    window.api.listFiles(folder.root).then((list) => { if (!cancelled) setPaletteFiles(list) })
    return () => { cancelled = true }
  }, [folder?.root])

  const paletteCommands = useMemo<Command[]>(
    () => [
      { id: 'new', label: t('新建文件'), run: newFile },
      { id: 'open-file', label: t('打开文件…'), run: openFile },
      { id: 'open-folder', label: t('打开文件夹…'), run: openFolder },
      { id: 'save', label: t('保存'), run: () => activeId && saveTab(activeId) },
      { id: 'save-as', label: t('另存为…'), run: () => activeId && saveAsTab(activeId) },
      { id: 'search', label: t('在文件夹中搜索'), run: () => { setSidebarVisible(true); setSearchView(true) } },
      { id: 'find', label: t('查找 / 替换'), run: () => setShowFind(true) },
      { id: 'outline', label: t('切换大纲'), run: () => setOutlineVisible((v) => !v) },
      { id: 'sidebar', label: t('切换侧边栏'), run: () => setSidebarVisible((v) => !v) },
      { id: 'source', label: t('切换源码模式'), run: () => setSourceMode((v) => !v) },
      { id: 'focus', label: t('专注模式'), run: () => setFocusMode((v) => !v) },
      { id: 'typewriter', label: t('打字机模式'), run: () => setTypewriterMode((v) => !v) },
      { id: 'export-pdf', label: t('导出 PDF'), run: exportPDF },
      { id: 'export-image', label: t('导出图片'), run: exportImage },
      { id: 'settings', label: t('设置'), run: () => setShowSettings(true) },
      { id: 'shortcuts', label: t('快捷键'), run: () => setShowShortcuts(true) }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newFile, openFile, openFolder, activeId, saveTab, saveAsTab, exportPDF, exportImage, lang]
  )

  // ── Auto-save ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings?.autoSave || !activeTab?.path || !activeTab.dirty) return
    const id = setTimeout(() => saveTab(activeTab.id), 1200)
    return () => clearTimeout(id)
  }, [settings?.autoSave, activeTab?.content, activeTab?.dirty, activeTab?.id, saveTab])

  // ── Native menu actions ───────────────────────────────────────────────────
  useEffect(() => {
    if (!window.api) return undefined
    return window.api.onMenuAction((action) => {
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
        case 'toggle-focus': setFocusMode((v) => !v); break
        case 'toggle-typewriter': setTypewriterMode((v) => !v); break
        case 'find': setShowFind(true); break
        case 'search-in-folder': setSidebarVisible(true); setSearchView(true); break
        case 'open-settings': setShowSettings(true); break
        case 'show-shortcuts': setShowShortcuts(true); break
        case 'command-palette': setShowPalette(true); break
        case 'export-pdf': exportPDF(); break
        case 'export-image': exportImage(); break
        case 'query-dirty': {
          const dirty = hasDirtyTabs()
          const proceed =
            !dirty ||
            window.confirm(
              getLang() === 'en'
                ? 'You have unsaved changes. Quit anyway?'
                : '还有未保存的文件，确定退出？'
            )
          if (proceed) window.api.notifyQuitOk()
          break
        }
      }
    })
  }, [newFile, openFile, openFolder, saveTab, saveAsTab, closeTab, exportPDF, exportImage, hasDirtyTabs])

  // Don't render until settings are loaded (avoids flash of wrong theme/width)
  if (!settings) return <div className="app" />

  return (
    <div className="app">
      {sidebarVisible &&
        (searchView && folder ? (
          <SearchPanel
            root={folder.root}
            onOpenResult={openSearchResult}
            onBack={() => setSearchView(false)}
          />
        ) : (
          <Sidebar
            folder={folder}
            activePath={activeTab?.path ?? null}
            favorites={settings.favorites}
            recentFiles={settings.recentFiles}
            revealPath={revealPath}
            hideAttachmentFolders={settings.hideAttachmentFolders ?? false}
            attachmentFolder={settings.attachmentFolder || 'assets'}
            onOpenFolder={openFolder}
            onOpenFolderPath={openFolderByPath}
            onOpenFile={openPath}
            onOpenSettings={() => setShowSettings(true)}
            onOpenSearch={() => setSearchView(true)}
            onToggleFavorite={toggleFavorite}
            onRefresh={refreshTree}
            onNodeContext={openNodeContext}
            onRootContext={openRootContext}
            reloadKey={treeKey}
            style={{ width: sidebarWidth, minWidth: sidebarWidth }}
          />
        ))}

      {sidebarVisible && !searchView && (
        <div className="resize-handle" onMouseDown={startSidebarResize} />
      )}

      <div className={`main${sidebarVisible ? '' : ' no-sidebar'}`}>
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          onTabContext={openTabContext}
          sourceMode={sourceMode}
          outlineVisible={outlineVisible}
          onToggleSource={() => setSourceMode((v) => !v)}
          onToggleSidebar={() => setSidebarVisible((v) => !v)}
          onToggleOutline={() => setOutlineVisible((v) => !v)}
          onRevealFile={revealActiveFile}
          activeHasPath={!!activeTab?.path}
        />

        {showFind && (
          <FindBar
            initialQuery={findInitial}
            initialLine={findLine}
            onClose={() => { setShowFind(false); setFindInitial(''); setFindLine(undefined) }}
          />
        )}

        <div
          className="editor-area"
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.tagName === 'IMG') {
              const src = (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src
              if (src) setZoomSrc(src)
            }
          }}
          onContextMenu={(e) => {
            if (!activeTab) return
            e.preventDefault()
            openEditorContext(e.clientX, e.clientY)
          }}
        >
          {activeTab ? (
            sourceMode ? (
              <SourceEditor
                key={activeTab.id + '-src'}
                content={activeTab.content}
                onChange={(c) => updateContent(activeTab.id, c)}
              />
            ) : (
              <Suspense fallback={<div className="editor-loading" />}>
                <Editor
                  key={activeTab.id + '-' + resolvedTheme}
                  content={activeTab.content}
                  docDir={activeDocDir}
                  docName={activeTab.name}
                  vaultRoot={folder?.root ?? null}
                  assetSearchPaths={settings.assetSearchPaths ?? []}
                  imageMaxWidth={settings.imageMaxWidth}
                  theme={resolvedTheme}
                  focusMode={focusMode}
                  typewriterMode={typewriterMode}
                  onChange={(c) => updateContent(activeTab.id, c)}
                />
              </Suspense>
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
            <>
              <div className="resize-handle" onMouseDown={startOutlineResize} />
              <Outline
                items={outline}
                onSelect={scrollToHeading}
                onReorder={reorderSection}
                onClose={() => setOutlineVisible(false)}
                width={outlineWidth}
              />
            </>
          )}
        </div>

        <StatusBar tab={activeTab} sourceMode={sourceMode} autoSave={settings.autoSave} />
      </div>

      {showSettings && (
        <Settings
          settings={settings}
          onChange={saveSettings}
          onShowShortcuts={() => { setShowSettings(false); setShowShortcuts(true) }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}

      {showPalette && (
        <CommandPalette
          commands={paletteCommands}
          files={paletteFiles}
          onOpenFile={(p, n) => openPath(p, n)}
          onClose={() => setShowPalette(false)}
        />
      )}

      {zoomSrc && <Lightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          preserveSelection={ctxMenu.preserveSelection}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {inputDialog && (
        <InputDialog
          title={inputDialog.title}
          initial={inputDialog.initial}
          confirmText={inputDialog.confirmText}
          onSubmit={inputDialog.onSubmit}
          onClose={() => setInputDialog(null)}
        />
      )}
    </div>
  )
}
