import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { desktop } from './platform'
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
import { escapeHtmlText, serializeStyleSheets } from './lib/exportStyles'
import { getLang, t } from './lib/i18n'
import { baseName, dirName } from './lib/path'
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Pilcrow,
  Copy,
  Scissors,
  ClipboardPaste,
  TextSelect,
} from 'lucide-react'
import { parseOutline } from './lib/outline'
import type { Folder } from './types'
import { useSettings } from './hooks/useSettings'
import { useFileOps } from './hooks/useFileOps'
import { useTreeOps } from './hooks/useTreeOps'

interface FileEntry {
  path: string
  name: string
}

export default function App(): JSX.Element {
  // ── Settings (theme, width, i18n, CSS side-effects all live here) ──────────
  const {
    settings,
    settingsReady,
    saveSettings,
    pushRecentFile,
    pushRecentFolder,
    toggleFavorite,
  } = useSettings()

  const lang = settings?.language ?? 'zh'

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
    saveTab,
    saveAsTab,
    closeTab,
    closeOthers,
    closeAllTabs,
    closeLeft,
    closeRight,
    updateContent,
    restoreSession,
    hasDirtyTabs,
  } = useFileOps({ pushRecentFile, lang })

  const activeDocDir = activeTab ? (dirName(activeTab.path) ?? folder?.root ?? null) : null
  const outline = useMemo(
    () => (activeTab ? parseOutline(activeTab.content) : []),

    [activeTab?.content],
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
      const result = await desktop.openFolderPath(fileParent)
      if (result) {
        setFolder(result)
        pushRecentFolder(result.root)
      }
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
  useEffect(() => {
    if (!settingsReady || didRestore.current || !settings) return
    didRestore.current = true
    void (async () => {
      if (settings.session?.folder) {
        const res = await desktop.openFolderPath(settings.session.folder)
        if (res) setFolder(res)
      }
      if (settings.session?.openFiles?.length) {
        await restoreSession(settings.session.openFiles, settings.session.activePath)
      }
    })().catch((error: unknown) => console.error('Session restore failed', error))
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
      activePath: activeTab?.path ?? null,
    }
    const timer = setTimeout(() => {
      void desktop
        .setSettings({ session })
        .catch((error: unknown) => console.error('Session persistence failed', error))
    }, 500)
    return () => clearTimeout(timer)
  }, [folder?.root, tabPathsKey, activeTab?.path])

  // ── File tree ops ──────────────────────────────────────────────────────────
  const { treeKey, refreshTree, openNodeContext, openRootContext } = useTreeOps({
    folder,
    setFolder: setFolderUpdater,
    openPath,
    closeTab,
    tabs,
    setCtxMenu,
    setInputDialog,
  })

  // ── Folder open ────────────────────────────────────────────────────────────
  const openFolder = useCallback(async () => {
    const result = await desktop.openFolder()
    if (result) {
      setFolder(result)
      pushRecentFolder(result.root)
    }
  }, [pushRecentFolder])

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

  // ── System open-path (file association / double-click) ────────────────────
  useEffect(() => {
    if (!desktop) return undefined
    const dispose = desktop.onOpenPath((p) => openPath(p, baseName(p)))
    desktop.notifyReady()
    return dispose
  }, [openPath])

  // ── Tab context menu ───────────────────────────────────────────────────────
  const openTabContext = useCallback(
    (id: string, x: number, y: number) => {
      const list = stateRef.current.tabs
      const idx = list.findIndex((tb) => tb.id === id)
      const items: MenuItem[] = [
        { label: t('关闭'), onClick: () => closeTab(id) },
        { label: t('关闭其他'), onClick: () => closeOthers(id) },
      ]
      if (idx > 0) items.push({ label: t('关闭左侧全部'), onClick: () => closeLeft(id) })
      if (idx >= 0 && idx < list.length - 1)
        items.push({ label: t('关闭右侧全部'), onClick: () => closeRight(id) })
      items.push({ label: t('关闭全部'), onClick: closeAllTabs, separatorBefore: true })
      setCtxMenu({ x, y, items })
    },
    [closeTab, closeOthers, closeLeft, closeRight, closeAllTabs],
  )

  // ── Editor right-click menu ────────────────────────────────────────────────
  const openEditorContext = useCallback((x: number, y: number) => {
    const sz = 15
    const items: MenuItem[] = [
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
        },
        { label: t('斜体'), icon: <Italic size={sz} />, hint: '⌘I', onClick: editorCmd.italic },
        {
          label: t('行内代码'),
          icon: <Code size={sz} />,
          hint: '⌘E',
          onClick: editorCmd.inlineCode,
        },
        {
          label: t('标题 1'),
          icon: <Heading1 size={sz} />,
          onClick: () => editorCmd.heading(1),
          separatorBefore: true,
        },
        { label: t('标题 2'), icon: <Heading2 size={sz} />, onClick: () => editorCmd.heading(2) },
        { label: t('标题 3'), icon: <Heading3 size={sz} />, onClick: () => editorCmd.heading(3) },
        { label: t('正文'), icon: <Pilcrow size={sz} />, onClick: editorCmd.paragraph },
        {
          label: t('无序列表'),
          icon: <List size={sz} />,
          onClick: editorCmd.bulletList,
          separatorBefore: true,
        },
        { label: t('有序列表'), icon: <ListOrdered size={sz} />, onClick: editorCmd.orderedList },
        { label: t('引用'), icon: <Quote size={sz} />, onClick: editorCmd.quote },
        { label: t('代码块'), icon: <SquareCode size={sz} />, onClick: editorCmd.codeBlock },
      )
    }
    items.push({
      label: t('全选'),
      icon: <TextSelect size={sz} />,
      hint: '⌘A',
      onClick: clipboardCmd.selectAll,
      separatorBefore: true,
    })
    setCtxMenu({ x, y, items, preserveSelection: true })
  }, [])

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
    async (title: string, mdContent?: string): Promise<string | null> => {
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

      // For each code block: collect the rendered SVG (or render it now).
      const blockSVGs: (string | null)[] = await Promise.all(
        liveBlocks.map(async (block, i) => {
          // Already rendered? extract the SVG from the live preview panel.
          const mermaidPreviewEl = block.querySelector<HTMLElement>(
            '.preview-panel .preview .mermaid-preview',
          )
          if (mermaidPreviewEl) {
            const svgEl = mermaidPreviewEl.querySelector('svg') ?? mermaidPreviewEl
            return svgEl.outerHTML
          }

          // Determine language: from language-button (initialized block) or from parsed markdown.
          const langBtn = block.querySelector<HTMLElement>('.tools .language-button')
          const langFromBtn = langBtn?.textContent?.trim().toLowerCase() ?? ''
          const lang = langFromBtn || (mdBlocks[i]?.lang ?? '')
          if (lang !== 'mermaid') return null

          // Get code text: prefer cm-editor lines, fall back to placeholder, then parsed markdown.
          const cmLines = block.querySelectorAll<HTMLElement>('.cm-line')
          const codeFromDOM =
            cmLines.length > 0
              ? Array.from(cmLines)
                  .map((l) => l.textContent ?? '')
                  .join('\n')
              : (block.querySelector<HTMLElement>('.milkdown-code-block-placeholder code')
                  ?.textContent ?? '')
          const code = codeFromDOM.trim() || (mdBlocks[i]?.code ?? '')
          if (!code.trim()) return null

          try {
            const mermaid = (await import('mermaid')).default
            mermaid.initialize({ startOnLoad: false, theme: mermaidTheme, securityLevel: 'strict' })
            const id = 'mmd-export-' + Math.random().toString(36).slice(2)
            const { svg } = await mermaid.render(id, code)
            return svg
          } catch {
            return null
          }
        }),
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

      // Reading-view code block processing.
      const cloneBlocks = Array.from(clone.querySelectorAll<HTMLElement>('.milkdown-code-block'))
      cloneBlocks.forEach((block, i) => {
        const svg = blockSVGs[i]
        if (svg) {
          // Replace the entire code block with the static SVG.
          const wrapper = document.createElement('div')
          wrapper.className = 'mermaid-export'
          wrapper.style.cssText = 'margin:16px 0;overflow:auto;text-align:center'
          wrapper.innerHTML = svg
          block.replaceWith(wrapper)
        } else {
          // Non-mermaid: ensure the code editor is visible (user may have been in preview mode).
          block.querySelector<HTMLElement>('.codemirror-host')?.classList.remove('hidden')
          // Remove any stale preview panel that shouldn't appear without the toggle button.
          block.querySelector<HTMLElement>('.preview-panel')?.remove()
        }
      })

      // Inline xmd:// images as base64 so the HTML is fully self-contained.
      const imgs = Array.from(clone.querySelectorAll<HTMLImageElement>('img[src]'))
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
          } catch {
            /* leave original src */
          }
        }),
      )

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
  .mermaid-export svg{max-width:100%;height:auto}
