import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { ask, open, save } from '@tauri-apps/plugin-dialog'
import { writeFile as writeBinaryFile } from '@tauri-apps/plugin-fs'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import type {
  AppInfo,
  AppSettings,
  DesktopPort,
  FileNode,
  Folder,
  OpenedFile,
  SearchResult,
} from './contracts'

function subscribe<T>(event: string, callback: (payload: T) => void): () => void {
  let disposed = false
  let unlisten: UnlistenFn | undefined

  void listen<T>(event, ({ payload }) => callback(payload)).then((stop) => {
    if (disposed) stop()
    else unlisten = stop
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}

function imageFormatForPath(path: string): 'png' | 'jpeg' {
  return /\.jpe?g$/i.test(path) ? 'jpeg' : 'png'
}

export const tauriDesktopAdapter: DesktopPort = {
  getAppInfo: () => invoke<AppInfo>('get_app_info'),
  openFolder: async () => {
    const root = await open({ directory: true, multiple: false })
    return root ? invoke<Folder | null>('open_folder_path', { root }) : null
  },
  openFolderPath: (root) => invoke<Folder | null>('open_folder_path', { root }),
  openFile: async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt'] }],
    })
    return path ? invoke<OpenedFile>('read_file', { path }) : null
  },
  readFile: (path) => invoke<OpenedFile>('read_file', { path }),
  writeFile: (path, content) => invoke('write_file', { path, content }),
  saveAs: async (content, suggestedName) => {
    const path = await save({
      defaultPath: suggestedName ?? 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (!path) return null
    await invoke('write_file', { path, content })
    return { path, name: path.split(/[\\/]/).pop() ?? suggestedName ?? 'untitled.md' }
  },
  readDir: (path) => invoke<FileNode[]>('read_dir', { path }),
  listFiles: (root) => invoke('list_files', { root }),
  createFile: (dirPath, fileName) => invoke('create_file', { dirPath, fileName }),
  createDir: (dirPath, name) => invoke('create_dir', { dirPath, name }),
  rename: (oldPath, newName) => invoke('rename_item', { oldPath, newName }),
  trash: (targetPath) => invoke('trash_item', { targetPath }),
  reveal: (targetPath) => revealItemInDir(targetPath),
  openExternal: (url) => openUrl(url),
  moveItem: (sourcePath, targetDirPath) => invoke('move_item', { sourcePath, targetDirPath }),
  searchInFolder: (root, query) => invoke<SearchResult[]>('search_in_folder', { root, query }),
  saveAttachment: (docDir, docName, vaultRoot, fileName, data) =>
    invoke('save_attachment', { docDir, docName, vaultRoot, fileName, data: Array.from(data) }),
  getSettings: () => invoke<AppSettings>('get_settings'),
  setSettings: (patch) => invoke<AppSettings>('set_settings', { patch }),
  findInPage: (text, forward = true, findNext = false) => {
    const editor = document.querySelector<HTMLTextAreaElement>('.source-editor')
    if (!editor || !text) return Promise.resolve()
    const content = editor.value.toLocaleLowerCase()
    const needle = text.toLocaleLowerCase()
    const start = findNext
      ? forward
        ? editor.selectionEnd
        : Math.max(0, editor.selectionStart - 1)
      : forward
        ? 0
        : content.length
    let index = forward ? content.indexOf(needle, start) : content.lastIndexOf(needle, start)
    if (index < 0 && findNext) {
      index = forward ? content.indexOf(needle) : content.lastIndexOf(needle)
    }
    if (index >= 0) {
      editor.focus()
      editor.setSelectionRange(index, index + text.length)
    }
    return Promise.resolve()
  },
  stopFind: () => Promise.resolve(),
  exportHTML: async (html, suggestedName) => {
    const path = await save({
      defaultPath: suggestedName.replace(/\.md$/i, '') + '.html',
      filters: [{ name: 'HTML', extensions: ['html'] }],
    })
    if (!path) return null
    await invoke('write_file', { path, content: html })
    return { path }
  },
  exportPDF: async (html, suggestedName) => {
    const path = await save({
      defaultPath: suggestedName.replace(/\.md$/i, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!path) return null
    const { renderDocumentPdf } = await import('../lib/exportDocument')
    await writeBinaryFile(path, await renderDocumentPdf(html))
    return { path }
  },
  exportImage: async (html, suggestedName) => {
    const path = await save({
      defaultPath: suggestedName.replace(/\.md$/i, '') + '.png',
      filters: [
        { name: 'PNG 图片', extensions: ['png'] },
        { name: 'JPEG 图片', extensions: ['jpg', 'jpeg'] },
      ],
    })
    if (!path) return null
    const { renderDocumentImage } = await import('../lib/exportDocument')
    await writeBinaryFile(path, await renderDocumentImage(html, imageFormatForPath(path)))
    return { path }
  },
  pickCss: async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'CSS', extensions: ['css'] }],
    })
    return path ? { path } : null
  },
  confirm: (message, title, okLabel, cancelLabel) =>
    ask(message, {
      title,
      kind: 'warning',
      okLabel,
      cancelLabel,
    }),
  setLanguage: (language) => invoke('set_language', { language }),
  onMenuAction: (callback) => subscribe('menu-action', callback),
  onOpenPath: (callback) => subscribe('open-path', callback),
  notifyReady: () => void invoke('frontend_ready'),
  notifyQuitOk: () => void invoke('quit_confirmed'),
}
