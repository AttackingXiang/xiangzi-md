import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type SetStateAction,
} from 'react'
import { desktop, isBrowserPreview } from './platform'
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
const Lightbox = lazy(() => import('./components/Lightbox'))
const TableZoomModal = lazy(() => import('./components/TableZoomModal'))

// On-demand overlays. These only ever render behind a `{condition && …}` guard, so importing
// them eagerly meant the whole app paid their parse cost at startup for UI a given session may
// never open. Measured: moving this group out of the entry chunk takes it from 210 KiB to
// 136 KiB gzip.
//
// The rule for adding to this list: the component renders only in response to an explicit user
// action (a dialog, a palette, a picker), and one extra frame before it appears is acceptable.
// Anything on a latency-sensitive path — see ContextMenu below — stays eagerly imported.
const CommandPalette = lazy(() => import('./components/CommandPalette'))
const TableGridPicker = lazy(() => import('./components/TableGridPicker'))
const InputDialog = lazy(() => import('./components/InputDialog'))
const UnsavedChangesDialog = lazy(() => import('./components/UnsavedChangesDialog'))
const ExternalChangeDialog = lazy(() => import('./components/ExternalChangeDialog'))
const ClipboardPathDialog = lazy(() => import('./components/ClipboardPathDialog'))
const DraftRecoveryDialog = lazy(() => import('./components/DraftRecoveryDialog'))
const RecentItemsDialog = lazy(() => import('./components/RecentItemsDialog'))
const ExportCompleteDialog = lazy(() => import('./components/ExportCompleteDialog'))
const SearchPanel = lazy(() => import('./components/SearchPanel'))
const RelatedDocumentsSidebar = lazy(
  () => import('./features/tags/components/RelatedDocumentsSidebar'),
)
const TagOverviewSidebar = lazy(() => import('./features/tags/components/TagOverviewSidebar'))
const DocumentPropertyPanel = lazy(() => import('./features/tags/components/DocumentPropertyPanel'))
import Welcome from './components/Welcome'
import StatusBar from './components/StatusBar'
import TitleBar from './components/TitleBar'
import MacWindowBar from './components/MacWindowBar'
const Outline = lazy(() => import('./components/Outline'))
const FindBar = lazy(() => import('./components/FindBar'))
// ContextMenu stays eager on purpose: right-click expects the menu on the very next frame,
// and a chunk boundary there is the one place the delay would actually be felt.
import ContextMenu, { type ContextMenuState, type MenuItem } from './components/ContextMenu'
import ExportProgressToast from './components/ExportProgressToast'
import { ModalFallback, PanelFallback } from './components/LoadingFallback'
import ExternalChangeBanner from './components/ExternalChangeBanner'
import ExternalReloadToast from './components/ExternalReloadToast'
import CopyFeedbackToast from './components/CopyFeedbackToast'
import CodeLanguageFeedbackToast from './components/CodeLanguageFeedbackToast'
import type { CloseDecision, CloseReason } from './components/UnsavedChangesDialog'
import { t, tf } from './lib/i18n'
import { ErrorCode } from './lib/errorCodes'
import { baseName, dirName } from './lib/path'
import { clipboardPath } from './lib/clipboardPath'
import { currentDesktopPlatform, revealLocationKey } from './lib/platform'
import { HIDDEN_SIDEBAR_CONTROLS, sidebarControlsFromSettings } from './lib/sidebarControls'
import { recordContentChanges } from './lib/searchReload'
import type { FolderSearchMode, PathStat } from './platform/contracts'
import { replaceMovedPath } from './lib/treeDrag'
import { documentPathKey, isPathAtOrUnder, sameDocumentPath } from './lib/pathIdentity'
import type { SortContext } from './lib/fileTreeSort'
import { buildFrecencyRank } from './lib/recency'
import { parseOutline } from './lib/outline'
import { setCopyPreferences } from './lib/copyPreferences'
import { subscribeCopyFeedback, type CopyFeedbackDetail } from './lib/copyFeedback'
import { subscribeCodeLanguageFeedback } from './lib/codeLanguageFeedback'
import { clipboardCmd } from './lib/editorCommands'
import { cm6ActiveViewBridge } from './features/cm6-editor/activeViewBridge'
import { reorderHeading, revealHeading } from './features/cm6-editor/outline'
import { tablePickerBridge } from './lib/tablePickerBridge'
import { tableZoomBridge } from './lib/tableZoomBridge'
import { linkPromptBridge } from './lib/linkPromptBridge'
import { editorZoomSource } from './lib/editorZoom'
import type { AppSettings, FileTreeSort, Folder, Tab } from './types'
import type { RecentItemsSection } from './components/RecentItemsDialog'
import { useSettings } from './hooks/useSettings'
import { useNow } from './hooks/useNow'
import { useFileOps } from './hooks/useFileOps'
import { useTreeOps } from './hooks/useTreeOps'
import { useUpdater } from './hooks/useUpdater'
import { useDraftRecovery } from './hooks/useDraftRecovery'
import { useEditorContextMenu } from './hooks/useEditorContextMenu'
import { useExportActions, type ExportActivity } from './hooks/useExportActions'
import { useAppCommands } from './hooks/useAppCommands'
import { useNativeIntegration } from './hooks/useNativeIntegration'
import { hasEditor, onEditorAvailable, searchMountedEditor } from './lib/searchBridge'
import { useResizablePanels } from './hooks/useResizablePanels'
import { useFolderSearch } from './hooks/useFolderSearch'
import ResizeHandle from './components/ResizeHandle'
import type { SidebarMode } from './lib/sidebarMode'
import { useWorkspaceSession } from './hooks/useWorkspaceSession'
import type { SettingsSection } from './components/Settings'
import { groupKeysToCollapse } from './features/tags/tagTree'
import { replaceMarkdownBody } from './features/tags/frontmatter'
import { useTagFeature } from './features/tags/useTagFeature'
import { blobPartFromBytes, imageMimeTypeFromBytes, resolveAssetURL } from './lib/asset'
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
    themeRenderVersion,
    customCssError,
    backgroundImageError,
    settingsSaving,
    settingsSaveError,
    saveSettings,
    persistSettingsInBackground,
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
  const persistUserSettings = useCallback(
    (patch: Partial<AppSettings>): void => {
      void saveSettings(patch).catch((error: unknown) => {
        const readOnly =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === ErrorCode.SETTINGS_READ_ONLY
        void desktop.notify(
          readOnly ? t('这些设置来自更高版本，当前以只读模式运行。') : t('设置保存失败。'),
        )
      })
    },
    [saveSettings],
  )
  const selectionToolbarEnabled = settings?.showSelectionToolbar
  const toggleSelectionToolbar = useCallback((): void => {
    if (selectionToolbarEnabled === undefined) return
    persistUserSettings({ showSelectionToolbar: !selectionToolbarEnabled })
  }, [persistUserSettings, selectionToolbarEnabled])
  const toolbarEnabled = settings?.showToolbar
  const toggleToolbar = useCallback((): void => {
    if (toolbarEnabled === undefined) return
    persistUserSettings({ showToolbar: !toolbarEnabled })
  }, [persistUserSettings, toolbarEnabled])
  const saveDefaultHighlightColor = useCallback(
    (defaultHighlightColor: string): void => {
      if (settings?.defaultHighlightColor === defaultHighlightColor) return
      persistUserSettings({ defaultHighlightColor })
    },
    [persistUserSettings, settings?.defaultHighlightColor],
  )

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
    checkExternalChanges,
    reloadTabFromDisk,
    overwriteExternalTab,
    externalReloadNotice,
    dismissExternalReloadNotice,
  } = useFileOps({ lang, requestCloseDecision, recordDocEdit })
  const [externalReviewId, setExternalReviewId] = useState<string | null>(null)
  const externalReviewTab = externalReviewId
    ? (tabs.find((tab) => tab.id === externalReviewId) ?? null)
    : null
  const externalReviewSnapshot =
    externalReviewTab?.diskState?.kind === 'changed' ? externalReviewTab.diskState.snapshot : null

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
  const remoteImageCacheRef = useRef({
    generation: 0,
    urls: new Map<string, string>(),
    pending: new Map<string, Promise<string | null>>(),
  })
  const clearRemoteImageCache = useCallback((): void => {
    const cache = remoteImageCacheRef.current
    cache.generation += 1
    for (const url of cache.urls.values()) URL.revokeObjectURL(url)
    cache.urls.clear()
    cache.pending.clear()
  }, [])
  useEffect(() => clearRemoteImageCache, [clearRemoteImageCache])
  useEffect(() => {
    if (!settings?.allowRemoteImages) clearRemoteImageCache()
  }, [clearRemoteImageCache, settings?.allowRemoteImages])

  const resolveEditorImageSrc = useCallback(
    (src: string): Promise<string | null> | string => {
      const allowRemote = settings?.allowRemoteImages ?? false
      if (!isBrowserPreview && allowRemote && /^https?:/i.test(src)) {
        const cache = remoteImageCacheRef.current
        const ready = cache.urls.get(src)
        if (ready) return ready
        const existing = cache.pending.get(src)
        if (existing) return existing
        const generation = cache.generation
        const request = desktop
          .readRemoteImage(src)
          .then((bytes) => {
            if (remoteImageCacheRef.current.generation !== generation) return null
            const objectUrl = URL.createObjectURL(
              new Blob([blobPartFromBytes(bytes)], {
                type: imageMimeTypeFromBytes(bytes, src),
              }),
            )
            const urls = remoteImageCacheRef.current.urls
            urls.set(src, objectUrl)
            while (urls.size > 128) {
              const oldest = urls.entries().next().value
              if (!oldest) break
              urls.delete(oldest[0])
              URL.revokeObjectURL(oldest[1])
            }
            return objectUrl
          })
          .catch(() => null)
          .finally(() => {
            if (remoteImageCacheRef.current.pending.get(src) === request) {
              remoteImageCacheRef.current.pending.delete(src)
            }
          })
        cache.pending.set(src, request)
        return request
      }
      return resolveAssetURL(
        activeDocDir,
        src,
        folder?.root ?? null,
        settings?.assetSearchPaths ?? [],
        allowRemote,
      )
    },
    [activeDocDir, folder?.root, settings?.allowRemoteImages, settings?.assetSearchPaths],
  )
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
  // 宽度跟 sidebarVisible 一样记忆下来：一个记住开合、一个每次启动弹回 256px 的
  // 组合，用户是能察觉到的。只在拖动结束/复位时写盘，不是每一帧。
  const persistPanelWidths = useCallback(
    (widths: { sidebarWidth?: number; resultsWidth?: number; outlineWidth?: number }): void => {
      persistUserSettings(widths)
    },
    [persistUserSettings],
  )
  const {
    sidebar: sidebarPanel,
    results: resultsPanel,
    outline: outlinePanel,
  } = useResizablePanels({
    sidebarWidth: settings?.sidebarWidth ?? null,
    resultsWidth: settings?.resultsWidth ?? null,
    outlineWidth: settings?.outlineWidth ?? null,
    onPersist: persistPanelWidths,
  })

  // ── Sidebar visibility ─────────────────────────────────────────────────────
  // The persisted value is loaded asynchronously. Keep the app shell behind the
  // existing settings-loading gate until it has been applied, so a saved-open
  // sidebar does not flash closed on startup.
  const [sidebarVisible, setSidebarVisibleState] = useState(false)
  const [sidebarVisibilityReady, setSidebarVisibilityReady] = useState(false)
  const sidebarVisibleRef = useRef(false)
  const setSidebarVisible = useCallback(
    (value: SetStateAction<boolean>): void => {
      const next = typeof value === 'function' ? value(sidebarVisibleRef.current) : value
      sidebarVisibleRef.current = next
      setSidebarVisibleState(next)
      persistUserSettings({ sidebarVisible: next })
    },
    [persistUserSettings],
  )
  useEffect(() => {
    if (!settingsReady || !settings) return
    sidebarVisibleRef.current = settings.sidebarVisible
    setSidebarVisibleState(settings.sidebarVisible)
    setSidebarVisibilityReady(true)
  }, [settingsReady, settings?.sidebarVisible])

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
    setSidebarMode('files')
    const fileParent = dirName(tabPath)
    if (!fileParent) return
    const currentFolder = folderRef.current
    const favoriteFiles = new Set((settings?.favoriteFiles ?? []).map(documentPathKey))
    const favoriteRoot = (settings?.favorites ?? [])
      .filter(
        (favorite) =>
          !favoriteFiles.has(documentPathKey(favorite)) && isPathAtOrUnder(tabPath, favorite),
      )
      .sort((left, right) => right.length - left.length)[0]
    const isUnderFolder = currentFolder?.root && isPathAtOrUnder(tabPath, currentFolder.root)
    try {
      if (
        favoriteRoot &&
        (!currentFolder?.root || !sameDocumentPath(favoriteRoot, currentFolder.root))
      ) {
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
  }, [
    pushRecentFolder,
    requestReveal,
    setSidebarVisible,
    settings?.favoriteFiles,
    settings?.favorites,
  ])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [outlineVisible, setOutlineVisible] = useState(false)
  const [sourceMode, setSourceMode] = useState(false)
  const [clipboardPathPrompt, setClipboardPathPrompt] = useState<{
    path: string
    kind: 'file' | 'folder'
  } | null>(null)
  const [clipboardPathDialog, setClipboardPathDialog] = useState<{
    path: string
    kind: 'file' | 'folder'
  } | null>(null)
  const clipboardProbeRef = useRef(0)
  const [propertyAddRequest, setPropertyAddRequest] = useState<{
    tabId: string
    nonce: number
  } | null>(null)
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

  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  // 提为 useCallback 保持引用稳定，配合 Sidebar 的 memo() 避免每次击键都重渲染 Sidebar
  const openSidebarSettings = useCallback(() => setSettingsSection('appearance'), [])
  const changeFileTreeSort = useCallback(
    (fileTreeSort: FileTreeSort): void => {
      persistUserSettings({ fileTreeSort })
    },
    [persistUserSettings],
  )
  const [showFind, setShowFind] = useState(false)
  const [findFocusRequest, setFindFocusRequest] = useState(0)
  const requestFindFocus = useCallback(() => setFindFocusRequest((value) => value + 1), [])
  const [findInitial, setFindInitial] = useState('')
  const [searchJump, setSearchJump] = useState<{
    query: string
    line?: number
    matchIndex?: number
  } | null>(null)
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
  // 左栏在同一位置上轮流展示文件树 / 搜索 / 标签树，见 SidebarMode 的注释。
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('files')
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const requestSearchFocus = useCallback(() => setSearchFocusRequest((value) => value + 1), [])
  // 搜索面板就长在左栏里（替掉文件树），所以左栏必须是展开的。头部那颗放大镜
  // 同时是"进入"和"退出"：再点一次回到文件树，这样这一栏不需要额外的切换器。
  const toggleSidebarSearch = useCallback(() => {
    setSidebarVisible(true)
    setSidebarMode((mode) => (mode === 'search' ? 'files' : 'search'))
  }, [setSidebarVisible, setSidebarMode])
  const toggleSidebarTags = useCallback(() => {
    setSidebarVisible(true)
    setSidebarMode((mode) => (mode === 'tags' ? 'files' : 'tags'))
  }, [setSidebarVisible, setSidebarMode])
  const showFileTree = useCallback(() => setSidebarMode('files'), [setSidebarMode])
  const [showPalette, setShowPalette] = useState(false)
  const [recentItemsSection, setRecentItemsSection] = useState<RecentItemsSection | null>(null)
  const showRecentItems = useCallback((section: RecentItemsSection): void => {
    setRecentItemsSection(section)
  }, [])
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [readingMode, setReadingMode] = useState(false)
  const requestAddProperty = useCallback((): void => {
    const tab = stateRef.current.tabs.find((item) => item.id === stateRef.current.activeId)
    if (!tab || classifyFile(tab.name) === 'text' || readingMode) return
    setSourceMode(false)
    setPropertyAddRequest((current) => ({
      tabId: tab.id,
      nonce: (current?.nonce ?? 0) + 1,
    }))
  }, [readingMode])
  // 同样提为 useCallback：TabBar / Outline 用 memo() 包裹后，稳定的回调引用才能让 memo 生效
  const toggleSourceMode = useCallback(() => setSourceMode((v) => !v), [])
  const toggleSidebarVisible = useCallback(() => setSidebarVisible((v) => !v), [setSidebarVisible])
  const toggleOutlineVisible = useCallback(() => setOutlineVisible((v) => !v), [])
  const toggleReadingMode = useCallback(() => setReadingMode((v) => !v), [])
  const closeOutline = useCallback(() => setOutlineVisible(false), [])
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>(null)
  const openEditorContext = useEditorContextMenu(setCtxMenu)
  type EditorFeedback =
    | (CopyFeedbackDetail & { kind: 'copy'; sequence: number })
    | { kind: 'language'; language: string; sequence: number }
  type EditorFeedbackInput =
    | (CopyFeedbackDetail & { kind: 'copy' })
    | { kind: 'language'; language: string }
  const [editorFeedback, setEditorFeedback] = useState<EditorFeedback | null>(null)
  const feedbackSequenceRef = useRef(0)
  const dismissEditorFeedback = useCallback(() => setEditorFeedback(null), [])
  useEffect(() => {
    const show = (detail: EditorFeedbackInput): void => {
      setEditorFeedback({ ...detail, sequence: ++feedbackSequenceRef.current })
    }
    const unsubscribeCopy = subscribeCopyFeedback((detail) => show({ ...detail, kind: 'copy' }))
    const unsubscribeLanguage = subscribeCodeLanguageFeedback((detail) =>
      show({ ...detail, kind: 'language' }),
    )
    return () => {
      unsubscribeCopy()
      unsubscribeLanguage()
    }
  }, [])
  const [tablePicker, setTablePicker] = useState<{
    x: number
    y: number
    onInsert: (r: number, c: number) => void
  } | null>(null)
  useEffect(() => {
    tablePickerBridge.setHandler((x, y, onInsert) => setTablePicker({ x, y, onInsert }))
    return () => tablePickerBridge.setHandler(null)
  }, [])
  const [tableZoomHtml, setTableZoomHtml] = useState<string | null>(null)
  useEffect(() => {
    tableZoomBridge.setHandler(setTableZoomHtml)
    return () => tableZoomBridge.setHandler(null)
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
  const [exportActivity, setExportActivity] = useState<ExportActivity | null>(null)
  const [themeInstallLabel, setThemeInstallLabel] = useState<string | null>(null)

  const updater = useUpdater(settings?.checkUpdatesOnStartup ?? false)

  // ── Workspace session restore and persistence ──────────────────────────────
  useWorkspaceSession({
    settingsReady,
    settings,
    folder,
    tabs,
    activePath: activeTab?.path ?? null,
    setFolder,
    restoreSession,
    persistSettings: persistSettingsInBackground,
  })

  // ── Folder open ────────────────────────────────────────────────────────────
  // tagNavigation 在下面才建（它依赖 folder），这里用 ref 反向拿它的 reset。
  const resetTagNavigationRef = useRef<(() => void) | null>(null)

  // 打开（或换）文件夹时把左栏拨回文件树：用户此刻想看的是新工作区的文件，
  // 而不是上一个工作区留下的搜索结果或标签树。中间结果列同理清掉。
  const enterFolder = useCallback(
    (result: Folder): void => {
      setSidebarVisible(true)
      setSidebarMode('files')
      resetTagNavigationRef.current?.()
      setFolder(result)
      pushRecentFolder(result.root)
    },
    [pushRecentFolder, setSidebarVisible, setSidebarMode],
  )

  const openFolder = useCallback(async () => {
    const result = await desktop.openFolder()
    if (result) enterFolder(result)
  }, [enterFolder])

  const chooseFolderFrom = useCallback(
    async (initialPath: string) => {
      const result = await desktop.openFolder(initialPath)
      if (result) enterFolder(result)
    },
    [enterFolder],
  )

  const openFolderByPath = useCallback(
    async (root: string) => {
      let result
      try {
        result = await desktop.openFolderPath(root)
      } catch (error) {
        console.error('Open folder by path failed', error)
        void desktop.notify(t('无法打开文件夹：\n') + root)
        return
      }
      if (result) enterFolder(result)
      else void desktop.notify(t('文件夹不存在：\n') + root)
    },
    [enterFolder],
  )

  const inspectClipboardPath = useCallback(async (): Promise<void> => {
    const requestId = ++clipboardProbeRef.current
    setClipboardPathPrompt(null)
    setClipboardPathDialog(null)

    let rawText: string
    try {
      rawText = await desktop.readClipboardText()
    } catch {
      // Clipboard access is best-effort. The start page remains fully usable
      // when the OS denies access or the clipboard currently holds non-text.
      return
    }

    const path = clipboardPath(rawText)
    if (!path || requestId !== clipboardProbeRef.current) return

    // 只做一次 metadata 探测。早先这里用 readFile / openFolderPath 试探，
    // 等于为了判断类型就把整个文件读进内存、把整棵目录树扫一遍——剪贴板里
    // 随便一个大文件或 home 目录都会让开始页卡住。
    let stat: PathStat
    try {
      stat = await desktop.statPath(path)
    } catch {
      // Ignore invalid, inaccessible, and non-local paths.
      return
    }
    if (!stat.exists || requestId !== clipboardProbeRef.current) return

    const kind = stat.isDir ? 'folder' : 'file'
    setClipboardPathPrompt({ path, kind })
    setClipboardPathDialog({ path, kind })
  }, [])

  // 冷启动时 Welcome 页是靠 activeId 初值渲染的，showWelcome 不会被调用，
  // 所以这里单独探一次——否则「开始页提示剪贴板路径」只在关掉所有标签页后才生效。
  useEffect(() => {
    void inspectClipboardPath()
  }, [inspectClipboardPath])

  const showWelcome = useCallback((): void => {
    captureActiveScroll()
    setActiveId(null)
    void inspectClipboardPath()
  }, [captureActiveScroll, inspectClipboardPath, setActiveId])

  const openClipboardPath = useCallback((): void => {
    const prompt = clipboardPathPrompt
    setClipboardPathPrompt(null)
    setClipboardPathDialog(null)
    if (!prompt) return
    if (prompt.kind === 'file') void openPath(prompt.path, baseName(prompt.path))
    else void openFolderByPath(prompt.path)
  }, [clipboardPathPrompt, openFolderByPath, openPath])

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
    treeError,
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
    sidebarMode,
    setSidebarMode,
    setInputDialog,
    setCtxMenu,
  })
  resetTagNavigationRef.current = tagNavigation.reset

  // 搜索后删除/重命名会刷新 treeKey；已打开的文件保存后内容哈希变化，也要重搜，
  // 否则搜索结果会继续展示已不存在或已不再匹配的文件。判定逻辑见 recordContentChanges。
  const knownContentHashesRef = useRef(new Map<string, string>())
  const [searchRevision, setSearchRevision] = useState(0)
  useEffect(() => {
    const changed = recordContentChanges(
      knownContentHashesRef.current,
      tabs.map((tab) => ({ path: tab.path, contentHash: tab.version?.contentHash ?? '' })),
    )
    if (changed) setSearchRevision((value) => value + 1)
  }, [tabs])
  const searchReloadKey = `${treeKey}:${searchRevision}`
  const persistFolderSearchMode = useCallback(
    (folderSearchMode: FolderSearchMode): void => {
      persistUserSettings({ folderSearchMode })
    },
    [persistUserSettings],
  )
  // 搜索状态住在这里而不是面板里：切到文件树再切回来，关键词和结果都还在。
  const folderSearch = useFolderSearch(
    folder?.root ?? null,
    searchReloadKey,
    settings?.folderSearchMode ?? 'all',
    persistFolderSearchMode,
  )
  /** 搜索结果 →「在文件树中定位」：切回文件模式并展开到那个文件。 */
  const revealSearchResult = useCallback(
    (path: string): void => {
      setSidebarMode('files')
      requestReveal(path)
    },
    [requestReveal, setSidebarMode],
  )

  const sidebarControls = useMemo(
    () => (settings ? sidebarControlsFromSettings(settings) : HIDDEN_SIDEBAR_CONTROLS),
    [settings],
  )

  // 必须和传给 MarkdownEditor 的 content 用同一份文本（见下方 sourceMode 三元），
  // 否则大纲的标题 offset 是按去 frontmatter 的正文算的，源码模式下编辑器用的是
  // 带 frontmatter 的原文，offset 会整体偏移 frontmatter 的长度，点击大纲跳到错误位置。
  const deferredOutlineContent = useDeferredValue(
    outlineVisible && activeTab ? (sourceMode ? activeTab.content : activeFrontmatter.body) : '',
  )
  const outline = useMemo(
    () => (outlineVisible && deferredOutlineContent ? parseOutline(deferredOutlineContent) : []),
    [deferredOutlineContent, outlineVisible],
  )
  const [activeOutlineIndex, setActiveOutlineIndex] = useState<number | null>(null)
  const updateActiveOutline = useCallback(
    (scrollTop: number): void => {
      const view = cm6ActiveViewBridge.get()
      if (!view || outline.length === 0) {
        setActiveOutlineIndex(null)
        return
      }
      const probe = scrollTop + Math.min(96, view.scrollDOM.clientHeight * 0.16)
      let next: number | null = null
      for (const item of outline) {
        if (view.lineBlockAt(item.offset).top > probe) break
        next = item.index
      }
      setActiveOutlineIndex((current) => (current === next ? current : next))
    },
    [outline],
  )
  useEffect(() => {
    if (!outlineVisible) {
      setActiveOutlineIndex(null)
      return
    }
    const frame = requestAnimationFrame(() => {
      const view = cm6ActiveViewBridge.get()
      if (view) updateActiveOutline(view.scrollDOM.scrollTop)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, outlineVisible, updateActiveOutline])
  // frecency 衰减用的“现在”，周期刷新；避免在 render 里直接调 Date.now()。
  const now = useNow()
  const openTabPathsKey = tabs
    .flatMap((tab) => (tab.path ? [documentPathKey(tab.path)] : []))
    .join('\0')
  // 文件树排序上下文：排序方式 + 置顶集合 + frecency 排名。集中在此计算，
  // 逐层传给 FileTree，避免每个节点各自重建 Set/Map。排名由 recentDocs 语料按
  // frecency 算出，并把当前打开的 tab 加权置顶（见 lib/recency.ts）。
  const fileTreeSortContext = useMemo<SortContext>(() => {
    const openTabPaths = new Set(openTabPathsKey ? openTabPathsKey.split('\0') : [])
    return {
      mode: settings?.fileTreeSort ?? 'default',
      pinnedPaths: new Set((settings?.pinnedFolders ?? []).map(documentPathKey)),
      recentRank: buildFrecencyRank(settings?.recentDocs ?? [], now, openTabPaths),
    }
  }, [settings?.fileTreeSort, settings?.pinnedFolders, settings?.recentDocs, openTabPathsKey, now])

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
      clipboardFormat: settings?.clipboardFormat ?? 'rich',
      copyTextColor: settings?.copyTextColor ?? false,
      copyHighlightColor: settings?.copyHighlightColor ?? false,
    })
  }, [
    settings?.clipboardFormat,
    settings?.imageCopyMode,
    settings?.mermaidCopyMode,
    settings?.copyTextColor,
    settings?.copyHighlightColor,
  ])

  // ── System open-path (file association / double-click) ────────────────────
  useEffect(() => {
    if (!desktop) return undefined
    return desktop.onOpenPath((p) => openPath(p, baseName(p)))
  }, [openPath])

  // ── Theme marketplace deep links ─────────────────────────────────────────
  useEffect(
    () =>
      desktop.onThemeInstallRequest((request) => {
        setThemeInstallLabel(tf('正在安装「{name}」…', { name: request.name }))
        void desktop
          .installThemeFromUrl(request)
          .then(async (theme) => {
            await saveSettings({ theme: theme.colorScheme, customCssPath: theme.cssPath })
            await desktop.notify(
              `${theme.name} ${theme.version} ${t('已安装并应用。')}`,
              t('主题安装完成'),
            )
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error)
            void desktop.notify(tf('主题安装失败：{message}', { message }), t('主题安装'))
          })
          .finally(() => setThemeInstallLabel(null))
      }),
    [lang, saveSettings],
  )

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
      const result = await openPath(path, baseName(path))
      if (result.kind === 'failed' || stateRef.current.activeId !== result.tabId) return
      // 只跳转并高亮，不再自动弹出编辑器里的查找栏：左边已经有一个搜索面板了，
      // 再顶出一条查找栏等于同屏两个搜索 UI。查找栏要用的初始值仍然记着，用户
      // 按 ⌘F 时是预填好的；⌘G 也会照常打开它继续找下一个。
      setFindInitial(query)
      setFindLine(lineNumber)
      setFindMatchIndex(matchIndex)
      // 新对象 = 一次新的跳转请求，即使连点同一条结果也会重跑。真正的跳转在下面
      // 的 effect 里做：那时这次打开文档的渲染已经提交，编辑器拿到的是新正文。
      setSearchJump({ query, line: lineNumber, matchIndex })
    },
    [openPath, stateRef],
  )

  // 跳到搜索命中的位置。编辑器可能是懒加载的（首次打开文档时还没 mount），
  // 所以拿不到 view 时就等它注册进 bridge 再跳。
  useEffect(() => {
    if (!searchJump) return undefined
    const jump = (): void => {
      searchMountedEditor(searchJump.query, searchJump.matchIndex ?? 0, searchJump.line)
    }
    if (hasEditor()) {
      jump()
      return undefined
    }
    const unsubscribe = onEditorAvailable(() => {
      unsubscribe()
      jump()
    })
    return unsubscribe
  }, [searchJump])

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
          if (!current?.path || !sameDocumentPath(current.path, target.path)) return
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

  const { exportHTML, exportPDF, exportImage, exportDocx, cancelExport } = useExportActions(
    stateRef,
    setExportResultPath,
    setExportActivity,
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
        if (originalDir && !sameDocumentPath(originalDir, targetDirPath)) {
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
    setSidebarMode,
    setShowFind,
    requestFindFocus,
    requestSearchFocus,
    setOutlineVisible,
    setSourceMode,
    setFocusMode,
    setTypewriterMode,
    toggleSelectionToolbar,
    toggleToolbar,
    toggleReadingMode,
    setSettingsSection,
  })
  // ── Auto-save ─────────────────────────────────────────────────────────────
  // Only the active tab participates; background dirty tabs are protected by
  // useDraftRecovery snapshots, which fire independently every 1.2 s / 5 s.
  useEffect(() => {
    if (!settings?.autoSave || !activeTab?.path || !activeTab.dirty || activeTab.diskState) return
    const id = setTimeout(() => void saveTab(activeTab.id), 1200)
    return () => clearTimeout(id)
  }, [
    settings?.autoSave,
    activeTab?.content,
    activeTab?.dirty,
    activeTab?.diskState,
    activeTab?.id,
    activeTab?.path,
    saveTab,
  ])

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
    onAddProperty: requestAddProperty,
    onShowRecentItems: showRecentItems,
  })
  // Don't render until settings and the persisted sidebar state are loaded
  // (avoids a flash of the wrong theme/width/sidebar visibility).
  if (!settings || !sidebarVisibilityReady) {
    return (
      <div className="app">
        <TitleBar />
      </div>
    )
  }

  const isMac = currentDesktopPlatform() === 'macos'
  const resultsPaneVisible = !!tagNavigation.selectedTag
  const hasLeadingPane = sidebarVisible || resultsPaneVisible
  const workspaceTabBar = (
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
      showLeadingControls={!isMac || !hasLeadingPane}
      enableWindowDragging={isMac}
    />
  )

  return (
    <div className="app">
      {!isMac && (
        <TitleBar
          documentName={activeTab?.name}
          dirty={activeTab?.dirty}
          shortcuts={settings.shortcuts}
          onOpenAbout={() => setSettingsSection('about')}
          onAddProperty={requestAddProperty}
          canAddProperty={!!activeTab && !isTextKind && !readingMode}
        />
      )}
      <div className="workspace-shell">
        {sidebarVisible && (
          <div
            className="sidebar-wrap"
            style={{ width: sidebarPanel.width, minWidth: sidebarPanel.width }}
          >
            {isMac && (
              <MacWindowBar
                onToggleSidebar={toggleSidebarVisible}
                onRevealFile={revealActiveFile}
                activeHasPath={!!activeTab?.path}
                showRevealButton={settings.showRevealButton}
              />
            )}
            {/* 头部（当前文件夹那一行）和模式切换器三种模式共用，只有下面的主体在换。
                Esc 统一在这里退回文件树，不管焦点落在面板里还是切换器上；搜索框自己
                会先吃掉一次 Esc 用来清空关键词（见 SearchPanel）。 */}
            <aside
              className="sidebar"
              onKeyDown={(event) => {
                if (event.key !== 'Escape' || sidebarMode === 'files') return
                event.preventDefault()
                showFileTree()
              }}
            >
              <SidebarHeader
                folder={folder}
                isFav={
                  folder
                    ? settings.favorites.some((path) => sameDocumentPath(path, folder.root))
                    : false
                }
                canUndo={canUndo}
                controls={sidebarControls}
                onUndo={undoLastOp}
                onToggleFavorite={toggleFavorite}
                onRefresh={refreshTree}
                onOpenSearch={toggleSidebarSearch}
                onShowTags={toggleSidebarTags}
                activeMode={sidebarMode}
                onOpenFolder={openFolder}
                onOpenSettings={openSidebarSettings}
                onRootContext={openRootContext}
                // 排序只对文件树有意义，其余模式下这个按钮自然消失。
                fileTreeSort={sidebarMode === 'files' ? fileTreeSortContext.mode : undefined}
                onFileTreeSortChange={sidebarMode === 'files' ? changeFileTreeSort : undefined}
              />
              {folder && sidebarMode === 'search' ? (
                <Suspense fallback={<PanelFallback />}>
                  <SearchPanel
                    search={folderSearch}
                    focusRequest={searchFocusRequest}
                    onOpenResult={openSearchResult}
                    onOpenFile={(path) => void openPath(path, baseName(path))}
                    onRevealInTree={revealSearchResult}
                    onExit={showFileTree}
                  />
                </Suspense>
              ) : folder && sidebarMode === 'tags' ? (
                /* 标签树占左栏；点某个标签后，它的文档在中间“结果列”展示。 */
                <Suspense fallback={<PanelFallback />}>
                  <TagOverviewSidebar
                    tree={tagTree}
                    pinnedTags={settings.pinnedTags ?? []}
                    collapsedKeys={settings.tagCollapsedKeys ?? []}
                    activeTag={tagNavigation.selectedTag}
                    loading={tagIndex.loading}
                    error={tagIndex.error}
                    truncated={tagIndex.truncated}
                    onExit={showFileTree}
                    onOpenTag={openTreeTag}
                    onTogglePin={togglePinnedTag}
                    onToggleCollapsed={toggleTagCollapsed}
                    onTagContext={openTagContext}
                    onMoveTag={moveTagUnder}
                  />
                </Suspense>
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
                  onFavoritesCollapsedChange={setFavoritesCollapsed}
                  onFavoriteContext={openFavoriteContext}
                  onRefresh={refreshTree}
                  treeError={treeError}
                  onNodeContext={openNodeContext}
                  onRootContext={openRootContext}
                  onMove={moveTreeItem}
                  reloadKey={treeKey}
                  expandedPathsRef={expandedPathsRef}
                />
              )}
            </aside>
            <ResizeHandle
              label={t('侧边栏宽度')}
              direction={1}
              width={sidebarPanel.width}
              onResizeStart={sidebarPanel.startResize}
              onReset={sidebarPanel.reset}
              onNudge={sidebarPanel.nudge}
            />
          </div>
        )}

        {/* 中间“结果列”：点某个标签后的文档列表。可拖宽，关掉即隐藏。 */}
        {resultsPaneVisible ? (
          <div
            className="results-wrap"
            style={{ width: resultsPanel.width, minWidth: resultsPanel.width }}
          >
            {isMac && !sidebarVisible && (
              <MacWindowBar
                onToggleSidebar={toggleSidebarVisible}
                onRevealFile={revealActiveFile}
                activeHasPath={!!activeTab?.path}
                showRevealButton={settings.showRevealButton}
              />
            )}
            <div className="results-pane-content">
              <Suspense fallback={<PanelFallback />}>
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
                  truncated={tagIndex.truncated}
                  overviewOpen={sidebarMode === 'tags' && sidebarVisible}
                  onShowAllTags={showAllTags}
                  onClose={tagNavigation.closeResults}
                  onOpenDocument={(path, name) => void openPath(path, name)}
                />
              </Suspense>
            </div>
            <ResizeHandle
              label={t('结果列宽度')}
              direction={1}
              width={resultsPanel.width}
              onResizeStart={resultsPanel.startResize}
              onReset={resultsPanel.reset}
              onNudge={resultsPanel.nudge}
            />
          </div>
        ) : null}

        <div
          className={`main${sidebarVisible ? '' : ' no-sidebar'}${hasLeadingPane ? ' has-leading-pane' : ''}`}
        >
          {workspaceTabBar}

          {showFind && !isTextKind && (
            <Suspense fallback={null}>
              <FindBar
                initialQuery={findInitial}
                initialLine={findLine}
                initialMatchIndex={findMatchIndex}
                focusRequest={findFocusRequest}
                onClose={() => {
                  setShowFind(false)
                  setFindInitial('')
                  setFindLine(undefined)
                  setFindMatchIndex(undefined)
                }}
              />
            </Suspense>
          )}

          {settings.showToolbar && !isTextKind && !sourceMode && !readingMode && activeTab && (
            <Suspense fallback={null}>
              <EditorToolbar
                lang={settings.language}
                textColors={settings.textColorPresets}
                defaultTextColor={settings.defaultTextColor}
                highlightColors={settings.highlightColorPresets}
                defaultHighlightColor={settings.defaultHighlightColor}
                onDefaultHighlightColorChange={saveDefaultHighlightColor}
              />
            </Suspense>
          )}

          {activeTab?.diskState && (
            <ExternalChangeBanner
              tab={activeTab}
              onReview={() => setExternalReviewId(activeTab.id)}
              onReload={() => setExternalReviewId(activeTab.id)}
              onOverwrite={() => void overwriteExternalTab(activeTab.id)}
              onRetry={() =>
                void checkExternalChanges(activeTab.path ? [activeTab.path] : undefined)
              }
              onSaveAs={() => void saveAsTab(activeTab.id)}
              onClose={() => void closeTab(activeTab.id)}
            />
          )}

          <div
            className="editor-area"
            onMouseDownCapture={() => window.dispatchEvent(new Event('xmd-clear-select-all'))}
            onDoubleClickCapture={(event) => {
              if (!(event.target instanceof Element)) return
              const src = editorZoomSource(event.target)
              if (!src) return
              event.preventDefault()
              event.stopPropagation()
              setZoomSrc(src)
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
                    content={sourceMode ? activeTab.content : activeFrontmatter.body}
                    livePreview={!sourceMode}
                    showSelectionToolbar={settings.showSelectionToolbar ?? false}
                    lang={settings.language}
                    textColors={settings.textColorPresets}
                    defaultTextColor={settings.defaultTextColor}
                    highlightColors={settings.highlightColorPresets}
                    defaultHighlightColor={settings.defaultHighlightColor}
                    onDefaultHighlightColorChange={saveDefaultHighlightColor}
                    resolveImageSrc={resolveEditorImageSrc}
                    allowRemoteImages={settings.allowRemoteImages ?? false}
                    codeBlockLineWrapping={settings.codeBlockLineWrapping ?? false}
                    tableColumnWidthMode={settings.tableAutoWidth ?? 'distribute'}
                    tableAutoResize={settings.tableAutoResize ?? true}
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
                    previewThemeVersion={`${settings.theme}:${themeRenderVersion}`}
                    tagBar={
                      // Source mode shows frontmatter as literal `---` YAML text
                      // inside the editor body (see the `content` prop above), so
                      // the structured properties widget would otherwise duplicate
                      // it as an editable overlay on top of its own source.
                      !sourceMode && (
                        <>
                          <Suspense fallback={null}>
                            <DocumentPropertyPanel
                              properties={activeProperties}
                              inlineTags={inlineOnlyTags}
                              activeTag={tagNavigation.selectedTag}
                              disabled={readingMode}
                              onSelectTag={openDocumentTag}
                              onTagContext={openDocTagContext}
                              onChange={changeDocumentProperties}
                              addRequest={
                                propertyAddRequest?.tabId === activeTab.id
                                  ? propertyAddRequest.nonce
                                  : 0
                              }
                              onAddRequestConsumed={() => setPropertyAddRequest(null)}
                            />
                          </Suspense>
                          {!hasBodyHeading && activeFrontmatter.title && (
                            <div className="document-title-fallback">{activeFrontmatter.title}</div>
                          )}
                        </>
                      )
                    }
                    readingMode={readingMode}
                    initialScrollTop={wysiwygScrollPositions.current.get(activeTab.id) ?? 0}
                    onScrollTopChange={(scrollTop) => {
                      wysiwygScrollPositions.current.set(activeTab.id, scrollTop)
                      if (outlineVisible) updateActiveOutline(scrollTop)
                    }}
                    onChange={(nextValue) => {
                      // Frontmatter/property edits and CM6 transactions can be
                      // dispatched in the same tick. Merge the editor value into
                      // the authoritative tab snapshot, not this render's closure,
                      // so neither side can overwrite a newer update.
                      const current = stateRef.current.tabs.find((tab) => tab.id === activeTab.id)
                      if (!current) return
                      // In source mode the editor holds (and edits) the full
                      // document, frontmatter included — merging it through
                      // replaceMarkdownBody would duplicate the `---` block.
                      updateContent(
                        current.id,
                        sourceMode ? nextValue : replaceMarkdownBody(current.content, nextValue),
                      )
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
                clipboardPathPrompt={clipboardPathPrompt}
                onOpenClipboardPath={openClipboardPath}
              />
            )}

            {outlineVisible && activeTab && !isTextKind && (
              <>
                <ResizeHandle
                  label={t('大纲宽度')}
                  direction={-1}
                  width={outlinePanel.width}
                  onResizeStart={outlinePanel.startResize}
                  onReset={outlinePanel.reset}
                  onNudge={outlinePanel.nudge}
                />
                <Suspense fallback={null}>
                  <Outline
                    documentId={activeTab.id}
                    items={outline}
                    activeIndex={activeOutlineIndex}
                    onSelect={scrollToHeading}
                    onReorder={reorderSection}
                    onClose={closeOutline}
                    readOnly={readingMode}
                    width={outlinePanel.width}
                  />
                </Suspense>
              </>
            )}

            {exportActivity && (
              <ExportProgressToast
                label={exportActivity.label}
                detail={exportActivity.detail}
                percent={exportActivity.percent}
                cancellable={exportActivity.cancellable}
                onCancel={cancelExport}
              />
            )}

            {themeInstallLabel && (
              <ExportProgressToast
                label={themeInstallLabel}
                cancellable={false}
                onCancel={() => {}}
              />
            )}

            {externalReloadNotice && (
              <ExternalReloadToast
                name={externalReloadNotice.name}
                sequence={externalReloadNotice.sequence}
                onClose={dismissExternalReloadNotice}
              />
            )}

            {editorFeedback?.kind === 'copy' && (
              <CopyFeedbackToast
                key={editorFeedback.sequence}
                format={editorFeedback.format}
                onCopyAlternate={
                  editorFeedback.format === 'rich'
                    ? clipboardCmd.copyAsPlainText
                    : clipboardCmd.copyAsRichText
                }
                onClose={dismissEditorFeedback}
              />
            )}

            {editorFeedback?.kind === 'language' && (
              <CodeLanguageFeedbackToast
                key={editorFeedback.sequence}
                language={editorFeedback.language}
                onClose={dismissEditorFeedback}
              />
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
        <Suspense fallback={<ModalFallback />}>
          <Settings
            key={settingsSection}
            settings={settings}
            updater={updater}
            customCssError={customCssError}
            backgroundImageError={backgroundImageError}
            saving={settingsSaving}
            saveError={settingsSaveError}
            initialSection={settingsSection}
            activeDocument={
              activeTab && !isTextKind
                ? { name: activeTab.name, markdown: activeTab.content }
                : null
            }
            onChange={(patch) => {
              // 改「默认展开层级」时，按当前标签树重算折叠集合，让新层级立刻生效。
              const effective =
                patch.tagDefaultExpandDepth !== undefined
                  ? {
                      ...patch,
                      tagCollapsedKeys: groupKeysToCollapse(tagTree, patch.tagDefaultExpandDepth),
                    }
                  : patch
              persistUserSettings(effective)
            }}
            onClose={() => setSettingsSection(null)}
          />
        </Suspense>
      )}

      {showPalette && (
        <Suspense fallback={<ModalFallback />}>
          <CommandPalette
            commands={paletteCommands}
            files={paletteFiles}
            onOpenFile={(p, n) => openPath(p, n)}
            onClose={() => setShowPalette(false)}
          />
        </Suspense>
      )}

      {recentItemsSection && (
        <Suspense fallback={<ModalFallback />}>
          <RecentItemsDialog
            recentFiles={settings.recentFiles}
            recentFolders={settings.recentFolders}
            initialSection={recentItemsSection}
            onOpenRecentFile={(path) => void openPath(path, baseName(path))}
            onOpenRecentFolder={openFolderByPath}
            onClose={() => setRecentItemsSection(null)}
          />
        </Suspense>
      )}

      {zoomSrc && (
        <Suspense fallback={<ModalFallback />}>
          <Lightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
        </Suspense>
      )}

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
        <Suspense fallback={null}>
          <TableGridPicker
            x={tablePicker.x}
            y={tablePicker.y}
            onInsert={tablePicker.onInsert}
            onClose={() => setTablePicker(null)}
          />
        </Suspense>
      )}

      {tableZoomHtml !== null && (
        <Suspense fallback={null}>
          <TableZoomModal html={tableZoomHtml} onClose={() => setTableZoomHtml(null)} />
        </Suspense>
      )}

      {inputDialog && (
        <Suspense fallback={null}>
          <InputDialog
            title={inputDialog.title}
            initial={inputDialog.initial}
            confirmText={inputDialog.confirmText}
            onSubmit={inputDialog.onSubmit}
            onClose={() => setInputDialog(null)}
          />
        </Suspense>
      )}

      {clipboardPathDialog && (
        <Suspense fallback={null}>
          <ClipboardPathDialog
            path={clipboardPathDialog.path}
            kind={clipboardPathDialog.kind}
            onOpen={openClipboardPath}
            onClose={() => setClipboardPathDialog(null)}
          />
        </Suspense>
      )}

      {unsavedCloseRequest && (
        <Suspense fallback={null}>
          <UnsavedChangesDialog
            tabs={unsavedCloseRequest.tabs}
            reason={unsavedCloseRequest.reason}
            onDecision={resolveCloseDecision}
          />
        </Suspense>
      )}

      {externalReviewTab && externalReviewSnapshot && (
        <Suspense fallback={null}>
          <ExternalChangeDialog
            tab={externalReviewTab}
            snapshot={externalReviewSnapshot}
            onCancel={() => setExternalReviewId(null)}
            onReload={() => {
              setExternalReviewId(null)
              void reloadTabFromDisk(externalReviewTab.id)
            }}
            onOverwrite={() => {
              setExternalReviewId(null)
              void overwriteExternalTab(externalReviewTab.id)
            }}
          />
        </Suspense>
      )}

      {draftRecoveryOpen && draftSummaries.length > 0 && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {exportResultPath && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      <Suspense fallback={null}>
        <UpdateNotice updater={updater} />
      </Suspense>
    </div>
  )
}
