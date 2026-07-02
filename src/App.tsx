import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from 'react'
import { desktop } from './platform'
import Sidebar from './components/Sidebar'
import TabBar from './components/TabBar'
import SourceEditor from './components/SourceEditor'

const Editor = lazy(() => import('./components/Editor'))
const Settings = lazy(() => import('./components/Settings'))
const UpdateNotice = lazy(() => import('./components/UpdateNotice'))
import Welcome from './components/Welcome'
import StatusBar from './components/StatusBar'
import Outline from './components/Outline'
import FindBar from './components/FindBar'
import Lightbox from './components/Lightbox'
import ContextMenu, { type MenuItem } from './components/ContextMenu'
import InputDialog from './components/InputDialog'
import ExportCompleteDialog from './components/ExportCompleteDialog'
import DraftRecoveryDialog from './components/DraftRecoveryDialog'
import UnsavedChangesDialog, {
  type CloseDecision,
  type CloseReason,
} from './components/UnsavedChangesDialog'
import SearchPanel from './components/SearchPanel'
import CommandPalette from './components/CommandPalette'
import { getLang, t } from './lib/i18n'
import { baseName, dirName } from './lib/path'
import { revealLocationKey } from './lib/platform'
import { replaceMovedPath } from './lib/treeDrag'
import { parseOutline } from './lib/outline'
import type { Folder, Tab } from './types'
import { useSettings } from './hooks/useSettings'
import { useFileOps } from './hooks/useFileOps'
import { useTreeOps } from './hooks/useTreeOps'
import { useUpdater } from './hooks/useUpdater'
import { useDraftRecovery } from './hooks/useDraftRecovery'
import { useEditorContextMenu } from './hooks/useEditorContextMenu'
import { useExportActions } from './hooks/useExportActions'
import { useAppCommands } from './hooks/useAppCommands'
import { useNativeIntegration } from './hooks/useNativeIntegration'
import type { SettingsSection } from './components/Settings'

const EMPTY_SHORTCUTS: Record<string, string> = {}

