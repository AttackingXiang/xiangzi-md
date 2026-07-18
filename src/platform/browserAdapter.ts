/* eslint-disable @typescript-eslint/require-await -- preview methods intentionally mirror the asynchronous native adapter contract */

import type {
  AppSettings,
  DesktopPort,
  Draft,
  DraftSummary,
  FileNode,
  FileVersion,
  Folder,
  OpenedFile,
  SearchResponse,
  UpdaterPort,
} from './contracts'

const PREVIEW_ROOT = '/browser-preview'
const SAMPLE_PATH = `${PREVIEW_ROOT}/渲染示例.md`
const SAMPLE_MARKDOWN = `# Xiangzi MD 浏览器预览

这是一个不依赖 Tauri IPC 的开发预览文档，用于检查主界面和 Markdown 样式。

## 文本与列表

- **粗体**、*斜体*、~~删除线~~和 \`行内代码\`
- [x] 已完成任务
- [ ] 待办任务

> [!NOTE]
> 浏览器预览不会访问本机文件；桌面文件操作仍由 Tauri 提供。

## 表格

| 功能 | 状态 |
| --- | --- |
| Markdown | 正常 |
| 代码块 | 正常 |

## 代码

\`\`\`ts
const message = 'Hello, Xiangzi MD'
console.log(message)
\`\`\`

## 数学公式

行内公式 $E = mc^2$。

$$
\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}
$$

## Mermaid

\`\`\`mermaid
flowchart LR
  A[浏览器预览] --> B[视觉检查]
  B --> C[桌面端验收]
\`\`\`
`

function fileVersion(content: string): FileVersion {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return {
    sizeBytes: new TextEncoder().encode(content).length,
    modifiedNanos: Date.now() * 1_000_000,
    contentHash: (hash >>> 0).toString(16).padStart(8, '0'),
  }
}

function openedFile(path: string, content: string): OpenedFile {
  return {
    path,
    name: path.split('/').pop() ?? 'preview.md',
    content,
    version: fileVersion(content),
  }
}

