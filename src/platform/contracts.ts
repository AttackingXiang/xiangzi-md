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
  children?: FileNode[]
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
  theme: 'system' | 'light' | 'dark' | 'warm' | 'mint' | 'blue' | 'summer'
  editorWidth: 'normal' | 'wide' | 'full'
  customCssPath: string
  backgroundImagePath: string
  backgroundOpacity: number
  codeBlockOpacity: number
  themeShade: number
  headingNumber: boolean
  autoSave: boolean
  checkUpdatesOnStartup: boolean
  shortcuts: Record<string, string>
  recentFiles: string[]
  recentFolders: string[]
  favorites: string[]
  favoritesCollapsed: boolean
  favoriteLabels: Record<string, string>
  session: { folder: string | null; openFiles: string[]; activePath: string | null }
  hideAttachmentFolders: boolean
  assetSearchPaths: string[]
  showAllFiles: boolean
  hiddenWorkspacePaths: string[]
  hiddenNamePatterns: string[]
  allowRemoteImages: boolean
  showToolbar: boolean
  showSelectionToolbar: boolean
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
  listFiles(root: string): Promise<Array<{ path: string; name: string }>>
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
  exportImage(html: string, suggestedName: string): Promise<{ path: string } | null>
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
  onOpenPath(callback: (path: string) => void): () => void
  notifyQuitOk(): void
}
