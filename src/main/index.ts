import { app, shell, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { buildMenu } from './menu'
import { registerXmdPrivileges, handleXmdProtocol } from './protocol'

let mainWindow: BrowserWindow | null = null

// 应用名（菜单、关于面板等）
app.setName('Xiangzi MD')

// 图标路径（dev 与打包后均可解析；resources 已包含进打包文件）
const iconPath = join(app.getAppPath(), 'resources', 'icon.png')

// 必须在 app ready 之前注册自定义协议的权限
registerXmdPrivileges()

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
  buildMenu(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
