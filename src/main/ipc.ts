import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { promises as fs } from 'fs'
import { basename, dirname, extname, join, relative, sep } from 'path'
import { getSettings, setSettings } from './settings'

/** 在目标目录内生成不冲突的文件名（已存在则追加 -1、-2 …） */
async function uniqueName(dir: string, fileName: string): Promise<string> {
  const ext = extname(fileName)
  const stem = basename(fileName, ext) || 'image'
  // 清理非法字符
  const safeStem = stem.replace(/[\\/:*?"<>|]/g, '_')
  let candidate = `${safeStem}${ext}`
  let i = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fs.access(join(dir, candidate))
      candidate = `${safeStem}-${i++}${ext}`
    } catch {
      return candidate
    }
  }
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  /** 仅目录有；首次读取时填充，懒加载场景下可能为 undefined */
  children?: FileNode[]
}

const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '.obsidian', '.vscode'])

/** 只读取一层目录（懒加载）：目录的 children 留空，待展开时再读 */
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
      // 不递归：children 保持 undefined，展开时通过 fs:readDir 按需加载
      nodes.push({ name: entry.name, path: fullPath, isDir: true })
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

  // 按路径打开文件夹（用于最近/收藏，无需弹窗）
  ipcMain.handle('fs:openFolderPath', async (_e, root: string) => {
    try {
      const stat = await fs.stat(root)
      if (!stat.isDirectory()) return null
    } catch {
      return null
    }
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

  // 读取/刷新某一层目录
  ipcMain.handle('fs:readDir', async (_e, dirPath: string) => {
    return readDirTree(dirPath)
  })

  // 递归列出文件夹内所有 markdown 文件（仅路径，供命令面板快速打开；后台调用，不阻塞）
  ipcMain.handle('fs:listFiles', async (_e, root: string) => {
    const out: { path: string; name: string }[] = []
    const MAX = 8000
    async function walk(dir: string): Promise<void> {
      if (out.length >= MAX) return
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (entry.isFile() && MARKDOWN_EXTS.has(extname(entry.name).toLowerCase())) {
          out.push({ path: full, name: entry.name })
          if (out.length >= MAX) return
        }
      }
    }
    await walk(root)
    return out
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

  // 在系统文件管理器中显示
  ipcMain.handle('fs:reveal', (_e, targetPath: string) => {
    shell.showItemInFolder(targetPath)
  })

  // 文件夹内全文搜索
  ipcMain.handle('search:inFolder', async (_e, root: string, query: string) => {
    if (!query || !query.trim()) return []
    const lower = query.toLowerCase()
    const results: { path: string; name: string; matches: { lineNumber: number; text: string }[] }[] =
      []
    const MAX_FILES = 3000
    const MAX_RESULTS = 400
    let fileCount = 0
    let resultCount = 0

    async function walk(dir: string): Promise<void> {
      if (resultCount >= MAX_RESULTS || fileCount >= MAX_FILES) return
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (entry.isFile() && MARKDOWN_EXTS.has(extname(entry.name).toLowerCase())) {
          if (fileCount++ >= MAX_FILES) return
          let content: string
          try {
            content = await fs.readFile(full, 'utf-8')
          } catch {
            continue
          }
          if (!content.toLowerCase().includes(lower)) continue
          const lines = content.split('\n')
          const matches: { lineNumber: number; text: string }[] = []
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lower)) {
              matches.push({ lineNumber: i + 1, text: lines[i].trim().slice(0, 200) })
              if (++resultCount >= MAX_RESULTS) break
              if (matches.length >= 20) break
            }
          }
          if (matches.length) results.push({ path: full, name: basename(full), matches })
        }
        if (resultCount >= MAX_RESULTS) break
      }
    }

    await walk(root)
    return results
  })

  // 保存附件（图片），按设置的模式决定目录，返回相对 docDir 的 POSIX 路径
  ipcMain.handle(
    'attachment:save',
    async (
      _e,
      docDir: string,
      docName: string,
      vaultRoot: string | null,
      fileName: string,
      data: Uint8Array
    ) => {
      const settings = await getSettings()
      const folder = settings.attachmentFolder || 'assets'
      const root = vaultRoot || docDir
      const docBase = basename(docName || 'untitled', extname(docName || '')) || 'untitled'

      let targetDir: string
      switch (settings.attachmentMode) {
        case 'same':
          targetDir = docDir
          break
        case 'docSubfolder':
          targetDir = join(docDir, folder, docBase)
          break
        case 'vault':
          targetDir = root
          break
        case 'vaultSubfolder':
          targetDir = join(root, folder)
          break
        case 'subfolder':
        default:
          targetDir = join(docDir, folder)
      }

      await fs.mkdir(targetDir, { recursive: true })
      const unique = await uniqueName(targetDir, fileName || 'image.png')
      const fullPath = join(targetDir, unique)
      await fs.writeFile(fullPath, Buffer.from(data))

      // 转成相对文档目录的 POSIX 路径写入 Markdown（如 assets/x.png 或 ../assets/x.png）
      const relPath = relative(docDir, fullPath).split(sep).join('/')
      return { relPath }
    }
  )

  // 选择一个 CSS 文件（自定义主题）
  ipcMain.handle('dialog:pickCss', async () => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'CSS', extensions: ['css'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return { path: result.filePaths[0] }
  })

  // 设置读写
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch) => setSettings(patch))

  // 页内查找（原生 findInPage）
  ipcMain.handle('find:start', (_e, text: string, forward: boolean, findNext: boolean) => {
    const win = getWindow()
    if (!win || !text) return
    win.webContents.findInPage(text, { forward, findNext })
  })
  ipcMain.handle('find:stop', () => {
    getWindow()?.webContents.stopFindInPage('clearSelection')
  })

  // 导出为 PDF：在隐藏窗口中加载完整文档 HTML 再打印，避免只导出当前视口
  ipcMain.handle('export:pdf', async (_e, html: string, suggestedName: string) => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName.replace(/\.md$/i, '') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return null

    const tmpPath = join(app.getPath('temp'), `xmd_pdf_${Date.now()}.html`)
    await fs.writeFile(tmpPath, html, 'utf-8')
    const printWin = new BrowserWindow({ show: false, width: 900, height: 800,
      webPreferences: { sandbox: false } })
    await printWin.loadFile(tmpPath)
    const data = await printWin.webContents.printToPDF({ printBackground: true })
    printWin.close()
    fs.unlink(tmpPath).catch(() => {})

    await fs.writeFile(result.filePath, data)
    return { path: result.filePath }
  })

  // 导出为长图（PNG / JPG）：同样用隐藏窗口渲染完整文档，截图后保存
  ipcMain.handle('export:image', async (_e, html: string, suggestedName: string) => {
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName.replace(/\.md$/i, ''),
      filters: [
        { name: 'PNG 图片', extensions: ['png'] },
        { name: 'JPEG 图片', extensions: ['jpg'] }
      ]
    })
    if (result.canceled || !result.filePath) return null

    const fp = result.filePath
    const isJpg = /\.(jpe?g)$/i.test(fp)

    const tmpPath = join(app.getPath('temp'), `xmd_img_${Date.now()}.html`)
    await fs.writeFile(tmpPath, html, 'utf-8')

    const imgWin = new BrowserWindow({ show: false, width: 920, height: 800,
      webPreferences: { sandbox: false } })
    await imgWin.loadFile(tmpPath)

    // 获取文档实际高度，将窗口扩展到全文高度后再截图
    const docHeight: number = await imgWin.webContents.executeJavaScript(
      'document.documentElement.scrollHeight'
    )
    imgWin.setContentSize(920, Math.min(docHeight + 20, 20000))
    await new Promise<void>((r) => setTimeout(r, 150))

    const nimg = await imgWin.webContents.capturePage()
    imgWin.close()
    fs.unlink(tmpPath).catch(() => {})

    const buf = isJpg ? nimg.toJPEG(92) : nimg.toPNG()
    await fs.writeFile(fp, buf)
    return { path: fp }
  })
}
