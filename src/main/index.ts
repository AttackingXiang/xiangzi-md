import { app, shell, BrowserWindow, session, ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { buildMenu } from './menu'
import { getSettings } from './settings'
import { registerXmdPrivileges, handleXmdProtocol } from './protocol'
import { checkForUpdates } from './updater'

let mainWindow: BrowserWindow | null = null

// 应用名（菜单、关于面板等）
app.setName('Xiangzi MD')

// 图标路径（dev 与打包后均可解析；resources 已包含进打包文件）
const iconPath = join(app.getAppPath(), 'resources', 'icon.png')

// 必须在 app ready 之前注册自定义协议的权限
registerXmdPrivileges()

// ---- 用系统「打开方式 / 双击」打开文件 ----
const pendingOpenPaths: string[] = []
let rendererReady = false

function flushOpenPaths(): void {
  if (!rendererReady || !mainWindow) return
  for (const p of pendingOpenPaths.splice(0)) {
    mainWindow.webContents.send('app:open-path', p)
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function queueOpen(p: string | null | undefined): void {
  if (!p) return
  pendingOpenPaths.push(p)
  flushOpenPaths()
}

/** 从命令行参数里挑出要打开的文档路径（Windows/Linux） */
function fileFromArgv(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue
    if (/\.(md|markdown|mdown|mkd|mdx|txt)$/i.test(a) && existsSync(a)) return a
  }
  return null
}

// 单实例：第二次启动（含双击文件）把参数转发给已运行的实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    queueOpen(fileFromArgv(argv))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// macOS：通过「打开方式」/双击/拖到 dock 打开文件（可能在 ready 之前触发）
app.on('open-file', (event, path) => {
  event.preventDefault()
  queueOpen(path)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Xiangzi MD',
    icon: iconPath,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Before close: ask renderer if there are unsaved files.
  // We use ipcMain.on (not once) so the handler survives cancelled-close attempts.
  // When the renderer calls notifyQuitOk(), we call app.quit() — not mainWindow.close() —
  // because on macOS closing the last window does NOT terminate the process.
  let quitConfirmed = false
  const onQuitOk = (): void => {
    quitConfirmed = true
    ipcMain.removeListener('app:quit-ok', onQuitOk)
    app.quit()
  }
  ipcMain.on('app:quit-ok', onQuitOk)
  mainWindow.on('closed', () => ipcMain.removeListener('app:quit-ok', onQuitOk))
  mainWindow.on('close', (event) => {
    if (quitConfirmed) return
    event.preventDefault()
    mainWindow?.webContents.send('menu:action', 'query-dirty')
  })

  // 诊断：把渲染层的报错冒泡到主进程日志
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('[renderer]', message)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.log('[did-fail-load]', code, desc)
  })
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[did-finish-load] renderer loaded ok')
  })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 开发模式加载本地 dev server，生产模式加载打包文件
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // 开发期把 dock 图标换成自定义图标（打包后由 icns 决定，无需此步）
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(iconPath)
    } catch {
      /* 忽略 */
    }
  }

  handleXmdProtocol()

  // 仅在生产环境注入严格 CSP；开发环境不加，避免阻断 Vite HMR
  if (!process.env['ELECTRON_RENDERER_URL']) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: file: xmd:; font-src 'self' data:; script-src 'self'"
          ]
        }
      })
    })
  }

  registerIpcHandlers(() => mainWindow)
  createWindow()

  // 渲染层就绪后，把待打开的文件发过去
  ipcMain.on('app:ready', () => {
    rendererReady = true
    flushOpenPaths()
  })

  // Windows/Linux：首次启动带的文件参数
  queueOpen(fileFromArgv(process.argv))

  // 按已保存的语言构建本地化菜单
  getSettings().then((s) => buildMenu(() => mainWindow, s.language))

  // 启动后 4 秒静默检查更新（仅生产环境）
  if (!process.env['ELECTRON_RENDERER_URL']) {
    setTimeout(() => checkForUpdates(true), 4000)
  }

  // 语言切换时重建菜单
  ipcMain.handle('app:setLanguage', (_e, lang: 'zh' | 'en') => {
    buildMenu(() => mainWindow, lang)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
