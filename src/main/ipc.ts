import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { promises as fs } from 'fs'
import { basename, dirname, extname, join } from 'path'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  /** 仅目录有；首次读取时填充，懒加载场景下可能为 undefined */
  children?: FileNode[]
}

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '.obsidian', '.vscode'])

/** 递归读取目录，返回文件树（隐藏被忽略的目录） */
async function readDirTree(dirPath: string): Promise<FileNode[]> {
  let entries
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') && IGNORED_DIRS.has(entry.name)) continue
    if (IGNORED_DIRS.has(entry.name)) continue

    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: fullPath,
        isDir: true,
        children: await readDirTree(fullPath)
      })
    } else if (entry.isFile()) {
      // 只展示 markdown 与常见纯文本，其它隐藏以保持整洁
      const ext = extname(entry.name).toLowerCase()
      if (MARKDOWN_EXTS.has(ext) || ext === '.txt' || ext === '') {
        nodes.push({ name: entry.name, path: fullPath, isDir: false })
      }
    }
  }

  // 目录在前，按名称排序
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh')
  })
  return nodes
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  // 打开文件夹 -> 返回根路径与文件树
  ipcMain.handle('fs:openFolder', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const root = result.filePaths[0]
    return {
      root,
      name: basename(root),
      tree: await readDirTree(root)
    }
  })

  // 打开单个文件 -> 返回路径与内容
  ipcMain.handle('fs:openFile', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const content = await fs.readFile(filePath, 'utf-8')
    return { path: filePath, name: basename(filePath), content }
  })

  // 读取指定文件内容
  ipcMain.handle('fs:readFile', async (_e, filePath: string) => {
    const content = await fs.readFile(filePath, 'utf-8')
    return { path: filePath, name: basename(filePath), content }
  })

  // 写入文件
  ipcMain.handle('fs:writeFile', async (_e, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8')
    return { path: filePath }
  })

  // 另存为
  ipcMain.handle('fs:saveAs', async (_e, content: string, suggestedName?: string) => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName || 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, content, 'utf-8')
    return { path: result.filePath, name: basename(result.filePath) }
  })

  // 刷新目录树
  ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
    return readDirTree(dirPath)
  })

  // 新建文件
  ipcMain.handle('fs:createFile', async (_e, dirPath: string, fileName: string) => {
    const target = join(dirPath, fileName)
    await fs.writeFile(target, '', { flag: 'wx' }) // wx: 已存在则报错
    return { path: target, name: fileName }
  })

  // 新建文件夹
  ipcMain.handle('fs:createDir', async (_e, dirPath: string, name: string) => {
    const target = join(dirPath, name)
    await fs.mkdir(target)
    return { path: target, name }
  })

  // 重命名
  ipcMain.handle('fs:rename', async (_e, oldPath: string, newName: string) => {
    const target = join(dirname(oldPath), newName)
    await fs.rename(oldPath, target)
    return { path: target, name: newName }
  })

  // 删除（移入回收站）
  ipcMain.handle('fs:trash', async (_e, targetPath: string) => {
    await shell.trashItem(targetPath)
    return { path: targetPath }
  })
}
