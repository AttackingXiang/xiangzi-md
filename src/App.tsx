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
import CommandPalette, { type Command } from './components/CommandPalette'
import { editorCmd, clipboardCmd, hasWysiwyg } from './lib/editorCommands'
import { escapeHtmlText, serializeStyleSheets } from './lib/exportStyles'
import { getLang, t } from './lib/i18n'
import { baseName, dirName } from './lib/path'
import { revealLocationKey } from './lib/platform'
import { replaceMovedPath } from './lib/treeDrag'
import { blobPartFromBytes, imageMimeType, xmdAssetPaths } from './lib/asset'
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  SquareCode,
  Pilcrow,
  Copy,
  Scissors,
  ClipboardPaste,
  TextSelect,
  Rows3,
  Columns3,
  Table2,
} from 'lucide-react'
import { parseOutline } from './lib/outline'
import type { Folder, Tab } from './types'
import { useSettings } from './hooks/useSettings'
import { useFileOps } from './hooks/useFileOps'
import { useTreeOps } from './hooks/useTreeOps'
import { useUpdater } from './hooks/useUpdater'
import { useAppShortcuts } from './hooks/useAppShortcuts'
import { useDraftRecovery } from './hooks/useDraftRecovery'
import { isShortcutAction, type ShortcutAction } from './lib/shortcuts'
import { copyImageElement } from './lib/richClipboard'
import { mapWithConcurrencyLimit } from './lib/asyncPool'
import { imageDimensionsFromBytes, planExportImageMemory } from './lib/imageBudget'
import {
  blobToDataUrl,
  exportOwnedObjectUrlAttribute,
  resizeImageBlob,
} from './lib/exportImageAsset'
import type { SettingsSection } from './components/Settings'

interface FileEntry {
  path: string
  name: string
}

interface LocalExportImage {
  image: HTMLImageElement
  blob: Blob
  width: number | null
  height: number | null
  displayWidth: number
}

type HeadingRunKind = 'cjk' | 'latin' | 'space' | 'neutral'

function exportHeadingRuns(text: string): Array<{ kind: HeadingRunKind; text: string }> {
  const runs: Array<{ kind: HeadingRunKind; text: string }> = []
  for (const character of text) {
    let kind: HeadingRunKind
    if (/\s/u.test(character)) kind = 'space'
    else if (/\p{Script=Han}/u.test(character)) kind = 'cjk'
    else if (/[A-Za-z0-9]/u.test(character)) kind = 'latin'
    else kind = runs.at(-1)?.kind ?? 'neutral'

    const previous = runs.at(-1)
    if (previous?.kind === kind) previous.text += character
    else runs.push({ kind, text: character })
  }
  return runs
}

function normalizeExportHeadings(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading) => {
    // Preserve non-text heading content instead of flattening images/formulas.
    if (heading.querySelector('img, svg, math')) return
    const text = heading.textContent ?? ''
    heading.replaceChildren(
      ...exportHeadingRuns(text).map(({ kind, text: runText }) => {
        const span = document.createElement('span')
        span.className = `xmd-export-heading-run xmd-export-heading-${kind}`
        span.textContent = runText
        return span
      }),
    )
    heading.classList.add('xmd-export-heading')
  })
}

const EMPTY_SHORTCUTS: Record<string, string> = {}
const EXPORT_WORK_CONCURRENCY = 2
const EXPORT_RESIZE_CONCURRENCY = 1
const MAX_SINGLE_EXPORT_IMAGE_BYTES = 64 * 1024 * 1024
const EXPORT_CONTENT_WIDTH = 800

