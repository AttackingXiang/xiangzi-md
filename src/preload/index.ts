import { contextBridge, ipcRenderer } from 'electron'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface AppSettings {
  attachmentMode: 'same' | 'subfolder' | 'docSubfolder' | 'vault' | 'vaultSubfolder'
  attachmentFolder: string
  imageMaxWidth: number
  language: 'zh' | 'en'
  theme: 'system' | 'light' | 'dark'
  editorWidth: 'normal' | 'wide' | 'full'
  customCssPath: string
  headingNumber: boolean
  autoSave: boolean
  recentFiles: string[]
  recentFolders: string[]
  favorites: string[]
  session: { folder: string | null; openFiles: string[]; activePath: string | null }
}

const api = {
  openFolder: (): Promise<{ root: string; name: string; tree: FileNode[] } | null> =>
    ipcRenderer.invoke('fs:openFolder'),

  openFolderPath: (
    root: string
  ): Promise<{ root: string; name: string; tree: FileNode[] } | null> =>
    ipcRenderer.invoke('fs:openFolderPath', root),

  openFile: (): Promise<{ path: string; name: string; content: string } | null> =>
    ipcRenderer.invoke('fs:openFile'),

  readFile: (path: string): Promise<{ path: string; name: string; content: string }> =>
    ipcRenderer.invoke('fs:readFile', path),

  writeFile: (path: string, content: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('fs:writeFile', path, content),

  saveAs: (content: string, suggestedName?: string): Promise<{ path: string; name: string } | null> =>
    ipcRenderer.invoke('fs:saveAs', content, suggestedName),

  readDir: (path: string): Promise<FileNode[]> => ipcRenderer.invoke('fs:readDir', path),

  listFiles: (root: string): Promise<{ path: string; name: string }[]> =>
    ipcRenderer.invoke('fs:listFiles', root),

  createFile: (dirPath: string, fileName: string): Promise<{ path: string; name: string }> =>
    ipcRenderer.invoke('fs:createFile', dirPath, fileName),

  createDir: (dirPath: string, name: string): Promise<{ path: string; name: string }> =>
    ipcRenderer.invoke('fs:createDir', dirPath, name),

  rename: (oldPath: string, newName: string): Promise<{ path: string; name: string }> =>
    ipcRenderer.invoke('fs:rename', oldPath, newName),

  trash: (targetPath: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('fs:trash', targetPath),

  reveal: (targetPath: string): Promise<void> => ipcRenderer.invoke('fs:reveal', targetPath),

  searchInFolder: (
    root: string,
    query: string
  ): Promise<
    { path: string; name: string; matches: { lineNumber: number; text: string }[] }[]
  > => ipcRenderer.invoke('search:inFolder', root, query),

  /** 保存图片等附件，按设置的模式决定目录，返回相对文档目录的路径 */
  saveAttachment: (
    docDir: string,
    docName: string,
    vaultRoot: string | null,
    fileName: string,
    data: Uint8Array
  ): Promise<{ relPath: string }> =>
    ipcRenderer.invoke('attachment:save', docDir, docName, vaultRoot, fileName, data),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),

  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', patch),

  findInPage: (text: string, forward = true, findNext = false): Promise<void> =>
    ipcRenderer.invoke('find:start', text, forward, findNext),

  stopFind: (): Promise<void> => ipcRenderer.invoke('find:stop'),

  exportPDF: (suggestedName: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke('export:pdf', suggestedName),

  exportHTML: (html: string, suggestedName: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke('export:html', html, suggestedName),

  pickCss: (): Promise<{ path: string } | null> => ipcRenderer.invoke('dialog:pickCss'),

  setLanguage: (lang: 'zh' | 'en'): Promise<void> => ipcRenderer.invoke('app:setLanguage', lang),

  /** 监听来自原生菜单的动作；返回取消监听函数 */
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const listener = (_e: unknown, action: string): void => callback(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },

  /** 监听系统「打开方式 / 双击」传入的文件路径；返回取消监听函数 */
  onOpenPath: (callback: (path: string) => void): (() => void) => {
    const listener = (_e: unknown, path: string): void => callback(path)
    ipcRenderer.on('app:open-path', listener)
    return () => ipcRenderer.removeListener('app:open-path', listener)
  },

  /** 渲染层就绪，通知主进程可以发送待打开的文件 */
  notifyReady: (): void => ipcRenderer.send('app:ready')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