export function createBrowserPreviewSettings(): AppSettings {
  return {
    schemaVersion: 9,
    attachmentMode: 'subfolder',
    attachmentFolder: 'assets',
    imageMaxWidth: 800,
    language: 'zh',
    theme: 'system',
    editorWidth: 'full',
    customCssPath: '',
    backgroundImagePath: '',
    backgroundOpacity: 30,
    codeBlockOpacity: 30,
    codeBlockLineWrapping: false,
    themeShade: 0,
    headingNumber: false,
    autoSave: false,
    checkUpdatesOnStartup: false,
    shortcuts: {},
    recentFiles: [SAMPLE_PATH],
    recentFolders: [PREVIEW_ROOT],
    recentDocs: [],
    favorites: [],
    favoriteFiles: [],
    favoritesCollapsed: false,
    pinnedTags: [],
    tagCollapsedKeys: [],
    tagDefaultExpandDepth: -1,
    tagGroupsFirst: true,
    tagTreeSort: 'count',
    tagResultSort: 'updated',
    tagClickOpensOverview: false,
    favoriteLabels: {},
    session: { folder: null, openFiles: [], activePath: null },
    fileTreeSort: 'default',
    pinnedFolders: [],
    hideAttachmentFolders: false,
    assetSearchPaths: [],
    showAllFiles: false,
    visibleTextExtensions: [
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
    hiddenWorkspacePaths: [],
    hiddenNamePatterns: [
      '.git',
      'node_modules',
      '.obsidian',
      '.vscode',
      'dist',
      'build',
      '.DS_Store',
    ],
    allowRemoteImages: false,
    showToolbar: true,
    showSelectionToolbar: true,
    tableAutoWidth: 'distribute',
    tableAutoResize: true,
    showStatusBar: true,
    showStatusPath: true,
    showReadingModeControl: true,
    showSourceModeControl: true,
    showRevealButton: true,
    showOpenFolderButton: true,
    showSettingsButton: true,
    imageCopyMode: 'image',
    mermaidCopyMode: 'image',
    clipboardFormat: 'rich',
    pandocPath: '',
    pandocReferenceDoc: '',
    pandocExportArgs: '',
    pandocImportArgs: '',
    pandocMediaFolder: 'assets',
    pandocToc: false,
    pandocNumberSections: false,
    pandocNormalizeFonts: true,
  }
}

const files = new Map<string, string>([[SAMPLE_PATH, SAMPLE_MARKDOWN]])
const drafts = new Map<string, Draft>()
let settings = createBrowserPreviewSettings()

function previewTree(): FileNode[] {
  return Array.from(files.keys()).map((path) => ({
    name: path.split('/').pop() ?? path,
    path,
    isDir: false,
    openable: true,
    modifiedNanos: fileVersion(files.get(path) ?? '').modifiedNanos,
  }))
}

function previewFolder(): Folder {
  return { root: PREVIEW_ROOT, name: 'browser-preview', tree: previewTree() }
}

function requireFile(path: string): OpenedFile {
  const content = files.get(path)
  if (content === undefined) throw new Error(`Preview file not found: ${path}`)
  return openedFile(path, content)
}

function nextPreviewPath(name: string): string {
  const clean = name.trim() || 'untitled.md'
  const withExtension = /\.[^.]+$/.test(clean) ? clean : `${clean}.md`
  let path = `${PREVIEW_ROOT}/${withExtension}`
  let suffix = 2
  while (files.has(path)) {
    path = `${PREVIEW_ROOT}/${withExtension.replace(/(\.[^.]+)$/, ` ${suffix}$1`)}`
    suffix += 1
  }
  return path
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}

export const browserDesktopAdapter: DesktopPort = {
  getAppInfo: async () => ({
    name: 'Xiangzi MD',
    version: 'browser-preview',
    migrationStatus: 'preview',
  }),
  openFolder: async () => previewFolder(),
  pickFolder: async () => ({ path: PREVIEW_ROOT }),
  openFolderPath: async (root) => (root === PREVIEW_ROOT ? previewFolder() : null),
  openParentFolder: async () => previewFolder(),
  openContainingFolder: async () => previewFolder(),
  openFile: async () => requireFile(SAMPLE_PATH),
  readFile: async (path) => requireFile(path),
  readBinaryFile: async () => new Uint8Array(),
  readRemoteImage: async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer()),
  writeFile: async (path, content) => {
    files.set(path, content)
    return { path, version: fileVersion(content) }
  },
  saveAs: async (content, suggestedName = 'untitled.md') => {
    const path = nextPreviewPath(suggestedName)
    files.set(path, content)
    return openedFile(path, content)
  },
  readDir: async (path) => (path === PREVIEW_ROOT ? previewTree() : []),
  listFiles: async () =>
    previewTree().map(({ path, name, modifiedNanos }) => ({ path, name, modifiedNanos })),
  createFile: async (_dirPath, fileName) => {
    const path = nextPreviewPath(fileName)
    files.set(path, '')
    return { path, name: path.split('/').pop() ?? fileName }
  },
  createDir: async (_dirPath, name) => ({ path: `${PREVIEW_ROOT}/${name}`, name }),
  rename: async (oldPath, newName) => {
    const content = files.get(oldPath)
    if (content === undefined) throw new Error(`Preview file not found: ${oldPath}`)
    const path = `${PREVIEW_ROOT}/${newName}`
    files.delete(oldPath)
    files.set(path, content)
    return { path, name: newName }
  },
  trash: async (targetPath) => {
    files.delete(targetPath)
    return { path: targetPath }
  },
  listDrafts: async (): Promise<DraftSummary[]> =>
    Array.from(drafts.values()).map(({ content, ...draft }) => ({
      ...draft,
      preview: content.slice(0, 160),
      sizeBytes: new TextEncoder().encode(content).length,
    })),
  readDraft: async (id) => {
    const draft = drafts.get(id)
    if (!draft) throw new Error(`Preview draft not found: ${id}`)
    return draft
  },
  saveDraft: async (id, path, name, content) => {
    const draft = { id, path, name, content, updatedAt: Date.now() }
    drafts.set(id, draft)
    return {
      id,
      path,
      name,
      preview: content.slice(0, 160),
      sizeBytes: new TextEncoder().encode(content).length,
      updatedAt: draft.updatedAt,
    }
  },
  deleteDraft: async (id) => {
    drafts.delete(id)
  },
  reveal: async () => undefined,
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  openWithDefault: async () => undefined,
  moveItem: async (sourcePath) => ({
    path: sourcePath,
    name: sourcePath.split('/').pop() ?? sourcePath,
  }),
  searchInFolder: async (_root, query): Promise<SearchResponse> => {
    const needle = query.toLowerCase()
    const items = Array.from(files.entries()).flatMap(([path, content]) => {
      const matches = content
        .split('\n')
        .map((text, index) => ({
          lineNumber: index + 1,
          matchIndex: text.toLowerCase().indexOf(needle),
          text,
        }))
        .filter((match) => match.matchIndex >= 0)
      return matches.length ? [{ path, name: path.split('/').pop() ?? path, matches }] : []
    })
    return {
      items,
      scannedFiles: files.size,
      totalMatches: items.reduce((total, item) => total + item.matches.length, 0),
      truncated: false,
      reason: null,
      cancelled: false,
    }
  },
  cancelSearch: async () => undefined,
  saveAttachment: async () => {
    throw new Error('浏览器预览不支持保存附件')
  },
  writeClipboardHtml: async (html, altText) => {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([altText], { type: 'text/plain' }),
        }),
      ])
      return
    }
    await navigator.clipboard?.writeText(altText)
  },
  writeClipboardImage: async (png) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': new Blob([Uint8Array.from(png)], { type: 'image/png' }),
      }),
    ])
  },
  writeClipboardText: async (text) => navigator.clipboard?.writeText(text),
  getSettings: async () => structuredClone(settings),
  setSettings: async (patch) => {
    settings = { ...settings, ...structuredClone(patch) }
    return structuredClone(settings)
  },
  findInPage: async () => undefined,
  stopFind: async () => undefined,
  exportHTML: async (html, suggestedName) => {
    const name = suggestedName.replace(/\.(?:md|markdown)$/i, '') + '.html'
    download(name, html, 'text/html;charset=utf-8')
    return { path: name }
  },
  exportPDF: async () => null,
  exportImage: async () => null,
  pandocStatus: async () => null,
  exportDocx: async () => null,
  importDocx: async () => null,
  pickPandocExecutable: async () => null,
  pickWordTemplate: async () => null,
  savePandocDefaultTemplate: async () => null,
  pickCss: async () => null,
  pickImage: async () => null,
  allowBackgroundImage: async () => undefined,
  notify: async (message) => {
    console.info(`[browser preview] ${message}`)
  },
  confirm: async (message) => window.confirm(message),
  onMenuAction: () => () => undefined,
  triggerMenuAction: () => undefined,
  onOpenPath: () => () => undefined,
  notifyQuitOk: () => undefined,
}

export const browserUpdaterAdapter: UpdaterPort = {
  check: async () => null,
  relaunch: async () => window.location.reload(),
}