export default function App(): JSX.Element {
  // ── Settings (theme, width, i18n, CSS side-effects all live here) ──────────
  const {
    settings,
    settingsReady,
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
  const [searchView, setSearchView] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const quitPromptOpenRef = useRef(false)
  const [focusMode, setFocusMode] = useState(false)
  const [typewriterMode, setTypewriterMode] = useState(false)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    items: MenuItem[]
    preserveSelection?: boolean
  } | null>(null)
  const [inputDialog, setInputDialog] = useState<{
    title: string
    initial?: string
    confirmText?: string
    onSubmit: (value: string) => void
  } | null>(null)
  const [exportResultPath, setExportResultPath] = useState<string | null>(null)
  const exportInProgressRef = useRef(false)

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

  // ── Editor right-click menu ────────────────────────────────────────────────
  const openEditorContext = useCallback(
    (x: number, y: number, image?: HTMLImageElement, inTable = false) => {
      const sz = 15
      const items: MenuItem[] = [
        ...(image
          ? [
              {
                label: t('复制图片'),
                icon: <Copy size={sz} />,
                onClick: () => void copyImageElement(image),
              },
            ]
          : []),
        { label: t('剪切'), icon: <Scissors size={sz} />, hint: '⌘X', onClick: clipboardCmd.cut },
        { label: t('复制'), icon: <Copy size={sz} />, hint: '⌘C', onClick: clipboardCmd.copy },
        {
          label: t('粘贴'),
          icon: <ClipboardPaste size={sz} />,
          hint: '⌘V',
          onClick: clipboardCmd.paste,
        },
      ]
      if (hasWysiwyg()) {
        items.push(
          {
            label: t('加粗'),
            icon: <Bold size={sz} />,
            hint: '⌘B',
            onClick: editorCmd.bold,
            separatorBefore: true,
            compactGroup: 'inline-format',
          },
          {
            label: t('斜体'),
            icon: <Italic size={sz} />,
            hint: '⌘I',
            onClick: editorCmd.italic,
            compactGroup: 'inline-format',
          },
          {
            label: t('行内代码'),
            icon: <Code size={sz} />,
            hint: '⌘E',
            onClick: editorCmd.inlineCode,
            compactGroup: 'inline-format',
          },
          {
            label: t('标题 1'),
            icon: <Heading1 size={sz} />,
            onClick: () => editorCmd.heading(1),
            separatorBefore: true,
            compactGroup: 'block-style',
          },
          {
            label: t('标题 2'),
            icon: <Heading2 size={sz} />,
            onClick: () => editorCmd.heading(2),
            compactGroup: 'block-style',
          },
          {
            label: t('标题 3'),
            icon: <Heading3 size={sz} />,
            onClick: () => editorCmd.heading(3),
            compactGroup: 'block-style',
          },
          {
            label: t('正文'),
            icon: <Pilcrow size={sz} />,
            onClick: editorCmd.paragraph,
            compactGroup: 'block-style',
          },
          {
            label: t('无序列表'),
            icon: <List size={sz} />,
            onClick: editorCmd.bulletList,
            separatorBefore: true,
            compactGroup: 'block-format',
          },
          {
            label: t('有序列表'),
            icon: <ListOrdered size={sz} />,
            onClick: editorCmd.orderedList,
            compactGroup: 'block-format',
          },
          {
            label: t('任务列表'),
            icon: <ListTodo size={sz} />,
            onClick: editorCmd.taskList,
            compactGroup: 'block-format',
          },
          {
            label: t('引用'),
            icon: <Quote size={sz} />,
            onClick: editorCmd.quote,
            compactGroup: 'block-format',
          },
          {
            label: t('代码块'),
            icon: <SquareCode size={sz} />,
            onClick: editorCmd.codeBlock,
            compactGroup: 'block-format',
          },
        )
        if (!inTable) {
          items.push({
            label: t('插入表格'),
            icon: <Table2 size={sz} />,
            onClick: editorCmd.insertTable,
            separatorBefore: true,
          })
        }
        if (inTable) {
          items.push(
            {
              label: t('在上方插入行'),
              icon: <Rows3 size={sz} />,
              onClick: editorCmd.addRowBefore,
              separatorBefore: true,
              compactGroup: 'table-insert',
            },
            {
              label: t('在下方插入行'),
              icon: <Rows3 size={sz} />,
              onClick: editorCmd.addRowAfter,
              compactGroup: 'table-insert',
            },
            {
              label: t('在左侧插入列'),
              icon: <Columns3 size={sz} />,
              onClick: editorCmd.addColumnBefore,
              compactGroup: 'table-insert',
            },
            {
              label: t('在右侧插入列'),
              icon: <Columns3 size={sz} />,
              onClick: editorCmd.addColumnAfter,
              compactGroup: 'table-insert',
            },
            {
              label: t('删除当前行'),
              icon: <Rows3 size={sz} />,
              onClick: editorCmd.deleteRow,
              separatorBefore: true,
              compactGroup: 'table-delete',
            },
            {
              label: t('删除当前列'),
              icon: <Columns3 size={sz} />,
              onClick: editorCmd.deleteColumn,
              compactGroup: 'table-delete',
            },
            {
              label: t('删除表格'),
              icon: <Table2 size={sz} />,
              onClick: editorCmd.deleteTable,
              danger: true,
              compactGroup: 'table-delete',
            },
          )
        }
      }
      items.push({
        label: t('全选'),
        icon: <TextSelect size={sz} />,
        hint: '⌘A',
        onClick: clipboardCmd.selectAll,
        separatorBefore: true,
      })
      setCtxMenu({ x, y, items, preserveSelection: true })
    },
    [],
  )

  // ── Search ─────────────────────────────────────────────────────────────────
  const openSearchResult = useCallback(
    (path: string, query: string, lineNumber?: number) => {
      void openPath(path, baseName(path))
      setFindInitial(query)
      setFindLine(lineNumber)
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

  // ── Export ────────────────────────────────────────────────────────────────
  /** Build a self-contained HTML string that renders identically to the app view */
  const generateExportHTML = useCallback(
    async (
      title: string,
      mdContent?: string,
      deferImageDecoding = false,
    ): Promise<string | null> => {
      const pm =
        document.querySelector<HTMLElement>('.milkdown .ProseMirror') ??
        document.querySelector<HTMLElement>('.milkdown [contenteditable="true"]') ??
        document.querySelector<HTMLElement>('.milkdown')
      if (!pm) return null

      // ── Reading-view: pre-render all Mermaid diagrams ─────────────────────
      // Parse markdown source to know the language of every code block (including
      // lazy-not-yet-visible ones whose DOM hasn't been initialized yet).
      const mdBlocks: Array<{ lang: string; code: string }> = []
      if (mdContent) {
        const re = /^```(\S*)\s*\n([\s\S]*?)^```/gm
        let m: RegExpExecArray | null
        while ((m = re.exec(mdContent)) !== null)
          mdBlocks.push({ lang: m[1].toLowerCase(), code: m[2] })
      }

      const liveBlocks = Array.from(pm.querySelectorAll<HTMLElement>('.milkdown-code-block'))
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      const mermaidTheme = isDark ? 'dark' : 'default'

      const { EXPORT_CODE_STYLES, highlightCodeForExport } = await import('./lib/exportSyntax')

      // Replace editor-only CodeMirror DOM with deterministic reading-view HTML.
      // This also covers lazy/off-screen blocks by falling back to Markdown source.
      const blockRenders = await mapWithConcurrencyLimit(
        liveBlocks,
        EXPORT_WORK_CONCURRENCY,
        async (block, i) => {
          // Already rendered? extract the SVG from the live preview panel.
          const mermaidPreviewEl = block.querySelector<HTMLElement>(
            '.preview-panel .preview .mermaid-preview',
          )
          if (mermaidPreviewEl) {
            const svgEl = mermaidPreviewEl.querySelector('svg') ?? mermaidPreviewEl
            return { kind: 'mermaid' as const, html: svgEl.outerHTML }
          }

          // Determine language: from language-button (initialized block) or from parsed markdown.
          const langBtn = block.querySelector<HTMLElement>('.tools .language-button')
          const langFromBtn = langBtn?.textContent?.trim().toLowerCase() ?? ''
          const lang = langFromBtn || (mdBlocks[i]?.lang ?? '')
          // Get code text: prefer cm-editor lines, fall back to placeholder, then parsed markdown.
          const cmLines = block.querySelectorAll<HTMLElement>('.cm-line')
          const codeFromDOM =
            cmLines.length > 0
              ? Array.from(cmLines)
                  .map((l) => l.textContent ?? '')
                  .join('\n')
              : (block.querySelector<HTMLElement>('.milkdown-code-block-placeholder code')
                  ?.textContent ?? '')
          const code = codeFromDOM.trim().length > 0 ? codeFromDOM : (mdBlocks[i]?.code ?? '')
          if (lang !== 'mermaid') {
            return {
              kind: 'code' as const,
              html: await highlightCodeForExport(code, lang),
              language: lang,
            }
          }
          if (!code.trim()) return { kind: 'code' as const, html: '', language: lang }

          try {
            const mermaid = (await import('mermaid')).default
            mermaid.initialize({ startOnLoad: false, theme: mermaidTheme, securityLevel: 'strict' })
            const id = 'mmd-export-' + Math.random().toString(36).slice(2)
            const { svg } = await mermaid.render(id, code)
            return { kind: 'mermaid' as const, html: svg }
          } catch {
            return {
              kind: 'code' as const,
              html: await highlightCodeForExport(code, lang),
              language: lang,
            }
          }
        },
      )

      // ── Clone and clean ───────────────────────────────────────────────────
      const clone = pm.cloneNode(true) as HTMLElement

      // Strip Milkdown UI decorations AND code-block toolbar (.tools).
      const MILKDOWN_UI = [
        '.milkdown-toolbar',
        '.milkdown-block-handle',
        '.milkdown-slash-menu',
        '.milkdown-top-bar',
        '.milkdown-ai-diff-actions',
        '.milkdown-ai-instruction',
        '.milkdown-ai-streaming',
        '.milkdown-latex-inline-edit',
        '.milkdown-link-edit',
        '.milkdown-link-preview',
        '.milkdown-diff-controls',
        '.milkdown-diff-controls-block',
        '.handle',
        '.drag-preview',
        '.tools', // code block top-bar: language picker + copy / toggle buttons
        '.fold-btn', // heading fold toggle injected by headingFoldPlugin
      ].join(', ')
      clone.querySelectorAll(MILKDOWN_UI).forEach((el) => el.remove())
      clone.querySelectorAll('.selectedCell, .ProseMirror-selectednode').forEach((el) => {
        el.classList.remove('selectedCell', 'ProseMirror-selectednode')
      })
      clone.removeAttribute('contenteditable')
      clone.querySelectorAll('[contenteditable]').forEach((el) => {
        el.removeAttribute('contenteditable')
      })
      clone.querySelectorAll('[spellcheck]').forEach((el) => {
        el.removeAttribute('spellcheck')
      })
      // html2canvas/WebKit can calculate different baselines for Latin and CJK
      // glyph runs inside the same heading. Materialize those runs as flex
      // items so their visual alignment is deterministic in image exports.
      normalizeExportHeadings(clone)

      // Reading-view code block processing.
      const cloneBlocks = Array.from(clone.querySelectorAll<HTMLElement>('.milkdown-code-block'))
      cloneBlocks.forEach((block, i) => {
        const render = blockRenders[i]
        if (render?.kind === 'mermaid') {
          // Replace the entire code block with the static SVG.
          const wrapper = document.createElement('div')
          wrapper.className = 'mermaid-export'
          wrapper.style.cssText = 'margin:16px 0;overflow:auto;text-align:center'
          wrapper.innerHTML = render.html
          block.replaceWith(wrapper)
        } else {
          const pre = document.createElement('pre')
          pre.className = 'xmd-export-code'
          const code = document.createElement('code')
          if (render?.language) code.dataset.language = render.language
          code.innerHTML = render?.html ?? ''
          pre.appendChild(code)
          block.replaceWith(pre)
        }
      })

      // Inline local images without a compressed-total hard limit. For PDF/image
      // exports, plan from decoded pixels and resize only the temporary copy.
      const imgs = Array.from(clone.querySelectorAll<HTMLImageElement>('img[src]'))
      const liveImgs = Array.from(pm.querySelectorAll<HTMLImageElement>('img[src]'))
      const localImages = (
        await mapWithConcurrencyLimit(
          imgs,
          EXPORT_WORK_CONCURRENCY,
          async (image, index): Promise<LocalExportImage | null> => {
            const source = image.getAttribute('src') ?? ''
            const paths = xmdAssetPaths(source)
            if (paths.length === 0) return null

            let failure: unknown
            for (const path of paths) {
              try {
                const bytes = await desktop.readBinaryFile(path, MAX_SINGLE_EXPORT_IMAGE_BYTES)
                const blob = new Blob([blobPartFromBytes(bytes)], { type: imageMimeType(path) })
                const parsed = imageDimensionsFromBytes(bytes)
                const liveImage =
                  liveImgs[index]?.getAttribute('src') === source
                    ? liveImgs[index]
                    : liveImgs.find((candidate) => candidate.getAttribute('src') === source)
                const width = liveImage?.naturalWidth || parsed?.width || null
                const height = liveImage?.naturalHeight || parsed?.height || null
                const renderedWidth = liveImage?.getBoundingClientRect().width ?? 0
                return {
                  image,
                  blob,
                  width,
                  height,
                  displayWidth: Math.min(
                    EXPORT_CONTENT_WIDTH,
                    Math.max(1, renderedWidth || width || EXPORT_CONTENT_WIDTH),
                  ),
                }
              } catch (error) {
                failure = error
              }
            }
            throw failure instanceof Error ? failure : new Error(`无法读取导出图片：${paths[0]}`)
          },
        )
      ).filter((image): image is LocalExportImage => image !== null)

      const plannedDimensions = new Map<HTMLImageElement, { width: number; height: number }>()
      if (deferImageDecoding) {
        const plannable = localImages.filter(
          (image): image is LocalExportImage & { width: number; height: number } =>
            image.width !== null && image.height !== null,
        )
        const plan = planExportImageMemory(
          plannable.map((image) => ({
            width: image.width,
            height: image.height,
            displayWidth: image.displayWidth,
          })),
          {
            documentHeight: Math.max(pm.scrollHeight, pm.getBoundingClientRect().height),
          },
        )
        plan.images.forEach((dimensions, index) => {
          plannedDimensions.set(plannable[index].image, dimensions)
        })

        if (plan.overBudget) {
          const estimatedMb = Math.ceil(plan.estimatedPeakBytes / (1024 * 1024))
          const proceed = await desktop.confirm(
            getLang() === 'en'
              ? `This image-heavy export may use about ${estimatedMb} MB of memory. Images will be optimized to their visible export size. Continue?`
              : `此多图文档预计导出峰值约 ${estimatedMb} MB。图片会按导出可见尺寸自动优化，是否继续？`,
            getLang() === 'en' ? 'Large export' : '大型导出任务',
            getLang() === 'en' ? 'Continue' : '继续导出',
            getLang() === 'en' ? 'Cancel' : '取消',
          )
          if (!proceed) return null
        }
      }

      await mapWithConcurrencyLimit(
        localImages,
        deferImageDecoding ? EXPORT_RESIZE_CONCURRENCY : EXPORT_WORK_CONCURRENCY,
        async (localImage) => {
          const target = plannedDimensions.get(localImage.image)
          let output = localImage.blob
          if (
            target &&
            localImage.width !== null &&
            localImage.height !== null &&
            (target.width < localImage.width || target.height < localImage.height)
          ) {
            output = await resizeImageBlob(
              localImage.blob,
              { width: localImage.width, height: localImage.height },
              target,
            )
          }
          if (deferImageDecoding) {
            const objectUrl = URL.createObjectURL(output)
            localImage.image.setAttribute('src', objectUrl)
            localImage.image.setAttribute(exportOwnedObjectUrlAttribute(), objectUrl)
          } else {
            localImage.image.setAttribute('src', await blobToDataUrl(output))
          }
        },
      )

      // Keep every source in the export document, but defer decoding so the
      // isolated renderer can load images one at a time.
      if (deferImageDecoding) {
        imgs.forEach((img) => {
          const source = img.getAttribute('src')
          if (!source) return
          // Export frames are positioned far off-screen. WebKit will not load
          // lazy images there, so make deferred export images explicitly eager.
          img.setAttribute('loading', 'eager')
          img.setAttribute('decoding', 'sync')
          img.setAttribute('data-xmd-export-src', source)
          img.removeAttribute('src')
        })
      }

      // Production CSS is emitted as <link rel="stylesheet"> by Vite, while
      // custom themes and some editor features use <style>. Reading cssRules
      // captures both forms; selecting only <style> drops Crepe's list/code CSS.
      const liveStyles = serializeStyleSheets(Array.from(document.styleSheets))
      const theme = document.documentElement.getAttribute('data-theme') ?? ''
      const headingNumber = document.documentElement.getAttribute('data-heading-number') ?? ''
      const htmlAttrs = [
        'lang="zh-CN"',
        theme ? `data-theme="${escapeHtmlText(theme)}"` : '',
        headingNumber ? `data-heading-number="${escapeHtmlText(headingNumber)}"` : '',
      ]
        .filter(Boolean)
        .join(' ')

      return `<!doctype html>
<html ${htmlAttrs}><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtmlText(title)}</title>
<style id="xmd-export-runtime-styles">
${liveStyles}
</style>
<style>
  *{scrollbar-width:none}*::-webkit-scrollbar{display:none}
  html,body{margin:0;padding:0;background:var(--bg,#fff)}
  .milkdown{padding:0;background:var(--bg,#fff)}
  .ProseMirror.export-content{max-width:800px;margin:0 auto;padding:48px 40px 80px;outline:none}
  .wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6){font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei UI','Microsoft YaHei','Noto Sans CJK SC',Arial,sans-serif!important}
  .wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6) *{font-family:inherit!important;line-height:inherit}
  .wysiwyg-editor.export-view .milkdown .ProseMirror.export-content :is(h1,h2,h3,h4,h5,h6) strong{font-weight:inherit}
  .wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading{display:flex!important;align-items:center!important;flex-wrap:wrap}
  .wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading::before{align-self:center;flex:none}
  .wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading-run{display:inline-block;flex:none;line-height:1!important;font-weight:inherit!important;white-space:pre}
  .wysiwyg-editor.export-view .milkdown .ProseMirror.export-content .xmd-export-heading-latin{transform:translateY(-0.28em)}
  html[data-heading-number='on'] .export-view .milkdown :is(h1,h2,h3,h4,h5,h6)::before{color:inherit;font-family:inherit;font-size:inherit;font-weight:inherit;line-height:inherit;letter-spacing:inherit}
  .mermaid-export svg{max-width:100%;height:auto}
  ${EXPORT_CODE_STYLES}
</style>
</head><body>
<div class="wysiwyg-editor export-view"><div class="milkdown"><div class="ProseMirror export-content">${clone.innerHTML}</div></div></div>
</body></html>`
    },
    [],
  )

  const exportHTML = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content)
      if (!html) return
      const res = await desktop.exportHTML(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'HTML export failed:\n' : 'HTML 导出失败：\n') +
          (error as Error).message,
      )
    } finally {
      exportInProgressRef.current = false
    }
  }, [generateExportHTML])

  const exportPDF = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content, true)
      if (!html) return
      const res = await desktop.exportPDF(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'PDF export failed:\n' : 'PDF 导出失败：\n') +
          (error as Error).message,
      )
    } finally {
      exportInProgressRef.current = false
    }
  }, [generateExportHTML])

  const exportImage = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content, true)
      if (!html) return
      const res = await desktop.exportImage(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'Image export failed:\n' : '图片导出失败：\n') +
          (error as Error).message,
      )
    } finally {
      exportInProgressRef.current = false
    }
  }, [generateExportHTML])

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

  // ── Palette files (background scan) ───────────────────────────────────────
  const [paletteFiles, setPaletteFiles] = useState<FileEntry[]>([])
  useEffect(() => {
    if (!showPalette || !folder) {
      setPaletteFiles([])
      return
    }
    let cancelled = false
    void desktop
      .listFiles(folder.root)
      .then((list) => {
        if (!cancelled) setPaletteFiles(list)
      })
      .catch((error: unknown) => console.error('File indexing failed', error))
    return () => {
      cancelled = true
    }
  }, [folder?.root, showPalette])

  const paletteCommands = useMemo<Command[]>(
    () => [
      { id: 'new', label: t('新建文件'), run: newFile },
      { id: 'open-file', label: t('打开文件…'), run: openFile },
      { id: 'open-folder', label: t('打开文件夹…'), run: openFolder },
      { id: 'save', label: t('保存'), run: () => activeId && saveTab(activeId) },
      { id: 'save-as', label: t('另存为…'), run: () => activeId && saveAsTab(activeId) },
      {
        id: 'search',
        label: t('在文件夹中搜索'),
        run: () => {
          setSidebarVisible(true)
          setSearchView(true)
        },
      },
      { id: 'find', label: t('查找 / 替换'), run: () => setShowFind(true) },
      { id: 'outline', label: t('切换大纲'), run: () => setOutlineVisible((v) => !v) },
      { id: 'sidebar', label: t('切换侧边栏'), run: () => setSidebarVisible((v) => !v) },
      { id: 'source', label: t('切换源码模式'), run: () => setSourceMode((v) => !v) },
      { id: 'focus', label: t('专注模式'), run: () => setFocusMode((v) => !v) },
      { id: 'typewriter', label: t('打字机模式'), run: () => setTypewriterMode((v) => !v) },
      { id: 'export-html', label: t('导出 HTML'), run: exportHTML },
      { id: 'export-pdf', label: t('导出 PDF'), run: exportPDF },
      { id: 'export-image', label: t('导出图片'), run: exportImage },
      { id: 'settings', label: t('设置'), run: () => setSettingsSection('appearance') },
      { id: 'shortcuts', label: t('快捷键'), run: () => setSettingsSection('shortcuts') },
    ],

    [
      newFile,
      openFile,
      openFolder,
      activeId,
      saveTab,
      saveAsTab,
      exportHTML,
      exportPDF,
      exportImage,
      lang,
    ],
  )

  const dispatchShortcut = useCallback(
    (action: ShortcutAction) => {
      const id = stateRef.current.activeId
      switch (action) {
        case 'new-file':
          newFile()
          break
        case 'open-file':
          void openFile()
          break
        case 'open-folder':
          void openFolder()
          break
        case 'save':
          if (id) void saveTab(id)
          break
        case 'save-as':
          if (id) void saveAsTab(id)
          break
        case 'close-tab':
          if (id) void closeTab(id)
          break
        case 'find':
          setShowFind(true)
          break
        case 'search-in-folder':
          setSidebarVisible(true)
          setSearchView(true)
          break
        case 'select-all':
          clipboardCmd.selectAll()
          break
        case 'command-palette':
          setShowPalette(true)
          break
        case 'toggle-sidebar':
          setSidebarVisible((visible) => !visible)
          break
        case 'toggle-outline':
          setOutlineVisible((visible) => !visible)
          break
        case 'toggle-source':
          setSourceMode((source) => !source)
          break
        case 'toggle-focus':
          setFocusMode((enabled) => !enabled)
          break
        case 'toggle-typewriter':
          setTypewriterMode((enabled) => !enabled)
          break
        case 'open-settings':
          setSettingsSection('appearance')
          break
        case 'show-shortcuts':
          setSettingsSection('shortcuts')
          break
        case 'heading-1':
        case 'heading-2':
        case 'heading-3':
        case 'heading-4':
        case 'heading-5':
        case 'heading-6':
          editorCmd.heading(Number(action.at(-1)))
          break
        case 'paragraph':
          editorCmd.paragraph()
          break
        case 'bold':
          editorCmd.bold()
          break
        case 'italic':
          editorCmd.italic()
          break
        case 'inline-code':
          editorCmd.inlineCode()
          break
        case 'quote':
          editorCmd.quote()
          break
        case 'code-block':
          editorCmd.codeBlock()
          break
        case 'bullet-list':
          editorCmd.bulletList()
          break
        case 'ordered-list':
          editorCmd.orderedList()
          break
      }
    },
    [closeTab, newFile, openFile, openFolder, saveAsTab, saveTab],
  )

  useAppShortcuts(settings?.shortcuts ?? EMPTY_SHORTCUTS, dispatchShortcut)

  // ── Auto-save ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings?.autoSave || !activeTab?.path || !activeTab.dirty) return
    const id = setTimeout(() => void saveTab(activeTab.id), 1200)
    return () => clearTimeout(id)
  }, [settings?.autoSave, activeTab?.content, activeTab?.dirty, activeTab?.id, saveTab])

  // ── Native menu actions ───────────────────────────────────────────────────
  useEffect(() => {
    return desktop.onMenuAction((action) => {
      if (isShortcutAction(action)) {
        dispatchShortcut(action)
        return
      }
      switch (action) {
        case 'export-html':
          void exportHTML()
          break
        case 'export-pdf':
          void exportPDF()
          break
        case 'export-image':
          void exportImage()
          break
        case 'check-updates':
          void updater.checkNow(true)
          break
        case 'query-dirty': {
          const dirtyTabs = stateRef.current.tabs.filter((tab) => tab.dirty)
          if (dirtyTabs.length === 0) {
            void clearRuntimeDrafts().finally(() => desktop.notifyQuitOk())
            break
          }
          if (quitPromptOpenRef.current) break
          quitPromptOpenRef.current = true
          void requestCloseDecision(dirtyTabs, 'quit')
            .then(async (decision) => {
              if (decision === 'cancel') return
              if (decision === 'save') {
                for (const tab of dirtyTabs) {
                  if (!(await saveTab(tab.id))) return
                }
              }
              await deleteDrafts(dirtyTabs.map((tab) => tab.id))
              desktop.notifyQuitOk()
            })
            .finally(() => {
              quitPromptOpenRef.current = false
            })
          break
        }
      }
    })
  }, [
    dispatchShortcut,
    exportHTML,
    exportPDF,
    exportImage,
    clearRuntimeDrafts,
    deleteDrafts,
    requestCloseDecision,
    saveTab,
    stateRef,
    updater.checkNow,
  ])

  // Keep web links outside the editor webview. Relative/local links continue
  // through the editor so wiki-style and document navigation remain intact.
  useEffect(() => {
    const openExternalLink = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor || !/^https?:\/\//i.test(anchor.href)) return
      event.preventDefault()
      void desktop.openExternal(anchor.href)
    }
    document.addEventListener('click', openExternalLink)
    return () => document.removeEventListener('click', openExternalLink)
  }, [])

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
            onClose={() => {
              setShowFind(false)
              setFindInitial('')
              setFindLine(undefined)
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
            initialSection={settingsSection}
            onChange={(patch) => void saveSettings(patch)}
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
