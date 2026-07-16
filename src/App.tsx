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
import SidebarHeader from './components/SidebarHeader'
import TabBar from './components/TabBar'
import { classifyFile, fileExtension } from './lib/fileKind'
import { textLanguageLabel } from './lib/textLanguages'
import { textEditorBridge } from './lib/textEditorBridge'
import type { TextCursorInfo, TextViewState } from './components/TextEditor'

const MarkdownEditor = lazy(() =>
  import('./features/cm6-editor/MarkdownEditor').then(({ MarkdownEditor: Component }) => ({
    default: Component,
  })),
)
const TextEditor = lazy(() => import('./components/TextEditor'))
const Settings = lazy(() => import('./components/Settings'))
const UpdateNotice = lazy(() => import('./components/UpdateNotice'))
const EditorToolbar = lazy(() => import('./components/EditorToolbar'))
import Welcome from './components/Welcome'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import Outline from './components/Outline'
import FindBar from './components/FindBar'
import Lightbox from './components/Lightbox'
import ContextMenu, { type ContextMenuState, type MenuItem } from './components/ContextMenu'
import TableGridPicker from './components/TableGridPicker'
import InputDialog from './components/InputDialog'
import ExportCompleteDialog from './components/ExportCompleteDialog'
import DraftRecoveryDialog from './components/DraftRecoveryDialog'
import UnsavedChangesDialog, {
  type CloseDecision,
  type CloseReason,
} from './components/UnsavedChangesDialog'
import SearchPanel from './components/SearchPanel'
import CommandPalette from './components/CommandPalette'
import RelatedDocumentsSidebar from './features/tags/components/RelatedDocumentsSidebar'
import TagOverviewSidebar from './features/tags/components/TagOverviewSidebar'
import DocumentPropertyPanel from './features/tags/components/DocumentPropertyPanel'
import { t } from './lib/i18n'
import { ErrorCode } from './lib/errorCodes'
import { baseName, dirName } from './lib/path'
import { revealLocationKey } from './lib/platform'
import { replaceMovedPath } from './lib/treeDrag'
import type { SortContext } from './lib/fileTreeSort'
import { buildFrecencyRank } from './lib/recency'
import { parseOutline } from './lib/outline'
import { setCopyPreferences } from './lib/copyPreferences'
import { cm6ActiveViewBridge } from './features/cm6-editor/activeViewBridge'
import { reorderHeading, revealHeading } from './features/cm6-editor/outline'
import { tablePickerBridge } from './lib/tablePickerBridge'
import { linkPromptBridge } from './lib/linkPromptBridge'
import type { Folder, Tab } from './types'
import { useSettings } from './hooks/useSettings'
import { useNow } from './hooks/useNow'
import { useFileOps } from './hooks/useFileOps'
import { useTreeOps } from './hooks/useTreeOps'
import { useUpdater } from './hooks/useUpdater'
import { useDraftRecovery } from './hooks/useDraftRecovery'
import { useEditorContextMenu } from './hooks/useEditorContextMenu'
import { useExportActions } from './hooks/useExportActions'
import { useAppCommands } from './hooks/useAppCommands'
import { useNativeIntegration } from './hooks/useNativeIntegration'
import type { SettingsSection } from './components/Settings'
import { groupKeysToCollapse } from './features/tags/tagTree'
import { replaceMarkdownBody } from './features/tags/frontmatter'
import { useTagFeature } from './features/tags/useTagFeature'
import { resolveAssetURL } from './lib/asset'
import { headingOffsetForAnchor, resolveRelativeMarkdownLink } from './lib/linkNavigation'

const EMPTY_SHORTCUTS: Record<string, string> = {}
const EMPTY_STRING_ARRAY: string[] = []
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
/** 「最近打开」门控停留阈值：切到某文件停留超过这个毫秒数才算一次有效打开。 */
const DWELL_MS = 2500