export default function App(): JSX.Element {
  // ── Settings (theme, width, i18n, CSS side-effects all live here) ──────────
  const {
    settings,
    settingsReady,
    customCssError,
    saveSettings,
    pushRecentFile,
    pushRecentFolder,
    toggleFavorite,
    setFavoritesCollapsed,
    setFavoriteLabel,
  } = useSettings()

  const lang = settings?.language ?? 'zh'

  // ── Unsaved changes confirmation ─────────────────────────────────────────
  const closeRequestRef = useRef<{
    tabs: Tab[]
    reason: CloseReason
    resolve: (decision: CloseDecision) => void
  } | null>(null)
  const [unsavedCloseRequest, setUnsavedCloseRequest] = useState<{
    tabs: Tab[]
    reason: CloseReason
  } | null>(null)
  const requestCloseDecision = useCallback(
    (dirtyTabs: Tab[], reason: CloseReason = 'close'): Promise<CloseDecision> =>
      new Promise((resolve) => {
        // 模态框打开期间拒绝叠加第二个关闭请求，避免覆盖前一个 Promise。
        if (closeRequestRef.current) {
          resolve('cancel')
          return
        }
        closeRequestRef.current = { tabs: dirtyTabs, reason, resolve }
        setUnsavedCloseRequest({ tabs: dirtyTabs, reason })
      }),
    [],
  )
  const resolveCloseDecision = useCallback((decision: CloseDecision): void => {
    const request = closeRequestRef.current
    closeRequestRef.current = null
    setUnsavedCloseRequest(null)
    request?.resolve(decision)
  }, [])

  // ── Folder state ───────────────────────────────────────────────────────────
  const [folder, setFolder] = useState<Folder | null>(null)
  const setFolderUpdater = useCallback(
    (updater: (prev: Folder | null) => Folder | null) => setFolder(updater),
    [],
  )

  // ── File / tab operations ──────────────────────────────────────────────────
  const {
    tabs,
    setTabs,
    activeId,
    setActiveId,
    activeTab,
    stateRef,
    openPath,
    openFile,
    newFile,
    recoverDraft,
    saveTab,
    saveAsTab,
    closeTab,
    closeOthers,
    closeAllTabs,
    closeLeft,
    closeRight,
    updateContent,
    restoreSession,
    confirmCloseTabs,
    closeTabsWithoutPrompt,
  } = useFileOps({ pushRecentFile, lang, requestCloseDecision })

  const getCurrentTabs = useCallback((): Tab[] => stateRef.current.tabs, [stateRef])
  const {
    drafts: draftSummaries,
    isOpen: draftRecoveryOpen,
    setOpen: setDraftRecoveryOpen,
    recover: recoverDraftSummary,
    deleteDrafts,
    clearRuntimeDrafts,
  } = useDraftRecovery({ tabs, getCurrentTabs, openRecoveredDraft: recoverDraft })

  const activeDocDir = activeTab
    ? (dirName(activeTab.path ?? activeTab.recoverySourcePath ?? null) ?? folder?.root ?? null)
    : null
  // 编辑器会在标签切换时卸载；滚动位置按“标签 + 编辑模式”独立保存。
  // 使用 ref 避免滚动过程中触发整棵应用树重渲染。
  const wysiwygScrollPositions = useRef(new Map<string, number>())
  const sourceScrollPositions = useRef(new Map<string, number>())
  useEffect(() => {
    const openIds = new Set(tabs.map((tab) => tab.id))
    for (const id of wysiwygScrollPositions.current.keys()) {
      if (!openIds.has(id)) wysiwygScrollPositions.current.delete(id)
    }
    for (const id of sourceScrollPositions.current.keys()) {
      if (!openIds.has(id)) sourceScrollPositions.current.delete(id)
    }
  }, [tabs])

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
  const [revealRequest, setRevealRequest] = useState<{ path: string; id: number } | null>(null)
  const revealRequestCounterRef = useRef(0)
  const revealCompleteTimerRef = useRef<number | null>(null)
  const folderRef = useRef(folder)
  folderRef.current = folder

  const revealPath = revealRequest?.path ?? null
  const revealRequestId = revealRequest?.id ?? null

  const requestReveal = useCallback((path: string): void => {
    if (revealCompleteTimerRef.current !== null) {
      window.clearTimeout(revealCompleteTimerRef.current)
      revealCompleteTimerRef.current = null
    }
    revealRequestCounterRef.current += 1
    setRevealRequest({ path, id: revealRequestCounterRef.current })
  }, [])

  // Keep the request alive while lazy ancestor folders load. A long fallback
  // only clears targets that disappeared or are hidden from the tree.
  useEffect(() => {
    if (revealRequestId === null) return undefined
    const timer = window.setTimeout(() => {
      setRevealRequest((current) => (current?.id === revealRequestId ? null : current))
    }, 30_000)
    return () => window.clearTimeout(timer)
  }, [revealRequestId])

  useEffect(
    () => () => {
      if (revealCompleteTimerRef.current !== null) {
        window.clearTimeout(revealCompleteTimerRef.current)
      }
    },
    [],
  )

  const handleRevealComplete = useCallback((requestId: number): void => {
    if (revealCompleteTimerRef.current !== null) {
      window.clearTimeout(revealCompleteTimerRef.current)
    }
    revealCompleteTimerRef.current = window.setTimeout(() => {
      setRevealRequest((current) => (current?.id === requestId ? null : current))
      revealCompleteTimerRef.current = null
    }, 1800)
  }, [])

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
    try {
      if (!isUnderFolder) {
        const result = await desktop.openContainingFolder(tab.path)
        if (!result) return
        setFolder(result)
        pushRecentFolder(result.root)
      }
      requestReveal(tab.path)
    } catch (error) {
      console.error('Reveal active file failed', error)
      window.alert(t('无法定位文件所在目录'))
    }
  }, [pushRecentFolder, requestReveal])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const captureActiveScroll = useCallback((): void => {
    if (!activeId) return
    if (sourceMode) {
      const editor = document.querySelector<HTMLTextAreaElement>('.source-editor')
      if (editor) sourceScrollPositions.current.set(activeId, editor.scrollTop)
    } else {
      const editor = document.querySelector<HTMLElement>('.wysiwyg-editor')
      if (editor) wysiwygScrollPositions.current.set(activeId, editor.scrollTop)
    }
  }, [activeId, sourceMode])

  const selectTab = useCallback(
    (id: string): void => {
      if (id === activeId) return
      captureActiveScroll()
      setActiveId(id)
    },
    [activeId, captureActiveScroll, setActiveId],
  )

  const showWelcome = useCallback((): void => {
    captureActiveScroll()
    setActiveId(null)
  }, [captureActiveScroll, setActiveId])
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [showFind, setShowFind] = useState(false)
  const [findInitial, setFindInitial] = useState('')
  const [findLine, setFindLine] = useState<number | undefined>(undefined)
  const [findMatchIndex, setFindMatchIndex] = useState<number | undefined>(undefined)
  const [searchView, setSearchView] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    items: MenuItem[]
    preserveSelection?: boolean
  } | null>(null)
  const openEditorContext = useEditorContextMenu(setCtxMenu)
  const [inputDialog, setInputDialog] = useState<{
    title: string
    initial?: string
    confirmText?: string
    onSubmit: (value: string) => void
  } | null>(null)
  const [exportResultPath, setExportResultPath] = useState<string | null>(null)

  const deferredOutlineContent = useDeferredValue(
    outlineVisible && activeTab ? activeTab.content : '',
  )
  const outline = useMemo(
    () => (outlineVisible && deferredOutlineContent ? parseOutline(deferredOutlineContent) : []),
    [deferredOutlineContent, outlineVisible],
  )

  const updater = useUpdater(settings?.checkUpdatesOnStartup ?? false)

  // Resolved theme for the Editor key (determines CodeMirror theme)
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    const apply = (): void => {
      const t =
        settings?.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : (settings?.theme ?? 'light')
      setResolvedTheme(t)
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
  const [sessionRestored, setSessionRestored] = useState(false)
  useEffect(() => {
    if (!settingsReady || didRestore.current || !settings) return
    didRestore.current = true
    void (async () => {
      try {
        if (settings.session?.folder) {
          const res = await desktop.openFolderPath(settings.session.folder)
          if (res) setFolder(res)
        }
        if (settings.session?.openFiles?.length) {
          await restoreSession(settings.session.openFiles, settings.session.activePath)
        }
      } catch (error) {
        console.error('Session restore failed', error)
      } finally {
        // Do not persist an empty session while asynchronous restoration is
        // still reading files. That race previously erased the saved tabs.
        setSessionRestored(true)
      }
    })()
  }, [settingsReady, settings, restoreSession])

  // ── Session persistence (debounced, single write) ─────────────────────────
  // Stable key that only changes when tab paths change, not when content changes.
  // Without this, every keystroke would restart the 500ms debounce timer.
  const tabPathsKey = tabs.map((t) => t.path ?? '').join('\0')
  useEffect(() => {
    if (!sessionRestored) return
    const session = {
      folder: folder?.root ?? null,
      openFiles: tabs.filter((t) => t.path).map((t) => t.path as string),
      activePath: activeTab?.path ?? null,
    }
    const timer = setTimeout(() => {
      void desktop
        .setSettings({ session })
        .catch((error: unknown) => console.error('Session persistence failed', error))
    }, 500)
    return () => clearTimeout(timer)
  }, [folder?.root, tabPathsKey, activeTab?.path, sessionRestored])

  // ── Folder open ────────────────────────────────────────────────────────────
  const openFolder = useCallback(async () => {
    const result = await desktop.openFolder()
    if (result) {
      setFolder(result)
      pushRecentFolder(result.root)
    }
  }, [pushRecentFolder])

  const chooseFolderFrom = useCallback(
    async (initialPath: string) => {
      const result = await desktop.openFolder(initialPath)
      if (result) {
        setFolder(result)
        pushRecentFolder(result.root)
      }
    },
    [pushRecentFolder],
  )

  const openFolderByPath = useCallback(
    async (root: string) => {
      const result = await desktop.openFolderPath(root)
      if (result) {
        setFolder(result)
        pushRecentFolder(result.root)
      } else {
        window.alert((getLang() === 'en' ? 'Folder not found:\n' : '文件夹不存在：\n') + root)
      }
    },
    [pushRecentFolder],
  )

  const openParentFolder = useCallback(
    async (root: string) => {
      try {
        const result = await desktop.openParentFolder(root)
        if (result) {
          setFolder(result)
          pushRecentFolder(result.root)
        }
      } catch (error) {
        console.error('Open parent folder failed', error)
        window.alert(t('无法打开上级文件夹'))
      }
    },
    [pushRecentFolder],
  )

  const openFavoriteContext = useCallback(
    (path: string, x: number, y: number) => {
      const currentLabel = settings?.favoriteLabels[path]?.trim() ?? ''
      const items: MenuItem[] = [
        {
          label: t('自定义收藏名称'),
          onClick: () =>
            setInputDialog({
              title: t('收藏名称'),
              initial: currentLabel || baseName(path),
              confirmText: t('确定'),
              onSubmit: (value) => setFavoriteLabel(path, value),
            }),
        },
      ]
      if (currentLabel) {
        items.push({
          label: t('恢复默认名称'),
          onClick: () => setFavoriteLabel(path, ''),
        })
      }
      items.push({
        label: t(revealLocationKey()),
        onClick: () => void desktop.reveal(path),
        separatorBefore: true,
      })
      items.push({
        label: t('取消收藏'),
        onClick: () => toggleFavorite(path),
        danger: true,
        separatorBefore: true,
      })
      setCtxMenu({ x, y, items })
    },
    [settings?.favoriteLabels, setFavoriteLabel, toggleFavorite],
  )

  // ── File tree ops ──────────────────────────────────────────────────────────
  const { treeKey, refreshTree, openNodeContext, openRootContext } = useTreeOps({
    folder,
    setFolder: setFolderUpdater,
    openPath,
    confirmCloseTabs,
    closeTabsWithoutPrompt,
    tabs,
    setTabs,
    openParentFolder,
    chooseFolderFrom,
    setCtxMenu,
    setInputDialog,
  })

  const workspaceVisibilityKey = settings
    ? `${settings.showAllFiles}:${settings.hiddenWorkspacePaths.join('\0')}`
    : ''
  useEffect(() => {
    if (!workspaceVisibilityKey) return
    void refreshTree()
  }, [workspaceVisibilityKey, refreshTree])

  // ── System open-path (file association / double-click) ────────────────────
  useEffect(() => {
    if (!desktop) return undefined
    return desktop.onOpenPath((p) => openPath(p, baseName(p)))
  }, [openPath])

  // ── Tab context menu ───────────────────────────────────────────────────────
  const openTabContext = useCallback(
    (id: string, x: number, y: number) => {
      const list = stateRef.current.tabs
      const idx = list.findIndex((tb) => tb.id === id)
      const items: MenuItem[] = [
        { label: t('关闭'), onClick: () => void closeTab(id) },
        { label: t('关闭其他'), onClick: () => void closeOthers(id) },
      ]
      if (idx > 0) items.push({ label: t('关闭左侧全部'), onClick: () => void closeLeft(id) })
      if (idx >= 0 && idx < list.length - 1)
        items.push({ label: t('关闭右侧全部'), onClick: () => void closeRight(id) })
      items.push({
        label: t('关闭全部'),
        onClick: () => void closeAllTabs(),
        separatorBefore: true,
      })
      setCtxMenu({ x, y, items })
    },
    [closeTab, closeOthers, closeLeft, closeRight, closeAllTabs],
  )

  // ── Search ─────────────────────────────────────────────────────────────────
  const openSearchResult = useCallback(
    async (path: string, query: string, lineNumber?: number, matchIndex?: number) => {
      await openPath(path, baseName(path))
      setFindInitial(query)
      setFindLine(lineNumber)
      setFindMatchIndex(matchIndex)
      setShowFind(true)
    },
    [openPath],
  )

  // ── Outline navigation ─────────────────────────────────────────────────────
  const scrollToHeading = useCallback((index: number) => {
    const els = document.querySelectorAll(
      '.milkdown h1, .milkdown h2, .milkdown h3, .milkdown h4, .milkdown h5, .milkdown h6',
    )
    ;(els[index] as HTMLElement | undefined)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const reorderSection = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    void import('./lib/outlineReorder')
      .then(({ reorderHeadingSections }) => {
        reorderHeadingSections(fromIndex, toIndex)
      })
      .catch((error: unknown) => console.error('Outline reorder failed', error))
  }, [])

  const { exportHTML, exportPDF, exportImage } = useExportActions(stateRef, setExportResultPath)
  // ── File tree move (drag-and-drop) ────────────────────────────────────────
  const moveTreeItem = useCallback(
    async (sourcePath: string, targetDirPath: string) => {
      try {
        const res = await desktop.moveItem(sourcePath, targetDirPath)
        // Update any open tabs whose path was inside the moved item
        setTabs((prev) =>
          prev.map((tab) => {
            if (!tab.path) return tab
            const newPath = replaceMovedPath(tab.path, sourcePath, res.path)
            return newPath === tab.path
              ? tab
              : { ...tab, path: newPath, name: baseName(newPath) || res.name }
          }),
        )
        await refreshTree()
        requestReveal(res.path)
      } catch (err) {
        window.alert(
          (getLang() === 'en' ? 'Move failed:\n' : '移动失败：\n') + (err as Error).message,
        )
      }
    },
    [refreshTree, requestReveal, setTabs],
  )

  const { paletteFiles, paletteCommands, dispatchShortcut } = useAppCommands({
    folder,
    showPalette,
    activeId,
    stateRef,
    shortcuts: settings?.shortcuts ?? EMPTY_SHORTCUTS,
    lang,
    newFile,
    openFile,
    openFolder,
    saveTab,
    saveAsTab,
    closeTab,
    exportHTML,
    exportPDF,
    exportImage,
    setShowPalette,
    setSidebarVisible,
    setSearchView,
    setShowFind,
    setOutlineVisible,
    setSourceMode,
    setFocusMode,
    setTypewriterMode,
    setSettingsSection,
  })
  // ── Auto-save ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings?.autoSave || !activeTab?.path || !activeTab.dirty) return
    const id = setTimeout(() => void saveTab(activeTab.id), 1200)
    return () => clearTimeout(id)
  }, [settings?.autoSave, activeTab?.content, activeTab?.dirty, activeTab?.id, saveTab])

  useNativeIntegration({
    stateRef,
    dispatchShortcut,
    exportHTML,
    exportPDF,
    exportImage,
    checkForUpdates: updater.checkNow,
    clearRuntimeDrafts,
    deleteDrafts,
    requestCloseDecision,
    saveTab,
  })
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
            favoritesCollapsed={settings.favoritesCollapsed}
            favoriteLabels={settings.favoriteLabels}
            recentFiles={settings.recentFiles}
            revealPath={revealPath}
            revealRequestId={revealRequestId}
            onRevealComplete={handleRevealComplete}
            hideAttachmentFolders={settings.hideAttachmentFolders ?? false}
            attachmentFolder={settings.attachmentFolder || 'assets'}
            onOpenFolder={openFolder}
            onOpenFolderPath={openFolderByPath}
            onOpenFile={openPath}
            onOpenSettings={() => setSettingsSection('appearance')}
            onOpenSearch={() => setSearchView(true)}
            onToggleFavorite={toggleFavorite}
            onFavoritesCollapsedChange={setFavoritesCollapsed}
            onFavoriteContext={openFavoriteContext}
            onRefresh={refreshTree}
            onNodeContext={openNodeContext}
            onRootContext={openRootContext}
            onMove={moveTreeItem}
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
          onSelect={selectTab}
          onClose={closeTab}
          onTabContext={openTabContext}
          onShowWelcome={showWelcome}
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
            initialMatchIndex={findMatchIndex}
            onClose={() => {
              setShowFind(false)
              setFindInitial('')
              setFindLine(undefined)
              setFindMatchIndex(undefined)
            }}
          />
        )}

        <div
          className="editor-area"
          onMouseDownCapture={() => window.dispatchEvent(new Event('xmd-clear-select-all'))}
          onDoubleClickCapture={(event) => {
            if (!(event.target instanceof Element)) return
            const target = event.target
            const image =
              target instanceof HTMLImageElement
                ? target
                : target.closest('.image-wrapper, .milkdown-image-inline')?.querySelector('img')
            if (!image) return
            event.preventDefault()
            event.stopPropagation()
            const src = image.currentSrc || image.src
            if (src) setZoomSrc(src)
          }}
          onContextMenu={(e) => {
            if (!activeTab) return
            e.preventDefault()
            const target = e.target instanceof Element ? e.target : null
            const image =
              target instanceof HTMLImageElement
                ? target
                : target
                    ?.closest('.image-wrapper, .milkdown-image-inline')
                    ?.querySelector<HTMLImageElement>('img')
            openEditorContext(e.clientX, e.clientY, image ?? undefined, !!target?.closest('td, th'))
          }}
        >
          {activeTab ? (
            sourceMode ? (
              <SourceEditor
                key={activeTab.id + '-src'}
                content={activeTab.content}
                initialScrollTop={sourceScrollPositions.current.get(activeTab.id) ?? 0}
                onScrollTopChange={(scrollTop) =>
                  sourceScrollPositions.current.set(activeTab.id, scrollTop)
                }
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
                  allowRemoteImages={settings.allowRemoteImages ?? false}
                  imageMaxWidth={settings.imageMaxWidth}
                  theme={resolvedTheme}
                  focusMode={focusMode}
                  typewriterMode={typewriterMode}
                  initialScrollTop={wysiwygScrollPositions.current.get(activeTab.id) ?? 0}
                  onScrollTopChange={(scrollTop) =>
                    wysiwygScrollPositions.current.set(activeTab.id, scrollTop)
                  }
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
              draftCount={draftSummaries.length}
              onOpenDrafts={() => setDraftRecoveryOpen(true)}
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

      {settingsSection && (
        <Suspense fallback={null}>
          <Settings
            key={settingsSection}
            settings={settings}
            updater={updater}
            customCssError={customCssError}
            initialSection={settingsSection}
            onChange={(patch) => {
              void saveSettings(patch).catch((error: unknown) => {
                const readOnly =
                  typeof error === 'object' &&
                  error !== null &&
                  'code' in error &&
                  error.code === 'settings_read_only'
                window.alert(
                  readOnly
                    ? getLang() === 'en'
                      ? 'These settings were created by a newer app version and are read-only.'
                      : '这些设置来自更高版本，当前以只读模式运行。'
                    : getLang() === 'en'
                      ? 'Settings could not be saved.'
                      : '设置保存失败。',
                )
              })
            }}
            onClose={() => setSettingsSection(null)}
          />
        </Suspense>
      )}

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

      {unsavedCloseRequest && (
        <UnsavedChangesDialog
          tabs={unsavedCloseRequest.tabs}
          reason={unsavedCloseRequest.reason}
          onDecision={resolveCloseDecision}
        />
      )}

      {draftRecoveryOpen && draftSummaries.length > 0 && (
        <DraftRecoveryDialog
          drafts={draftSummaries}
          onRecover={(draft) => void recoverDraftSummary(draft)}
          onDelete={(draft) => void deleteDrafts([draft.id])}
          onDeleteAll={() => {
            const ids = draftSummaries.map((draft) => draft.id)
            if (ids.length === 0) return
            if (window.confirm(t('确定删除全部草稿吗？'))) {
              void deleteDrafts(ids).then(() => setDraftRecoveryOpen(false))
            }
          }}
          onClose={() => setDraftRecoveryOpen(false)}
        />
      )}

      {exportResultPath && (
        <ExportCompleteDialog
          path={exportResultPath}
          onConfirm={() => setExportResultPath(null)}
          onReveal={() => {
            const path = exportResultPath
            setExportResultPath(null)
            void desktop.reveal(path).catch((error: unknown) => {
              window.alert(
                (getLang() === 'en' ? 'Reveal failed:\n' : '打开所在文件夹失败：\n') +
                  (error as Error).message,
              )
            })
          }}
        />
      )}

      <Suspense fallback={null}>
        <UpdateNotice updater={updater} />
      </Suspense>
    </div>
  )
}
