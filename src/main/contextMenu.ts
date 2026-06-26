import { Menu, clipboard, type WebContents, type MenuItemConstructorOptions } from 'electron'

/** 为编辑器等可编辑区域提供原生右键菜单（剪切/复制/粘贴/全选、链接、图片、拼写建议） */
export function attachContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = []
    const { editFlags } = params

    // 拼写建议
    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) {
        items.push({ label: s, click: () => webContents.replaceMisspelling(s) })
      }
      items.push({ type: 'separator' })
    }

    // 链接
    if (params.linkURL) {
      items.push({ label: '复制链接', click: () => clipboard.writeText(params.linkURL) })
    }

    // 图片
    if (params.mediaType === 'image' && params.srcURL) {
      items.push({ label: '复制图片地址', click: () => clipboard.writeText(params.srcURL) })
    }

    if (params.isEditable || params.selectionText) {
      if (items.length > 0) items.push({ type: 'separator' })
      items.push({ role: 'cut', label: '剪切', enabled: editFlags.canCut })
      items.push({ role: 'copy', label: '复制', enabled: editFlags.canCopy })
      items.push({ role: 'paste', label: '粘贴', enabled: editFlags.canPaste })
      if (params.isEditable) {
        items.push({
          role: 'pasteAndMatchStyle',
          label: '粘贴为纯文本',
          enabled: editFlags.canPaste
        })
      }
      items.push({ type: 'separator' })
      items.push({ role: 'selectAll', label: '全选' })
    }

    if (items.length === 0) return
    Menu.buildFromTemplate(items).popup()
  })
}
