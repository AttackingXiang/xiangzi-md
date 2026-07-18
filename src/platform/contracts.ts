import type { ExportImageFormat } from '../lib/exportFormat'

export interface AppInfo {
  name: string
  version: string
  migrationStatus: string
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  openable: boolean
  /** 最后修改时间（Unix 纳秒），供文件树「最近修改」排序；取不到时为 0 */
  modifiedNanos: number
  children?: FileNode[]
}

/** 文件树排序方式 */
export type FileTreeSort = 'default' | 'nameDesc' | 'modified' | 'opened' | 'smart'

/** 单个文档的 frecency 记录：文件树/标签树「智能推荐」排序的原料。 */
export interface RecentDoc {
  path: string
  /** 累计有效打开次数 */
  openCount: number
  /** 最近一次有效打开（Unix 纳秒） */
  lastOpenedNanos: number
  /** 最近一次保存/编辑（Unix 纳秒）；0 表示从未编辑 */
  lastEditedNanos: number
}

export interface FileVersion {
  sizeBytes: number
  modifiedNanos: number
  contentHash: string
}

export interface Folder {
  root: string
  name: string
  tree: FileNode[]
}

export interface AppSettings {
  schemaVersion: number
  attachmentMode: 'same' | 'subfolder' | 'docSubfolder' | 'vault' | 'vaultSubfolder'
  attachmentFolder: string
  imageMaxWidth: number
  language: 'zh' | 'en'
  theme: 'system' | 'light' | 'dark' | 'warm' | 'mint' | 'blue' | 'summer' | 'sakura'
  editorWidth: 'normal' | 'wide' | 'full'
  customCssPath: string
  backgroundImagePath: string
  backgroundOpacity: number
  codeBlockOpacity: number
  /** Whether long lines inside fenced code blocks wrap automatically. */
  codeBlockLineWrapping: boolean
  themeShade: number
  headingNumber: boolean
  autoSave: boolean
  checkUpdatesOnStartup: boolean
  shortcuts: Record<string, string>
  recentFiles: string[]
  recentFolders: string[]
  /** frecency 打分语料库；recentFiles 是它按最近打开时间派生出的前 15 镜像 */
  recentDocs: RecentDoc[]
  favorites: string[]
  /** 收藏中属于文件的路径；未列出的收藏按文件夹处理，以兼容旧设置。 */
  favoriteFiles: string[]
  favoritesCollapsed: boolean
  /** 「全部标签」面板里置顶的标签 key（规范化小写） */
  pinnedTags: string[]
  /** 标签树里被折叠的分组 key（含置顶区 `pin:` 前缀）；空表示全部展开 */
  tagCollapsedKeys: string[]
  /** 标签树默认展开层级：-1 全部展开（默认），0 仅顶层，N 展开到第 N 层 */
  tagDefaultExpandDepth: number
  /** 是否把「含子标签的分组」排在同级前面（与 tagTreeSort 正交） */
  tagGroupsFirst: boolean
  /** 标签树同级排序：'count'（文档数倒序，默认）/'name'/'nameDesc'/'smart'（智能推荐） */
  tagTreeSort: 'count' | 'name' | 'nameDesc' | 'smart'
  /** 中间结果列排序：'updated'（修改时间，默认）或 'name'（名称） */
  tagResultSort: 'updated' | 'name'
  /** 点正文里的标签时是否同时展开左侧「全部标签」树（默认关：只出结果列） */
  tagClickOpensOverview: boolean
  favoriteLabels: Record<string, string>
  session: { folder: string | null; openFiles: string[]; activePath: string | null }
  /** 文件树排序：'default'（文件夹在前、名称升序）/'nameDesc'/'modified'/'opened'/'smart' */
  fileTreeSort: FileTreeSort
  /** 文件树中置顶的文件夹绝对路径，同级里排在未置顶项之前 */
  pinnedFolders: string[]
  hideAttachmentFolders: boolean
  assetSearchPaths: string[]
  showAllFiles: boolean
  /** 始终在文件树中显示的文本/代码扩展名（小写、不含点）；Markdown 与无扩展名文件不受限制 */
  visibleTextExtensions: string[]
  hiddenWorkspacePaths: string[]
  hiddenNamePatterns: string[]
  allowRemoteImages: boolean
  showToolbar: boolean
  showSelectionToolbar: boolean
  /** 启用虚拟化大文档编辑器的文件大小阈值，单位 KiB。 */
  /** 表格单元格输入停顿后采用的自动列宽策略。 */
  tableAutoWidth: 'distribute' | 'fit' | 'equal'
  /** 编辑表格内容后是否重新应用当前表格的布局模式。 */
  tableAutoResize: boolean
  showStatusBar: boolean
  showStatusPath: boolean
  showReadingModeControl: boolean
  showSourceModeControl: boolean
  showRevealButton: boolean
  /** 侧边栏顶部"打开文件夹"按钮是否显示（默认隐藏，仍可用 Welcome 页/快捷键） */
  showOpenFolderButton: boolean
  /** 侧边栏顶部"设置"按钮是否显示（默认隐藏，仍可用 ⌘, / 命令面板） */
  showSettingsButton: boolean
  /** 复制含图片的内容时：'image' 复制图片（默认），'address' 复制地址 */
  imageCopyMode: 'image' | 'address'
  /** 复制 Mermaid 图表时：'image' 复制图片（默认），'source' 复制源码文本 */
  mermaidCopyMode: 'image' | 'source'
  /** 默认复制格式：富文本同时携带纯文本兜底，纯文本不写入 HTML。 */
  clipboardFormat: 'rich' | 'plain'
  pandocPath: string
  pandocReferenceDoc: string
  pandocExportArgs: string
  pandocImportArgs: string
  pandocMediaFolder: string
  pandocToc: boolean
  pandocNumberSections: boolean
  pandocNormalizeFonts: boolean
}

