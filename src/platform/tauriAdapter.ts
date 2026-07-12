import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Image } from '@tauri-apps/api/image'
import { writeHtml, writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { ask, message, open, save } from '@tauri-apps/plugin-dialog'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import type {
  AvailableUpdate,
  AppInfo,
  AppSettings,
  DesktopPort,
  FileNode,
  FileVersion,
  Folder,
  OpenedFile,
  SearchResponse,
  UpdaterPort,
} from './contracts'
import { releaseExportObjectUrls } from '../lib/exportImageAsset'
import { imageFormatForPath } from '../lib/exportFormat'
import { dirName } from '../lib/path'

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
  pickFolder: async () => {
    const path = await open({ directory: true, multiple: false, recursive: true })
    return path ? { path } : null
  },
  openFolderPath: (root) => invoke<Folder | null>('open_folder_path', { root }),
  openParentFolder: async (root) => {
    const parent = dirName(root)
    if (!parent) return null
    return invoke<Folder | null>('open_folder_path', { root: parent })
  },
  openContainingFolder: (filePath) => invoke<Folder | null>('open_containing_folder', { filePath }),
  openFile: async () => {
    const path = await open({
      multiple: false,
      filters: [
        {
          name: 'Text',
          extensions: [
            'md',
            'markdown',
            'mdown',
            'mkd',
            'mdx',
            'txt',
            'log',
            'json',
            'json5',
            'jsonc',
            'yaml',
            'yml',
            'toml',
            'ini',
            'conf',
            'properties',
            'xml',
            'svg',
            'html',
            'htm',
            'css',
            'js',
            'mjs',
            'cjs',
            'jsx',
            'ts',
            'mts',
            'cts',
            'tsx',
            'sql',
            'sh',
            'bash',
            'zsh',
          ],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    return path ? invoke<OpenedFile>('read_file', { path }) : null
  },
  readFile: (path) => invoke<OpenedFile>('read_file', { path }),
  readBinaryFile: async (path, maxBytes = MAX_BINARY_READ_BYTES) => {
    const limit = binaryReadLimit(maxBytes)
    // Rust 侧返回 tauri::ipc::Response（原始二进制通道），前端实际收到的是
    // ArrayBuffer；这里统一规范成 Uint8Array，避免下游按 TypedArray 处理时
    // 拿到全零数据（TypedArray.set 对非 array-like 的 ArrayBuffer 不拷贝）。
    return new Uint8Array(await invoke<ArrayBuffer>('read_binary_file', { path, maxBytes: limit }))
  },
  readRemoteImage: async (url) =>
    new Uint8Array(await invoke<ArrayBuffer>('read_remote_image', { url })),
  writeFile: (path, content, expectedVersion, force = false) =>
    invoke('write_file', { path, content, expectedVersion, force }),
  saveAs: async (content, suggestedName) => {
    const path = await save({
      defaultPath: suggestedName ?? 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (!path) return null
    const result = await invoke<{ path: string; version: FileVersion }>('write_file', {
      path,
      content,
      expectedVersion: null,
      force: true,
    })
    return {
      path,
      name: path.split(/[\\/]/).pop() ?? suggestedName ?? 'untitled.md',
      version: result.version,
    }
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
  openWithDefault: (path) => invoke('open_with_default', { path }),
  moveItem: (sourcePath, targetDirPath) => invoke('move_item', { sourcePath, targetDirPath }),
  searchInFolder: (root, query) => invoke<SearchResponse>('search_in_folder', { root, query }),
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
  writeClipboardText: (text) => writeText(text),
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
    // Use toLowerCase (not locale-specific) so indices remain stable for setSelectionRange.
    const content = editor.value.toLowerCase()
    const needle = text.toLowerCase()
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
    await invoke('write_file', { path, content: html, expectedVersion: null, force: true })
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
      await invoke('write_binary_file', await renderDocumentPdf(html), {
        headers: { 'x-xmd-output-path': encodeURIComponent(path) },
      })
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
      await invoke('write_binary_file', await renderDocumentImage(html, imageFormatForPath(path)), {
        headers: { 'x-xmd-output-path': encodeURIComponent(path) },
      })
      return { path }
    } finally {
      releaseExportObjectUrls(html)
    }
  },
  pandocStatus: () => invoke<{ path: string; version: string } | null>('pandoc_status'),
  exportDocx: async (markdown, docDir, suggestedName) => {
    const path = await save({
      defaultPath: suggestedName.replace(/\.md$/i, '') + '.docx',
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    })
    if (!path) return null
    await invoke('export_docx', { markdown, docDir, outputPath: path })
    return { path }
  },
  importDocx: async (mediaSubdir) => {
    const docxPath = await open({
      multiple: false,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    })
    if (!docxPath) return null
    return invoke<{ markdownPath: string }>('import_docx', { docxPath, mediaSubdir })
  },
  pickPandocExecutable: async () => {
    const path = await open({ multiple: false })
    return path ? { path } : null
  },
  pickWordTemplate: async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Word Template', extensions: ['docx'] }],
    })
    return path ? { path } : null
  },
  savePandocDefaultTemplate: async () => {
    const path = await save({
      defaultPath: 'reference.docx',
      filters: [{ name: 'Word Template', extensions: ['docx'] }],
    })
    if (!path) return null
    return invoke<{ path: string }>('export_pandoc_default_template', { outputPath: path })
  },
  pickCss: async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'CSS', extensions: ['css'] }],
    })
    return path ? { path } : null
  },
  pickImage: async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    return path ? { path } : null
  },
  allowBackgroundImage: (path) => invoke('allow_background_image', { path }),
  notify: (msg, title) => message(msg, { title }).then(() => {}),
  confirm: (msg, title, okLabel, cancelLabel) =>
    ask(msg, {
      title,
      kind: 'warning',
      okLabel,
      cancelLabel,
    }),
  onMenuAction: (callback) => subscribe('menu-action', callback),
  triggerMenuAction: (id) => void invoke('trigger_menu_action', { id }),
  onOpenPath: (callback) =>
    subscribe('open-path', callback, () => {
      void invoke('frontend_ready')
    }),
  notifyQuitOk: () => void invoke('quit_confirmed'),
}
