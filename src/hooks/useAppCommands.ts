import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Command } from '../components/CommandPalette'
import type { SettingsSection } from '../components/Settings'
import { desktop } from '../platform'
import type { Folder, Tab } from '../types'
import { useAppShortcuts } from './useAppShortcuts'
import { clipboardCmd, editorCmd } from '../lib/editorCommands'
import { t } from '../lib/i18n'
import type { ShortcutAction } from '../lib/shortcuts'

interface FileEntry {
  path: string
  name: string
}

interface AppCommandOptions {
  folder: Folder | null
  showPalette: boolean
  activeId: string | null
  stateRef: { current: { tabs: Tab[]; activeId: string | null } }
  shortcuts: Record<string, string>
  lang: string
  newFile: () => void
  openFile: () => Promise<void>
  openFolder: () => Promise<void>
  saveTab: (id: string) => Promise<boolean>
  saveAsTab: (id: string) => Promise<void>
  closeTab: (id: string) => Promise<void>
  exportHTML: () => Promise<void>
  exportPDF: () => Promise<void>
  exportImage: () => Promise<void>
  exportDocx: () => Promise<void>
  importDocx: () => Promise<void>
  setShowPalette: Dispatch<SetStateAction<boolean>>
  setSidebarVisible: Dispatch<SetStateAction<boolean>>
  setSearchView: Dispatch<SetStateAction<boolean>>
  setShowFind: Dispatch<SetStateAction<boolean>>
  setOutlineVisible: Dispatch<SetStateAction<boolean>>
  setSourceMode: Dispatch<SetStateAction<boolean>>
  setFocusMode: Dispatch<SetStateAction<boolean>>
  setTypewriterMode: Dispatch<SetStateAction<boolean>>
  toggleSelectionToolbar: () => void
  setSettingsSection: Dispatch<SetStateAction<SettingsSection | null>>
}

export function useAppCommands(options: AppCommandOptions): {
  paletteFiles: FileEntry[]
  paletteCommands: Command[]
  dispatchShortcut: (action: ShortcutAction) => void
} {
  const {
    folder,
    showPalette,
    activeId,
    stateRef,
    shortcuts,
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
  } = options
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
  }, [folder, showPalette])

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
      { id: 'outline', label: t('切换大纲'), run: () => setOutlineVisible((value) => !value) },
      { id: 'sidebar', label: t('切换侧边栏'), run: () => setSidebarVisible((value) => !value) },
      { id: 'source', label: t('切换源码模式'), run: () => setSourceMode((value) => !value) },
      { id: 'focus', label: t('专注模式'), run: () => setFocusMode((value) => !value) },
      {
        id: 'typewriter',
        label: t('打字机模式'),
        run: () => setTypewriterMode((value) => !value),
      },
      { id: 'export-html', label: t('导出 HTML'), run: exportHTML },
      { id: 'export-pdf', label: t('导出 PDF'), run: exportPDF },
      { id: 'export-image', label: t('导出图片'), run: exportImage },
      { id: 'export-docx', label: t('导出 Word'), run: exportDocx },
      { id: 'import-docx', label: t('导入 Word 文档…'), run: importDocx },
      { id: 'settings', label: t('设置'), run: () => setSettingsSection('appearance') },
      { id: 'shortcuts', label: t('快捷键'), run: () => setSettingsSection('shortcuts') },
    ],
    [
      activeId,
      exportDocx,
      exportHTML,
      exportImage,
      exportPDF,
      importDocx,
      lang,
      newFile,
      openFile,
      openFolder,
      saveAsTab,
      saveTab,
      setFocusMode,
      setOutlineVisible,
      setSearchView,
      setSettingsSection,
      setShowFind,
      setSidebarVisible,
      setSourceMode,
      setTypewriterMode,
    ],
  )

  const dispatchShortcut = useCallback(
    (action: ShortcutAction) => {
      const id = stateRef.current.activeId
      const toggle = (setter: Dispatch<SetStateAction<boolean>>): void => setter((value) => !value)
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
          toggle(setSidebarVisible)
          break
        case 'toggle-outline':
          toggle(setOutlineVisible)
          break
        case 'toggle-source':
          toggle(setSourceMode)
          break
        case 'toggle-focus':
          toggle(setFocusMode)
          break
        case 'toggle-typewriter':
          toggle(setTypewriterMode)
          break
        case 'toggle-selection-toolbar':
          toggleSelectionToolbar()
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
        case 'promote-heading':
          editorCmd.promoteHeading()
          break
        case 'demote-heading':
          editorCmd.demoteHeading()
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
    [
      closeTab,
      newFile,
      openFile,
      openFolder,
      saveAsTab,
      saveTab,
      setFocusMode,
      setOutlineVisible,
      setSearchView,
      setSettingsSection,
      setShowFind,
      setShowPalette,
      setSidebarVisible,
      setSourceMode,
      setTypewriterMode,
      toggleSelectionToolbar,
      stateRef,
    ],
  )

  useAppShortcuts(shortcuts, dispatchShortcut)
  return { paletteFiles, paletteCommands, dispatchShortcut }
}
