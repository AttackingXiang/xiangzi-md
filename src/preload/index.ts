import { contextBridge, ipcRenderer } from 'electron'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const api = {
  openFolder: (): Promise<{ root: string; name: string; tree: FileNode[] } | null> =>
    ipcRenderer.invoke('fs:openFolder'),

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

  /** 监听来自原生菜单的动作；返回取消监听函数 */
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const listener = (_e: unknown, action: string): void => callback(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
