export interface AppInfo {
  name: string
  version: string
  migrationStatus: string
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
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
  theme: 'system' | 'light' | 'dark'
  editorWidth: 'normal' | 'wide' | 'full'
  customCssPath: string
  headingNumber: boolean
  autoSave: boolean
  checkUpdatesOnStartup: boolean
  shortcuts: Record<string, string>
  recentFiles: string[]
  recentFolders: string[]
  favorites: string[]
  session: { folder: string | null; openFiles: string[]; activePath: string | null }
  hideAttachmentFolders: boolean
  assetSearchPaths: string[]
}

export interface OpenedFile {
  path: string
  name: string
  content: string
}

export interface SearchResult {
  path: string
  name: string
  matches: Array<{ lineNumber: number; text: string }>
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
  openFolder(): Promise<Folder | null>
  openFolderPath(root: string): Promise<Folder | null>
  openFile(): Promise<OpenedFile | null>
  readFile(path: string): Promise<OpenedFile>
  writeFile(path: string, content: string): Promise<{ path: string }>
  saveAs(content: string, suggestedName?: string): Promise<Pick<OpenedFile, 'path' | 'name'> | null>
  readDir(path: string): Promise<FileNode[]>
  listFiles(root: string): Promise<Array<{ path: string; name: string }>>
  createFile(dirPath: string, fileName: string): Promise<{ path: string; name: string }>
  createDir(dirPath: string, name: string): Promise<{ path: string; name: string }>
  rename(oldPath: string, newName: string): Promise<{ path: string; name: string }>
  trash(targetPath: string): Promise<{ path: string }>
  reveal(targetPath: string): Promise<void>
  openExternal(url: string): Promise<void>
  moveItem(sourcePath: string, targetDirPath: string): Promise<{ path: string; name: string }>
  searchInFolder(root: string, query: string): Promise<SearchResult[]>
  saveAttachment(
    docDir: string,
    docName: string,
    vaultRoot: string | null,
    fileName: string,
    data: Uint8Array,
  ): Promise<{ relPath: string }>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  findInPage(text: string, forward?: boolean, findNext?: boolean): Promise<void>
  stopFind(): Promise<void>
  exportHTML(html: string, suggestedName: string): Promise<{ path: string } | null>
  exportPDF(html: string, suggestedName: string): Promise<{ path: string } | null>
  exportImage(html: string, suggestedName: string): Promise<{ path: string } | null>
  pickCss(): Promise<{ path: string } | null>
  confirm(message: string, title: string, okLabel: string, cancelLabel: string): Promise<boolean>
  onMenuAction(callback: (action: string) => void): () => void
  onOpenPath(callback: (path: string) => void): () => void
  notifyReady(): void
  notifyQuitOk(): void
}
