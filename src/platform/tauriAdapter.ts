import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Image } from '@tauri-apps/api/image'
import { writeHtml, writeImage } from '@tauri-apps/plugin-clipboard-manager'
import { ask, open, save } from '@tauri-apps/plugin-dialog'
import { readFile as readBinaryFile, writeFile as writeBinaryFile } from '@tauri-apps/plugin-fs'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import type {
  AvailableUpdate,
  AppInfo,
  AppSettings,
  DesktopPort,
  FileNode,
  Folder,
  OpenedFile,
  SearchResult,
  UpdaterPort,
} from './contracts'
import { releaseExportObjectUrls } from '../lib/exportImageAsset'

const MAX_BINARY_READ_BYTES = 64 * 1024 * 1024

function binaryReadLimit(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MAX_BINARY_READ_BYTES
  return Math.min(MAX_BINARY_READ_BYTES, Math.max(1, Math.floor(value)))
}

function subscribe<T>(
  event: string,
  callback: (payload: T) => void,
  onSubscribed?: () => void,
): () => void {
  let disposed = false
  let unlisten: UnlistenFn | undefined

  void listen<T>(event, ({ payload }) => callback(payload)).then((stop) => {
    if (disposed) stop()
    else {
      unlisten = stop
      onSubscribed?.()
    }
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}

function imageFormatForPath(path: string): 'png' | 'jpeg' {
  return /\.jpe?g$/i.test(path) ? 'jpeg' : 'png'
}

function updateSource(update: Update): 'github' | 'gitee' {
  return JSON.stringify(update.rawJson).toLowerCase().includes('gitee.com') ? 'gitee' : 'github'
}

function adaptUpdate(update: Update): AvailableUpdate {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body,
    source: updateSource(update),
    downloadAndInstall: (onEvent) =>
      update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          onEvent({ event: 'Started', contentLength: event.data.contentLength })
        } else if (event.event === 'Progress') {
          onEvent({ event: 'Progress', chunkLength: event.data.chunkLength })
        } else {
          onEvent({ event: 'Finished' })
        }
      }),
    close: () => update.close(),
  }
}

export const tauriUpdaterAdapter: UpdaterPort = {
  check: async (timeoutMs) => {
    const update = await check({ timeout: timeoutMs })
    return update ? adaptUpdate(update) : null
  },
  relaunch,
}

export const tauriDesktopAdapter: DesktopPort = {
  getAppInfo: () => invoke<AppInfo>('get_app_info'),
  openFolder: async (initialPath) => {
    const root = await open({
      directory: true,
      multiple: false,
      recursive: true,
      ...(initialPath ? { defaultPath: initialPath } : {}),
    })
    return root ? invoke<Folder | null>('open_folder_path', { root }) : null
  },
  openFolderPath: (root) => invoke<Folder | null>('open_folder_path', { root }),
  openParentFolder: (root) => invoke<Folder | null>('open_parent_folder', { root }),
  openContainingFolder: (filePath) => invoke<Folder | null>('open_containing_folder', { filePath }),
  openFile: async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt'] }],
    })
    return path ? invoke<OpenedFile>('read_file', { path }) : null
  },
  readFile: (path) => invoke<OpenedFile>('read_file', { path }),
  readBinaryFile: async (path, maxBytes = MAX_BINARY_READ_BYTES) => {
    const limit = binaryReadLimit(maxBytes)
    await invoke('check_binary_file', { path, maxBytes: limit })
    const bytes = await readBinaryFile(path)
    if (bytes.byteLength > limit) throw new Error(`资源超过读取上限（${limit} bytes）`)
    return bytes
  },
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
  listDrafts: () => invoke('list_drafts'),
  readDraft: (id) => invoke('read_draft', { id }),
  saveDraft: (id, path, name, content) => invoke('save_draft', { id, path, name, content }),
  deleteDraft: (id) => invoke('delete_draft', { id }),
  reveal: (targetPath) => revealItemInDir(targetPath),
  openExternal: (url) => openUrl(url),
  moveItem: (sourcePath, targetDirPath) => invoke('move_item', { sourcePath, targetDirPath }),
  searchInFolder: (root, query) => invoke<SearchResult[]>('search_in_folder', { root, query }),
  cancelSearch: () => invoke('cancel_search'),
  saveAttachment: (docDir, docName, vaultRoot, fileName, data) =>
    invoke('save_attachment', data, {
      headers: {
        'x-xmd-attachment': encodeURIComponent(
          JSON.stringify({ docDir, docName, vaultRoot, fileName }),
        ),
      },
    }),
  writeClipboardHtml: (html, altText) => writeHtml(html, altText),
  writeClipboardImage: async (png) => {
    const image = await Image.fromBytes(png)
    try {
      await writeImage(image)
    } finally {
      await image.close()
    }
  },
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
    try {
      const path = await save({
        defaultPath: suggestedName.replace(/\.md$/i, '') + '.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (!path) return null
      const { renderDocumentPdf } = await import('../lib/exportDocument')
      await writeBinaryFile(path, await renderDocumentPdf(html))
      return { path }
    } finally {
      releaseExportObjectUrls(html)
    }
  },
  exportImage: async (html, suggestedName) => {
    try {
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
    } finally {
      releaseExportObjectUrls(html)
    }
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
  onMenuAction: (callback) => subscribe('menu-action', callback),
  onOpenPath: (callback) =>
    subscribe('open-path', callback, () => {
      void invoke('frontend_ready')
    }),
  notifyQuitOk: () => void invoke('quit_confirmed'),
}
