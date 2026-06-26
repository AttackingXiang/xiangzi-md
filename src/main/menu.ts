import { app, Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/** 通过 IPC 通道把菜单动作发给渲染进程处理 */
function send(win: BrowserWindow | null, channel: string): void {
  win?.webContents.send('menu:action', channel)
}

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const, label: '关于 Xiangzi MD' },
              { type: 'separator' as const },
              {
                label: '设置…',
                accelerator: 'CmdOrCtrl+,',
                click: () => send(getWindow(), 'open-settings')
              },
              { type: 'separator' as const },
              { role: 'hide' as const, label: '隐藏' },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '全部显示' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: '退出' }
            ]
          }
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建文件', accelerator: 'CmdOrCtrl+N', click: () => send(getWindow(), 'new-file') },
        { type: 'separator' },
        { label: '打开文件…', accelerator: 'CmdOrCtrl+O', click: () => send(getWindow(), 'open-file') },
        {
          label: '打开文件夹…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send(getWindow(), 'open-folder')
        },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => send(getWindow(), 'save') },
        {
          label: '另存为…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send(getWindow(), 'save-as')
        },
        { type: 'separator' },
        {
          label: '导出',
          submenu: [
            { label: '导出 PDF…', click: () => send(getWindow(), 'export-pdf') },
            { label: '导出 HTML…', click: () => send(getWindow(), 'export-html') }
          ]
        },
        { type: 'separator' },
        {
          label: '关闭标签页',
          accelerator: 'CmdOrCtrl+W',
          click: () => send(getWindow(), 'close-tab')
        },
        ...(isMac ? [] : [{ role: 'quit' as const, label: '退出' }])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: () => send(getWindow(), 'find') },
        {
          label: '在文件夹中搜索',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => send(getWindow(), 'search-in-folder')
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '切换侧边栏',
          accelerator: 'CmdOrCtrl+\\',
          click: () => send(getWindow(), 'toggle-sidebar')
        },
        {
          label: '大纲',
          accelerator: 'CmdOrCtrl+Shift+K',
          click: () => send(getWindow(), 'toggle-outline')
        },
        {
          label: '切换源码模式',
          accelerator: 'CmdOrCtrl+/',
          click: () => send(getWindow(), 'toggle-source')
        },
        { type: 'separator' },
        {
          label: '专注模式',
          accelerator: 'CmdOrCtrl+Alt+F',
          click: () => send(getWindow(), 'toggle-focus')
        },
        {
          label: '打字机模式',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send(getWindow(), 'toggle-typewriter')
        },
        { type: 'separator' },
        {
          label: '快捷键',
          accelerator: 'CmdOrCtrl+Shift+/',
          click: () => send(getWindow(), 'show-shortcuts')
        },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