export default function App(): JSX.Element {
  // ── Settings (theme, width, i18n, CSS side-effects all live here) ──────────
  const {
    settings,
    settingsReady,
    customCssError,
    backgroundImageError,
    saveSettings,
    recordDocOpen,
    recordDocEdit,
    recordDocRename,
    recordDocRemove,
    pushRecentFolder,
    toggleFavorite,
    togglePinnedFolder,
    togglePinnedTag,
    toggleTagCollapsed,
    setFavoritesCollapsed,
    setFavoriteLabel,
  } = useSettings()

  const lang = settings?.language ?? 'zh'
  const selectionToolbarEnabled = settings?.showSelectionToolbar
  const toggleSelectionToolbar = useCallback((): void => {
    if (selectionToolbarEnabled === undefined) return
    void saveSettings({ showSelectionToolbar: !selectionToolbarEnabled })
  }, [saveSettings, selectionToolbarEnabled])

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
    markTabPersisted,
    saveAsTab,
    moveTab,
    toggleTabLock,
    closeTab,
    closeOthers,
    closeAllTabs,
    closeLeft,
    closeRight,
    updateContent,
    restoreSession,
    confirmCloseTabs,
    closeTabsWithoutPrompt,
  } = useFileOps({ lang, requestCloseDecision, recordDocEdit })

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
  // 编辑器会在标签切换时卸载；滚动位置按标签保存。源码/实时预览共享同一个 CM6。
  // 使用 ref 避免滚动过程中触发整棵应用树重渲染。
  const wysiwygScrollPositions = useRef(new Map<string, number>())
  useEffect(() => {
    const openIds = new Set(tabs.map((tab) => tab.id))
    for (const id of wysiwygScrollPositions.current.keys()) {
      if (!openIds.has(id)) wysiwygScrollPositions.current.delete(id)
    }
  }, [tabs])

  // ── Panel widths (drag-to-resize) ──────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const [outlineWidth, setOutlineWidth] = useState(240)
  const [resultsWidth, setResultsWidth] = useState(300)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  const outlineWidthRef = useRef(outlineWidth)
  outlineWidthRef.current = outlineWidth
  const resultsWidthRef = useRef(resultsWidth)
  resultsWidthRef.current = resultsWidth

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

  const startResultsResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = resultsWidthRef.current
    const onMove = (ev: MouseEvent): void =>
      setResultsWidth(Math.max(200, Math.min(560, startW + ev.clientX - startX)))
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
    const tabPath = tab.path
    setSidebarVisible(true)
    setSearchView(false)
    const fileParent = dirName(tabPath)
    if (!fileParent) return
    const currentFolder = folderRef.current
    const favoriteFiles = new Set(settings?.favoriteFiles ?? [])
    const favoriteRoot = (settings?.favorites ?? [])
      .filter(
        (favorite) =>
          !favoriteFiles.has(favorite) &&
          (tabPath.startsWith(favorite + '/') || tabPath.startsWith(favorite + '\\')),
      )
      .sort((left, right) => right.length - left.length)[0]
    const isUnderFolder =
      currentFolder?.root &&
      (tabPath.startsWith(currentFolder.root + '/') ||
        tabPath.startsWith(currentFolder.root + '\\'))
    try {
      if (favoriteRoot && favoriteRoot !== currentFolder?.root) {
        const result = await desktop.openFolderPath(favoriteRoot)
        if (!result) return
        setFolder(result)
        pushRecentFolder(result.root)
      } else if (!isUnderFolder) {
        const result = await desktop.openContainingFolder(tabPath)
        if (!result) return
        setFolder(result)
        pushRecentFolder(result.root)
      }
      requestReveal(tabPath)
    } catch (error) {
      console.error('Reveal active file failed', error)
      void desktop.notify(t('无法定位文件所在目录'))
    }
  }, [pushRecentFolder, requestReveal, settings?.favoriteFiles, settings?.favorites])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  // 非 Markdown 文件走 CodeMirror TextEditor：按当前标签名判定内核。
  const activeKind = activeTab ? classifyFile(activeTab.name) : 'markdown'
  const isTextKind = activeKind === 'text'
  // TextEditor 的滚动/选区状态按标签缓存；光标位置提给底部状态栏展示。
  const textViewStates = useRef(new Map<string, TextViewState>())
  const [textCursor, setTextCursor] = useState<TextCursorInfo | null>(null)
  const captureActiveScroll = useCallback((): void => {
    if (!activeId) return
    const editor = document.querySelector<HTMLElement>('.xmd-cm-editor .cm-scroller')
    if (editor) wysiwygScrollPositions.current.set(activeId, editor.scrollTop)
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
  // 提为 useCallback 保持引用稳定，配合 Sidebar 的 memo() 避免每次击键都重渲染 Sidebar
  const openSidebarSettings = useCallback(() => setSettingsSection('appearance'), [])
  const [showFind, setShowFind] = useState(false)
  const [findInitial, setFindInitial] = useState('')
  const [findLine, setFindLine] = useState<number | undefined>(undefined)
  const [findMatchIndex, setFindMatchIndex] = useState<number | undefined>(undefined)
  // 文本文件的「查找替换」走 CodeMirror 自带面板（已汉化 + 贴合主题），不弹
  // Markdown 的 FindBar。⌘F/命令都会把 showFind 置真，这里改成打开 CM 搜索并复位。
  useEffect(() => {
    if (showFind && isTextKind) {
      textEditorBridge.openSearch()
      setShowFind(false)
    }
  }, [showFind, isTextKind])
  const [searchView, setSearchView] = useState(false)
  const openSidebarSearch = useCallback(() => setSearchView(true), [setSearchView])
  const [showPalette, setShowPalette] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [readingMode, setReadingMode] = useState(false)
  // 同样提为 useCallback：TabBar / Outline 用 memo() 包裹后，稳定的回调引用才能让 memo 生效
  const toggleSourceMode = useCallback(() => setSourceMode((v) => !v), [])
  const toggleSidebarVisible = useCallback(() => setSidebarVisible((v) => !v), [setSidebarVisible])
  const toggleOutlineVisible = useCallback(() => setOutlineVisible((v) => !v), [])
  const toggleReadingMode = useCallback(() => setReadingMode((v) => !v), [])
  const closeOutline = useCallback(() => setOutlineVisible(false), [])
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null)
  const openEditorContext = useEditorContextMenu(setCtxMenu)
  const [tablePicker, setTablePicker] = useState<{
    x: number
    y: number
    onInsert: (r: number, c: number) => void
  } | null>(null)
  useEffect(() => {
    tablePickerBridge.setHandler((x, y, onInsert) => setTablePicker({ x, y, onInsert }))
    return () => tablePickerBridge.setHandler(null)
  }, [])
  const [inputDialog, setInputDialog] = useState<{
    title: string
    initial?: string
    confirmText?: string
    onSubmit: (value: string) => void
  } | null>(null)
  useEffect(() => {
    linkPromptBridge.setHandler((initial, onSubmit) =>
      setInputDialog({ title: t('插入链接'), initial, confirmText: t('插入'), onSubmit }),
    )
    return () => linkPromptBridge.setHandler(null)
  }, [])
  const [exportResultPath, setExportResultPath] = useState<string | null>(null)

  const updater = useUpdater(settings?.checkUpdatesOnStartup ?? false)

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
        void desktop.notify(t('文件夹不存在：\n') + root)
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
        void desktop.notify(t('无法打开上级文件夹'))
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
  const {
    treeKey,
    refreshTree,
    openNodeContext,
    openRootContext,
    expandedPathsRef,
    updateExpandedAfterMove,
    pushUndo,
    canUndo,
    undoLastOp,
  } = useTreeOps({
    folder,
    setFolder: setFolderUpdater,
    openPath,
    confirmCloseTabs,
    closeTabsWithoutPrompt,
    tabs,
    setTabs,
    openParentFolder,
    chooseFolderFrom,
    pinnedFolders: settings?.pinnedFolders ?? EMPTY_STRING_ARRAY,
    togglePinnedFolder,
    favorites: settings?.favorites ?? EMPTY_STRING_ARRAY,
    toggleFavorite,
    recordDocRename,
    recordDocRemove,
    setCtxMenu,
    setInputDialog,
  })

  const {
    tagIndex,
    tagNavigation,
    tagTree,
    relatedDocuments,
    activeFrontmatter,
    activeProperties,
    inlineOnlyTags,
    hasBodyHeading,
    openDocumentTag,
    openTreeTag,
    showAllTags,
    openTagContext,
    openDocTagContext,
    moveTagUnder,
    changeDocumentProperties,
  } = useTagFeature({
    activeTab,
    folder,
    settings,
    treeKey,
    lang,
    stateRef,
    updateContent,
    markTabPersisted,
    saveTab,
    pushUndo,
    togglePinnedTag,
    setSidebarVisible,
    setSearchView,
    setInputDialog,
    setCtxMenu,
  })

  const deferredOutlineContent = useDeferredValue(
    outlineVisible && activeTab ? activeFrontmatter.body : '',
  )
  const outline = useMemo(
    () => (outlineVisible && deferredOutlineContent ? parseOutline(deferredOutlineContent) : []),
    [deferredOutlineContent, outlineVisible],
  )
  // frecency 衰减用的“现在”，周期刷新；避免在 render 里直接调 Date.now()。
  const now = useNow()
  // 文件树排序上下文：排序方式 + 置顶集合 + frecency 排名。集中在此计算，
  // 逐层传给 FileTree，避免每个节点各自重建 Set/Map。排名由 recentDocs 语料按
  // frecency 算出，并把当前打开的 tab 加权置顶（见 lib/recency.ts）。
  const fileTreeSortContext = useMemo<SortContext>(() => {
    const openTabPaths = new Set(tabs.flatMap((tab) => (tab.path ? [tab.path] : [])))
    return {
      mode: settings?.fileTreeSort ?? 'default',
      pinnedPaths: new Set(settings?.pinnedFolders ?? []),
      recentRank: buildFrecencyRank(settings?.recentDocs ?? [], now, openTabPaths),
    }
  }, [
    settings?.fileTreeSort,
    settings?.pinnedFolders,
    settings?.recentDocs,
    tabPathsKey,
    tabs,
    now,
  ])

  // 「最近打开」门控：切到某文件后停留 ≥ DWELL_MS 才算一次有效打开，过滤误点/快速翻找。
  // 依赖 activeTab?.path（原始值，敲字不变），切换/关闭会清掉计时器。
  const activeTabPath = activeTab?.path ?? null
  useEffect(() => {
    if (!activeTabPath) return
    const id = setTimeout(() => recordDocOpen(activeTabPath), DWELL_MS)
    return () => clearTimeout(id)
  }, [activeTabPath, recordDocOpen])

  // 首次编辑 = 强交互信号，立刻记录，跳过停留门控。dirty 由 false→true 只触发一次。
  const activeTabDirty = activeTab?.dirty ?? false
  useEffect(() => {
    if (activeTabPath && activeTabDirty) recordDocOpen(activeTabPath)
  }, [activeTabPath, activeTabDirty, recordDocOpen])

  const workspaceVisibilityKey = settings
    ? `${settings.showAllFiles}:${settings.visibleTextExtensions.join(',')}:${settings.hiddenWorkspacePaths.join('\0')}`
    : ''
  useEffect(() => {
    if (!workspaceVisibilityKey) return
    void refreshTree()
  }, [workspaceVisibilityKey, refreshTree])

  // 把复制控制设置推给剪贴板逻辑（richClipboard 等非 React
  // 环境，copy 发生时同步读取这个单例）。
  useEffect(() => {
    setCopyPreferences({
      imageCopyMode: settings?.imageCopyMode ?? 'image',
      mermaidCopyMode: settings?.mermaidCopyMode ?? 'image',
    })
  }, [settings?.imageCopyMode, settings?.mermaidCopyMode])

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
      const tab = list[idx]
      const items: MenuItem[] = [
        {
          label: tab?.locked ? t('取消固定') : t('固定标签'),
          onClick: () => toggleTabLock(id),
        },
      ]
      if (!tab?.locked)
        items.push({ label: t('关闭'), onClick: () => void closeTab(id), separatorBefore: true })
      items.push({
        label: t('关闭其他'),
        onClick: () => void closeOthers(id),
        separatorBefore: !tab?.locked,
      })
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
    [toggleTabLock, closeTab, closeOthers, closeLeft, closeRight, closeAllTabs],
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
  const scrollToHeading = useCallback(
    (index: number) => {
      const item = outline[index]
      const view = cm6ActiveViewBridge.get()
      if (!view || !item) return
      revealHeading(view, item.offset)
    },
    [outline],
  )

  const reorderSection = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (readingMode || fromIndex === toIndex) return
      const view = cm6ActiveViewBridge.get()
      if (!view) return
      reorderHeading(view, fromIndex, toIndex)
    },
    [readingMode],
  )

  useEffect(() => {
    const openRelativeLink = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { href?: unknown } | null
      if (typeof detail?.href !== 'string') return
      const active = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeId)
      const target = resolveRelativeMarkdownLink(detail.href, active?.path ?? null)
      if (!target) return

      if (target.kind === 'anchor') {
        const view = cm6ActiveViewBridge.get()
        if (!view) return
        const offset = headingOffsetForAnchor(view.state.doc.toString(), target.anchor)
        if (offset !== null) revealHeading(view, offset)
        return
      }

      void openPath(target.path, baseName(target.path)).then(() => {
        if (!target.anchor) return
        // Wait for the newly selected tab's EditorView to mount before resolving
        // its source heading. The active path guard prevents a late callback from
        // navigating a different tab if the user switches again immediately.
        window.setTimeout(() => {
          const current = stateRef.current.tabs.find((tab) => tab.id === stateRef.current.activeId)
          if (current?.path !== target.path) return
          const view = cm6ActiveViewBridge.get()
          if (!view) return
          const offset = headingOffsetForAnchor(view.state.doc.toString(), target.anchor ?? '')
          if (offset !== null) revealHeading(view, offset)
        }, 0)
      })
    }
    document.addEventListener('xmd-relative-link', openRelativeLink)
    return () => document.removeEventListener('xmd-relative-link', openRelativeLink)
  }, [openPath, stateRef])

  const { exportHTML, exportPDF, exportImage, exportDocx } = useExportActions(
    stateRef,
    setExportResultPath,
  )

  // ── 导入 Word 文档 ──────────────────────────────────────────────────────────
  // 把 attachmentFolder 提取到 useCallback 外，避免 React Compiler
  // 误把 settings?.attachmentFolder 的依赖追踪提升为整个 settings 对象。
  const docxMediaSubdir = settings?.pandocMediaFolder || settings?.attachmentFolder || 'assets'
  const importDocx = useCallback(async () => {
    const status = await desktop.pandocStatus()
    if (!status) {
      const confirmed = await desktop.confirm(
        t('未检测到 Pandoc，导入 Word 需要安装 Pandoc。是否打开下载页面？'),
        t('未找到 Pandoc'),
        t('打开下载页面'),
        t('取消'),
      )
      if (confirmed) {
        await desktop.openExternal('https://pandoc.org/installing.html')
      }
      return
    }
    try {
      const result = await desktop.importDocx(docxMediaSubdir)
      if (!result) return
      await openPath(result.markdownPath, baseName(result.markdownPath))
      await refreshTree()
    } catch (error) {
      void desktop.notify(t('Word 导入失败：\n') + (error as Error).message)
    }
  }, [docxMediaSubdir, openPath, refreshTree])

  // ── File tree move (drag-and-drop) ────────────────────────────────────────
  const moveTreeItem = useCallback(
    async (sourcePath: string, targetDirPath: string) => {
      const originalDir = dirName(sourcePath)
      const originalName = baseName(sourcePath)
      try {
        const res = await desktop.moveItem(sourcePath, targetDirPath)
        updateExpandedAfterMove(sourcePath, res.path)
        setTabs((prev) =>
          prev.map((tab) => {
            if (!tab.path) return tab
            const newPath = replaceMovedPath(tab.path, sourcePath, res.path)
            return newPath === tab.path
              ? tab
              : { ...tab, path: newPath, name: baseName(newPath) || res.name }
          }),
        )
        if (originalDir && originalDir !== targetDirPath) {
          pushUndo({ type: 'move', fromPath: res.path, toDir: originalDir, toName: originalName })
        }
        await refreshTree()
        requestReveal(res.path)
      } catch (err) {
        void desktop.notify(t('移动失败：\n') + (err as Error).message)
      }
    },
    [refreshTree, requestReveal, setTabs, updateExpandedAfterMove, pushUndo],
  )

  // ── File tree Cmd+Z ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
      const isUndo = isMac
        ? e.metaKey && !e.shiftKey && e.key === 'z'
        : e.ctrlKey && !e.shiftKey && e.key === 'z'
      if (!isUndo || !canUndo) return
      // Let the editor handle its own undo when focused.
      const active = document.activeElement
      if (active?.closest('.cm-editor, input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      void undoLastOp()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canUndo, undoLastOp])

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
    exportDocx,
    importDocx,
    setShowPalette,
    setSidebarVisible,
    setSearchView,
    setShowFind,
    setOutlineVisible,
    setSourceMode,
    setFocusMode,
    setTypewriterMode,
    toggleSelectionToolbar,
    setSettingsSection,
  })
  // ── Auto-save ─────────────────────────────────────────────────────────────
  // Only the active tab participates; background dirty tabs are protected by
  // useDraftRecovery snapshots, which fire independently every 1.2 s / 5 s.
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
    exportDocx,
    importDocx,
    checkForUpdates: updater.checkNow,
    clearRuntimeDrafts,
    deleteDrafts,
    requestCloseDecision,
    saveTab,
  })
  // Don't render until settings are loaded (avoids flash of wrong theme/width)
  if (!settings) {
    return (
      <div className="app">
        <TitleBar />
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar
        documentName={activeTab?.name}
        dirty={activeTab?.dirty}
        shortcuts={settings.shortcuts}
        onOpenAbout={() => setSettingsSection('about')}
      />
      <div className="workspace-shell">
        {sidebarVisible && (
          <div className="sidebar-wrap" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
            {tagNavigation.overviewOpen ? (
              <aside className="sidebar">
                <SidebarHeader
                  folder={folder}
                  isFav={folder ? settings.favorites.includes(folder.root) : false}
                  canUndo={canUndo}
                  showOpenFolderButton={settings.showOpenFolderButton}
                  showSettingsButton={settings.showSettingsButton}
                  onUndo={undoLastOp}
                  onToggleFavorite={toggleFavorite}
                  onRefresh={refreshTree}
                  onOpenSearch={openSidebarSearch}
                  onShowTags={showAllTags}
                  onOpenFolder={openFolder}
                  onOpenSettings={openSidebarSettings}
                  onRootContext={openRootContext}
                />
                {/* 标签树常驻左侧；点某个标签后，它的文档在中间“结果列”展示。 */}
                <TagOverviewSidebar
                  tree={tagTree}
                  pinnedTags={settings.pinnedTags ?? []}
                  collapsedKeys={settings.tagCollapsedKeys ?? []}
                  activeTag={tagNavigation.selectedTag}
                  loading={tagIndex.loading}
                  error={tagIndex.error}
                  onClose={tagNavigation.hideOverview}
                  onOpenTag={openTreeTag}
                  onTogglePin={togglePinnedTag}
                  onToggleCollapsed={toggleTagCollapsed}
                  onTagContext={openTagContext}
                  onMoveTag={moveTagUnder}
                />
              </aside>
            ) : (
              <Sidebar
                folder={folder}
                activePath={activeTab?.path ?? null}
                favorites={settings.favorites}
                favoriteFiles={settings.favoriteFiles ?? []}
                favoritesCollapsed={settings.favoritesCollapsed}
                favoriteLabels={settings.favoriteLabels}
                sortContext={fileTreeSortContext}
                revealPath={revealPath}
                revealRequestId={revealRequestId}
                onRevealComplete={handleRevealComplete}
                hideAttachmentFolders={settings.hideAttachmentFolders ?? false}
                attachmentFolder={settings.attachmentFolder || 'assets'}
                onOpenFolder={openFolder}
                onOpenFolderPath={openFolderByPath}
                onOpenFile={openPath}
                onOpenSettings={openSidebarSettings}
                showOpenFolderButton={settings.showOpenFolderButton}
                showSettingsButton={settings.showSettingsButton}
                onOpenSearch={openSidebarSearch}
                onShowTags={showAllTags}
                onToggleFavorite={toggleFavorite}
                onFavoritesCollapsedChange={setFavoritesCollapsed}
                onFavoriteContext={openFavoriteContext}
                onRefresh={refreshTree}
                onNodeContext={openNodeContext}
                onRootContext={openRootContext}
                onMove={moveTreeItem}
                reloadKey={treeKey}
                expandedPathsRef={expandedPathsRef}
                canUndo={canUndo}
                onUndo={undoLastOp}
              />
            )}
            <div className="resize-handle" onMouseDown={startSidebarResize} />
          </div>
        )}

        {/* 中间“结果列”：全文搜索结果 或 点某个标签后的文档列表。可拖宽，关掉即隐藏。 */}
        {(searchView && folder) || tagNavigation.selectedTag ? (
          <div className="results-wrap" style={{ width: resultsWidth, minWidth: resultsWidth }}>
            {searchView && folder ? (
              <SearchPanel
                root={folder.root}
                onOpenResult={openSearchResult}
                onBack={() => setSearchView(false)}
              />
            ) : (
              <RelatedDocumentsSidebar
                tag={
                  tagIndex.tagLabels[tagNavigation.selectedTag ?? ''] ??
                  tagNavigation.selectedTag ??
                  ''
                }
                documents={relatedDocuments}
                activePath={activeTab?.path ?? null}
                folderName={folder?.name ?? null}
                loading={tagIndex.loading}
                error={tagIndex.error}
                overviewOpen={tagNavigation.overviewOpen}
                onShowAllTags={showAllTags}
                onClose={tagNavigation.closeResults}
                onOpenDocument={(path, name) => void openPath(path, name)}
              />
            )}
            <div className="resize-handle" onMouseDown={startResultsResize} />
          </div>
        ) : null}

        <div className={`main${sidebarVisible ? '' : ' no-sidebar'}`}>
          <TabBar
            tabs={tabs}
            activeId={activeId}
            onSelect={selectTab}
            onClose={closeTab}
            onMoveTab={moveTab}
            onTabContext={openTabContext}
            onShowWelcome={showWelcome}
            outlineVisible={outlineVisible}
            onToggleSidebar={toggleSidebarVisible}
            onToggleOutline={toggleOutlineVisible}
            onRevealFile={revealActiveFile}
            activeHasPath={!!activeTab?.path}
            showRevealButton={settings.showRevealButton}
          />

          {showFind && !isTextKind && (
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

          {settings.showToolbar && !isTextKind && !sourceMode && !readingMode && activeTab && (
            <Suspense fallback={null}>
              <EditorToolbar lang={settings.language} />
            </Suspense>
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
                  : target.closest('[data-xmd-image]')?.querySelector('img')
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
                  : target?.closest('[data-xmd-image]')?.querySelector<HTMLImageElement>('img')
              openEditorContext(e.clientX, e.clientY, image ?? undefined)
            }}
          >
            {activeTab ? (
              isTextKind ? (
                <Suspense fallback={<div className="editor-loading" />}>
                  <TextEditor
                    // 扩展名进 key：同 id 改扩展名（另存为）时重挂载，让折叠栏 /
                    // JSON 按钮 / 自动换行默认按新语言重算（这些只在挂载时定型）。
                    key={activeTab.id + '-text-' + fileExtension(activeTab.name)}
                    content={activeTab.content}
                    fileName={activeTab.name}
                    readOnly={readingMode}
                    initialState={textViewStates.current.get(activeTab.id)}
                    onStateChange={(state) => textViewStates.current.set(activeTab.id, state)}
                    onCursorChange={setTextCursor}
                    onChange={(raw) => updateContent(activeTab.id, raw)}
                    onOpenWithDefaultApp={
                      activeTab.path
                        ? () => void desktop.openWithDefault(activeTab.path as string)
                        : undefined
                    }
                  />
                </Suspense>
              ) : (
                <Suspense fallback={<div className="editor-loading" />}>
                  <MarkdownEditor
                    key={activeTab.id}
                    content={activeFrontmatter.body}
                    livePreview={!sourceMode}
                    resolveImageSrc={(src) =>
                      resolveAssetURL(
                        activeDocDir,
                        src,
                        folder?.root ?? null,
                        settings.assetSearchPaths ?? [],
                        settings.allowRemoteImages ?? false,
                      )
                    }
                    allowRemoteImages={settings.allowRemoteImages ?? false}
                    codeBlockLineWrapping={settings.codeBlockLineWrapping ?? false}
                    imageMaxWidth={settings.imageMaxWidth}
                    uploadImage={async (file) => {
                      if (!activeTab.path || !activeDocDir) {
                        throw new Error(t('请先保存文档，再插入本地图片。'))
                      }
                      if (file.size > MAX_ATTACHMENT_BYTES) {
                        throw new Error(t('单个附件不能超过 20 MB。'))
                      }
                      const result = await desktop.saveAttachment(
                        activeDocDir,
                        activeTab.name,
                        folder?.root ?? null,
                        file.name,
                        new Uint8Array(await file.arrayBuffer()),
                      )
                      return result.relPath
                    }}
                    onImageError={(error) => {
                      const message = error instanceof Error ? error.message : String(error)
                      void desktop.notify(message)
                    }}
                    focusMode={focusMode}
                    typewriterMode={typewriterMode}
                    previewThemeVersion={settings.theme}
                    tagBar={
                      <>
                        <DocumentPropertyPanel
                          properties={activeProperties}
                          inlineTags={inlineOnlyTags}
                          activeTag={tagNavigation.selectedTag}
                          disabled={readingMode}
                          onSelectTag={openDocumentTag}
                          onTagContext={openDocTagContext}
                          onChange={changeDocumentProperties}
                        />
                        {!hasBodyHeading && activeFrontmatter.title && (
                          <div className="document-title-fallback">{activeFrontmatter.title}</div>
                        )}
                      </>
                    }
                    readingMode={readingMode}
                    initialScrollTop={wysiwygScrollPositions.current.get(activeTab.id) ?? 0}
                    onScrollTopChange={(scrollTop) =>
                      wysiwygScrollPositions.current.set(activeTab.id, scrollTop)
                    }
                    onChange={(body) => {
                      // Frontmatter/property edits and CM6 transactions can be
                      // dispatched in the same tick. Merge the editor body into
                      // the authoritative tab snapshot, not this render's closure,
                      // so neither side can overwrite a newer update.
                      const current = stateRef.current.tabs.find((tab) => tab.id === activeTab.id)
                      if (current) {
                        updateContent(current.id, replaceMarkdownBody(current.content, body))
                      }
                    }}
                  />
                </Suspense>
              )
            ) : (
              <Welcome
                recentFiles={settings.recentFiles}
                recentFolders={settings.recentFolders}
                pinnedTags={settings.pinnedTags ?? []}
                tagLabels={tagIndex.tagLabels}
                onOpenFolder={openFolder}
                onOpenFile={openFile}
                onNewFile={newFile}
                onOpenRecentFile={(p) => openPath(p, baseName(p))}
                onOpenRecentFolder={openFolderByPath}
                onOpenPinnedTag={openTreeTag}
                draftCount={draftSummaries.length}
                onOpenDrafts={() => setDraftRecoveryOpen(true)}
              />
            )}

            {outlineVisible && activeTab && !isTextKind && (
              <>
                <div className="resize-handle" onMouseDown={startOutlineResize} />
                <Outline
                  items={outline}
                  onSelect={scrollToHeading}
                  onReorder={reorderSection}
                  onClose={closeOutline}
                  readOnly={readingMode}
                  width={outlineWidth}
                />
              </>
            )}
          </div>

          {settings.showStatusBar && (
            <StatusBar
              tab={activeTab}
              sourceMode={sourceMode}
              focusMode={focusMode}
              typewriterMode={typewriterMode}
              autoSave={settings.autoSave}
              readingMode={readingMode}
              showPath={settings.showStatusPath}
              showReadingModeControl={settings.showReadingModeControl}
              showSourceModeControl={settings.showSourceModeControl && !isTextKind}
              textStatus={
                isTextKind
                  ? { info: textCursor, language: textLanguageLabel(activeTab?.name ?? '') }
                  : null
              }
              onToggleReading={toggleReadingMode}
              onToggleSource={toggleSourceMode}
            />
          )}
        </div>
      </div>

      {settingsSection && (
        <Suspense fallback={null}>
          <Settings
            key={settingsSection}
            settings={settings}
            updater={updater}
            customCssError={customCssError}
            backgroundImageError={backgroundImageError}
            initialSection={settingsSection}
            onChange={(patch) => {
              // 改「默认展开层级」时，按当前标签树重算折叠集合，让新层级立刻生效。
              const effective =
                patch.tagDefaultExpandDepth !== undefined
                  ? {
                      ...patch,
                      tagCollapsedKeys: groupKeysToCollapse(tagTree, patch.tagDefaultExpandDepth),
                    }
                  : patch
              void saveSettings(effective).catch((error: unknown) => {
                const readOnly =
                  typeof error === 'object' &&
                  error !== null &&
                  'code' in error &&
                  error.code === ErrorCode.SETTINGS_READ_ONLY
                void desktop.notify(
                  readOnly ? t('这些设置来自更高版本，当前以只读模式运行。') : t('设置保存失败。'),
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

      {tablePicker && (
        <TableGridPicker
          x={tablePicker.x}
          y={tablePicker.y}
          onInsert={tablePicker.onInsert}
          onClose={() => setTablePicker(null)}
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
            void desktop
              .confirm(t('确定删除全部草稿吗？'), t('删除全部草稿'), t('删除'), t('取消'))
              .then((confirmed) => {
                if (confirmed) void deleteDrafts(ids).then(() => setDraftRecoveryOpen(false))
              })
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
              void desktop.notify(t('打开所在文件夹失败：\n') + (error as Error).message)
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
