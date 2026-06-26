import { contextBridge, ipcRenderer } from 'electron'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface AppSettings {
  attachmentMode: 'subfolder' | 'same'
  attachmentFolder: string
  imageMaxWidth: number
  theme: 'system' | 'light' | 'dark'
  autoSave: boolean
  recentFiles: string[]
  recentFolders: string[]
  favorites: string[]
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

  createFile: (dirPath: string, fileName: string): Promise<{ path: string; name: string }> =>
    ipcRenderer.invoke('fs:createFile', dirPath, fileName),

  createDir: (dirPath: string, name: string): Promise<{ path: string; name: string }> =>
    ipcRenderer.invoke('fs:createDir', dirPath, name),

  rename: (oldPath: string, newName: string): Promise<{ path: string; name: string }> =>
    ipcRenderer.invoke('fs:rename', oldPath, newName),

  trash: (targetPath: string): Promise<{ path: string }> =>
    ipcRenderer.invoke('fs:trash', targetPath),

  /** 保存图片等附件到文档同级附件目录，返回相对路径 */
  saveAttachment: (
    docDir: string,
    fileName: string,
    data: Uint8Array
  ): Promise<{ relPath: string }> =>
    ipcRenderer.invoke('attachment:save', docDir, fileName, data),

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

  /** 监听来自原生菜单的动作；返回取消监听函数 */
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const listener = (_e: unknown, action: string): void => callback(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
