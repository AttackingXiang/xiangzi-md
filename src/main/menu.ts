import { app, Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron'

type Lang = 'zh' | 'en'

const EN: Record<string, string> = {
  '关于 Xiangzi MD': 'About Xiangzi MD',
  '设置…': 'Settings…',
  隐藏: 'Hide',
  隐藏其他: 'Hide Others',
  全部显示: 'Show All',
  退出: 'Quit',
  文件: 'File',
  新建文件: 'New File',
  '打开文件…': 'Open File…',
  '打开文件夹…': 'Open Folder…',
  保存: 'Save',
  '另存为…': 'Save As…',
  导出: 'Export',
  '导出 PDF…': 'Export PDF…',
  '导出图片…': 'Export Image…',
  关闭标签页: 'Close Tab',
  编辑: 'Edit',
  撤销: 'Undo',
  重做: 'Redo',
  剪切: 'Cut',
  复制: 'Copy',
  粘贴: 'Paste',
  全选: 'Select All',
  查找: 'Find',
  在文件夹中搜索: 'Search in Folder',
  视图: 'View',
  切换侧边栏: 'Toggle Sidebar',
  大纲: 'Outline',
  切换源码模式: 'Toggle Source Mode',
  专注模式: 'Focus Mode',
  打字机模式: 'Typewriter Mode',
  命令面板: 'Command Palette',
  快捷键: 'Shortcuts',
  实际大小: 'Actual Size',
  放大: 'Zoom In',
  缩小: 'Zoom Out',
  切换全屏: 'Toggle Full Screen',
  开发者工具: 'Developer Tools',
  窗口: 'Window',
  最小化: 'Minimize',
  缩放: 'Zoom',
  关闭: 'Close'
}

function tr(lang: Lang, zh: string): string {
  return lang === 'en' ? (EN[zh] ?? zh) : zh
}

function send(win: BrowserWindow | null, channel: string): void {
  win?.webContents.send('menu:action', channel)
}

export function buildMenu(getWindow: () => BrowserWindow | null, lang: Lang = 'zh'): void {
  const isMac = process.platform === 'darwin'
  const T = (zh: string): string => tr(lang, zh)

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const, label: T('关于 Xiangzi MD') },
              { type: 'separator' as const },
              {
                label: T('设置…'),
                accelerator: 'CmdOrCtrl+,',
                click: () => send(getWindow(), 'open-settings')
              },
              { type: 'separator' as const },
              { role: 'hide' as const, label: T('隐藏') },
              { role: 'hideOthers' as const, label: T('隐藏其他') },
              { role: 'unhide' as const, label: T('全部显示') },
              { type: 'separator' as const },
              { role: 'quit' as const, label: T('退出') }
            ]
          }
        ]
      : []),
    {
      label: T('文件'),
      submenu: [
        { label: T('新建文件'), accelerator: 'CmdOrCtrl+N', click: () => send(getWindow(), 'new-file') },
        { type: 'separator' },
        { label: T('打开文件…'), accelerator: 'CmdOrCtrl+O', click: () => send(getWindow(), 'open-file') },
        {
          label: T('打开文件夹…'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send(getWindow(), 'open-folder')
        },
        { type: 'separator' },
        { label: T('保存'), accelerator: 'CmdOrCtrl+S', click: () => send(getWindow(), 'save') },
        {
          label: T('另存为…'),
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send(getWindow(), 'save-as')
        },
        { type: 'separator' },
        {
          label: T('导出'),
          submenu: [
            { label: T('导出 PDF…'), click: () => send(getWindow(), 'export-pdf') },
            { label: T('导出图片…'), click: () => send(getWindow(), 'export-image') }
          ]
        },
        { type: 'separator' },
        {
          label: T('关闭标签页'),
          accelerator: 'CmdOrCtrl+W',
          click: () => send(getWindow(), 'close-tab')
        },
        ...(isMac ? [] : [{ role: 'quit' as const, label: T('退出') }])
      ]
    },
    {
      label: T('编辑'),
      submenu: [
        { role: 'undo', label: T('撤销') },
        { role: 'redo', label: T('重做') },
        { type: 'separator' },
        { role: 'cut', label: T('剪切') },
        { role: 'copy', label: T('复制') },
        { role: 'paste', label: T('粘贴') },
        { role: 'selectAll', label: T('全选') },
        { type: 'separator' },
        { label: T('查找'), accelerator: 'CmdOrCtrl+F', click: () => send(getWindow(), 'find') },
        {
          label: T('在文件夹中搜索'),
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => send(getWindow(), 'search-in-folder')
        }
      ]
    },
    {
      label: T('视图'),
      submenu: [
        {
          label: T('切换侧边栏'),
          accelerator: 'CmdOrCtrl+\\',
          click: () => send(getWindow(), 'toggle-sidebar')
        },
        {
          label: T('大纲'),
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => send(getWindow(), 'toggle-outline')
        },
        {
          label: T('切换源码模式'),
          accelerator: 'CmdOrCtrl+/',
          click: () => send(getWindow(), 'toggle-source')
        },
        { type: 'separator' },
        {
          label: T('专注模式'),
          accelerator: 'CmdOrCtrl+Alt+F',
          click: () => send(getWindow(), 'toggle-focus')
        },
        {
          label: T('打字机模式'),
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send(getWindow(), 'toggle-typewriter')
        },
        { type: 'separator' },
        {
          label: T('命令面板'),
          accelerator: 'CmdOrCtrl+K',
          click: () => send(getWindow(), 'command-palette')
        },
        {
          label: T('快捷键'),
          accelerator: 'CmdOrCtrl+Shift+/',
          click: () => send(getWindow(), 'show-shortcuts')
        },
        { type: 'separator' },
        { role: 'resetZoom', label: T('实际大小') },
        { role: 'zoomIn', label: T('放大') },
        { role: 'zoomOut', label: T('缩小') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: T('切换全屏') },
        { role: 'toggleDevTools', label: T('开发者工具') }
      ]
    },
    {
      label: T('窗口'),
      submenu: [
        { role: 'minimize', label: T('最小化') },
        { role: 'zoom', label: T('缩放') },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const, label: T('关闭') }])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