export interface OpenedFile {
  path: string
  name: string
  content: string
  version: FileVersion
}

export interface WriteResult {
  path: string
  version: FileVersion
}

export interface SearchResult {
  path: string
  name: string
  matches: Array<{ lineNumber: number; matchIndex: number; text: string }>
}

export interface SearchResponse {
  items: SearchResult[]
  scannedFiles: number
  totalMatches: number
  truncated: boolean
  reason: 'file_limit' | 'match_limit' | 'per_file_limit' | null
  cancelled: boolean
}

export interface DraftSummary {
  id: string
  path: string | null
  name: string
  preview: string
  sizeBytes: number
  updatedAt: number
}

export interface Draft {
  id: string
  path: string | null
  name: string
  content: string
  updatedAt: number
}

export type UpdateDownloadEvent =
  | { event: 'Started'; contentLength?: number }
  | { event: 'Progress'; chunkLength: number }
  | { event: 'Finished' }

export interface AvailableUpdate {
  version: string
  currentVersion: string
  notes?: string
  source: 'github' | 'gitee'
  downloadAndInstall(onEvent: (event: UpdateDownloadEvent) => void): Promise<void>
  close(): Promise<void>
}

export interface UpdaterPort {
  check(timeoutMs: number): Promise<AvailableUpdate | null>
  relaunch(): Promise<void>
}

export interface RasterImageSource {
  width: number
  height: number
  chunks(): AsyncIterable<Uint8Array>
  dispose(): void
}

export interface RasterExportProgress {
  phase: 'preparing' | 'rendering' | 'encoding'
  percent?: number
}

export interface DesktopPort {
  getAppInfo(): Promise<AppInfo>
  openFolder(initialPath?: string): Promise<Folder | null>
  pickFolder(): Promise<{ path: string } | null>
  openFolderPath(root: string): Promise<Folder | null>
  openParentFolder(root: string): Promise<Folder | null>
  openContainingFolder(filePath: string): Promise<Folder | null>
  openFile(): Promise<OpenedFile | null>
  readFile(path: string): Promise<OpenedFile>
  readBinaryFile(path: string, maxBytes?: number): Promise<Uint8Array>
  readRemoteImage(url: string): Promise<Uint8Array>
  writeFile(
    path: string,
    content: string,
    expectedVersion: FileVersion | null,
    force?: boolean,
  ): Promise<WriteResult>
  saveAs(
    content: string,
    suggestedName?: string,
  ): Promise<Pick<OpenedFile, 'path' | 'name' | 'version'> | null>
  readDir(path: string): Promise<FileNode[]>
  // modifiedNanos 供 useTagIndex 做增量扫描：mtime 没变的文件直接复用缓存的
  // meta，不再逐个 readFile 把全文内容搬过 IPC。
  listFiles(root: string): Promise<Array<{ path: string; name: string; modifiedNanos: number }>>
  createFile(dirPath: string, fileName: string): Promise<{ path: string; name: string }>
  createDir(dirPath: string, name: string): Promise<{ path: string; name: string }>
  rename(oldPath: string, newName: string): Promise<{ path: string; name: string }>
  trash(targetPath: string): Promise<{ path: string }>
  listDrafts(): Promise<DraftSummary[]>
  readDraft(id: string): Promise<Draft>
  saveDraft(id: string, path: string | null, name: string, content: string): Promise<DraftSummary>
  deleteDraft(id: string): Promise<void>
  reveal(targetPath: string): Promise<void>
  openExternal(url: string): Promise<void>
  openWithDefault(path: string): Promise<void>
  moveItem(sourcePath: string, targetDirPath: string): Promise<{ path: string; name: string }>
  searchInFolder(root: string, query: string): Promise<SearchResponse>
  cancelSearch(): Promise<void>
  saveAttachment(
    docDir: string,
    docName: string,
    vaultRoot: string | null,
    fileName: string,
    data: Uint8Array,
  ): Promise<{ relPath: string }>
  writeClipboardHtml(html: string, altText: string): Promise<void>
  writeClipboardImage(png: Uint8Array): Promise<void>
  writeClipboardText(text: string): Promise<void>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  findInPage(text: string, forward?: boolean, findNext?: boolean): Promise<void>
  stopFind(): Promise<void>
  exportHTML(html: string, suggestedName: string): Promise<{ path: string } | null>
  exportPDF(html: string, suggestedName: string): Promise<{ path: string } | null>
  exportImage(
    suggestedName: string,
    render: (format: ExportImageFormat, signal?: AbortSignal) => Promise<RasterImageSource>,
    onProgress?: (progress: RasterExportProgress) => void,
    signal?: AbortSignal,
  ): Promise<{ path: string } | null>
  pandocStatus(): Promise<{ path: string; version: string } | null>
  exportDocx(
    markdown: string,
    docDir: string | null,
    suggestedName: string,
  ): Promise<{ path: string } | null>
  importDocx(mediaSubdir: string): Promise<{ markdownPath: string } | null>
  pickPandocExecutable(): Promise<{ path: string } | null>
  pickWordTemplate(): Promise<{ path: string } | null>
  savePandocDefaultTemplate(): Promise<{ path: string } | null>
  pickCss(): Promise<{ path: string } | null>
  pickImage(): Promise<{ path: string } | null>
  allowBackgroundImage(path: string): Promise<void>
  notify(message: string, title?: string): Promise<void>
  confirm(message: string, title: string, okLabel: string, cancelLabel: string): Promise<boolean>
  onMenuAction(callback: (action: string) => void): () => void
  triggerMenuAction(id: string): void
  onOpenPath(callback: (path: string) => void): () => void
  notifyQuitOk(): void
}