</style>
</head><body>
<div class="milkdown"><div class="ProseMirror export-content">${clone.innerHTML}</div></div>
</body></html>`
    },
    [],
  )

  const exportHTML = useCallback(async () => {
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content)
      if (!html) return
      const res = await desktop.exportHTML(html, tab?.name ?? 'document')
      if (res)
        window.alert((getLang() === 'en' ? 'Exported HTML:\n' : '已导出 HTML：\n') + res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'HTML export failed:\n' : 'HTML 导出失败：\n') +
          (error as Error).message,
      )
    }
  }, [generateExportHTML])

  const exportPDF = useCallback(async () => {
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content)
      if (!html) return
      const res = await desktop.exportPDF(html, tab?.name ?? 'document')
      if (res) window.alert((getLang() === 'en' ? 'Exported PDF:\n' : '已导出 PDF：\n') + res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'PDF export failed:\n' : 'PDF 导出失败：\n') +
          (error as Error).message,
      )
    }
  }, [generateExportHTML])

  const exportImage = useCallback(async () => {
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content)
      if (!html) return
      const res = await desktop.exportImage(html, tab?.name ?? 'document')
      if (res)
        window.alert((getLang() === 'en' ? 'Exported image:\n' : '已导出图片：\n') + res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'Image export failed:\n' : '图片导出失败：\n') +
          (error as Error).message,
      )
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
            if (tab.path === sourcePath) {
              return { ...tab, path: res.path, name: res.name }
            }
            // Folder move: update all tabs inside the moved folder
            const sep = sourcePath.endsWith('/') ? '' : '/'
            if (tab.path.startsWith(sourcePath + sep)) {
              const newPath = res.path + tab.path.slice(sourcePath.length)
              return { ...tab, path: newPath, name: baseName(newPath) ?? tab.name }
            }
            return tab
          }),
        )
        await refreshTree()
      } catch (err) {
        window.alert(
          (getLang() === 'en' ? 'Move failed:\n' : '移动失败：\n') + (err as Error).message,
        )
      }
    },
    [refreshTree, setTabs],
  )

  // ── Palette files (background scan) ───────────────────────────────────────
  const [paletteFiles, setPaletteFiles] = useState<FileEntry[]>([])
  useEffect(() => {
    if (!folder) {
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
  }, [folder?.root])

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
      { id: 'settings', label: t('设置'), run: () => setShowSettings(true) },
      { id: 'shortcuts', label: t('快捷键'), run: () => setShowShortcuts(true) },
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

  // ── Auto-save ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings?.autoSave || !activeTab?.path || !activeTab.dirty) return
    const id = setTimeout(() => void saveTab(activeTab.id), 1200)
    return () => clearTimeout(id)
  }, [settings?.autoSave, activeTab?.content, activeTab?.dirty, activeTab?.id, saveTab])

  // ── Native menu actions ───────────────────────────────────────────────────
  useEffect(() => {
    if (!desktop) return undefined
    return desktop.onMenuAction((action) => {
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
          if (id) closeTab(id)
          break
        case 'toggle-sidebar':
          setSidebarVisible((v) => !v)
          break
        case 'toggle-outline':
          setOutlineVisible((v) => !v)
          break
        case 'toggle-source':
          setSourceMode((v) => !v)
          break
        case 'toggle-focus':
          setFocusMode((v) => !v)
          break
        case 'toggle-typewriter':
          setTypewriterMode((v) => !v)
          break
        case 'find':
          setShowFind(true)
          break
        case 'search-in-folder':
          setSidebarVisible(true)
          setSearchView(true)
          break
        case 'open-settings':
          setShowSettings(true)
          break
        case 'show-shortcuts':
          setShowShortcuts(true)
          break
        case 'command-palette':
          setShowPalette(true)
          break
        case 'export-html':
          void exportHTML()
          break
        case 'export-pdf':
          void exportPDF()
          break
        case 'export-image':
          void exportImage()
          break
        case 'query-dirty': {
          const dirty = hasDirtyTabs()
          if (!dirty) {
            desktop.notifyQuitOk()
            break
          }
          if (quitPromptOpenRef.current) break
          quitPromptOpenRef.current = true
          const english = getLang() === 'en'
          void desktop
            .confirm(
              english ? 'You have unsaved changes. Quit anyway?' : '还有未保存的文件，确定退出？',
              english ? 'Unsaved changes' : '未保存的修改',
              english ? 'Quit' : '退出',
              english ? 'Cancel' : '取消',
            )
            .then((proceed) => {
              if (proceed) desktop.notifyQuitOk()
            })
            .finally(() => {
              quitPromptOpenRef.current = false
            })
          break
        }
      }
    })
  }, [
    newFile,
    openFile,
    openFolder,
    saveTab,
    saveAsTab,
    closeTab,
    exportHTML,
    exportPDF,
    exportImage,
    hasDirtyTabs,
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
            onClose={() => {
              setShowFind(false)
              setFindInitial('')
              setFindLine(undefined)
            }}
          />
        )}

        <div
          className="editor-area"
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.tagName === 'IMG') {
              const src =
                (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src
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
          onShowShortcuts={() => {
            setShowSettings(false)
            setShowShortcuts(true)
          }}
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
