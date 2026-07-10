import { useRef, useState } from 'react'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { clipboardCmd, editorCmd } from '../lib/editorCommands'
import { t } from '../lib/i18n'
import { displayShortcut, effectiveShortcut, type ShortcutAction } from '../lib/shortcuts'
import { toggleWindowFullscreen } from '../lib/windowActions'
import { desktop } from '../platform'

interface Props {
  shortcuts: Record<string, string>
  onOpenAbout: () => void
}

type MenuId = 'app' | 'file' | 'edit' | 'view'

function hint(shortcuts: Record<string, string>, id: ShortcutAction): string | undefined {
  const binding = effectiveShortcut(shortcuts, id)
  return binding ? displayShortcut(binding).join('+') : undefined
}

function trigger(id: string): () => void {
  return () => desktop.triggerMenuAction(id)
}

function toggleFullscreen(): void {
  void toggleWindowFullscreen().catch((error: unknown) =>
    console.error('Toggle fullscreen failed', error),
  )
}

export default function TitleBarMenu({ shortcuts, onOpenAbout }: Props): JSX.Element {
  const [open, setOpen] = useState<MenuId | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const buttonRefs = useRef<Partial<Record<MenuId, HTMLButtonElement>>>({})

  const showMenu = (id: MenuId): void => {
    const rect = buttonRefs.current[id]?.getBoundingClientRect()
    if (!rect) return
    setAnchor({ x: rect.left, y: rect.bottom + 2 })
    setOpen(id)
  }

  const menus: Record<MenuId, { label: string; items: MenuItem[] }> = {
    app: {
      label: 'Xiangzi MD',
      items: [
        { label: t('关于 Xiangzi MD'), onClick: onOpenAbout },
        {
          label: t('设置…'),
          hint: hint(shortcuts, 'open-settings'),
          onClick: trigger('open-settings'),
          separatorBefore: true,
        },
        { label: t('检查更新…'), onClick: trigger('check-updates') },
        { label: t('退出 Xiangzi MD'), onClick: trigger('quit'), separatorBefore: true },
      ],
    },
    file: {
      label: t('文件'),
      items: [
        { label: t('新建文件'), hint: hint(shortcuts, 'new-file'), onClick: trigger('new-file') },
        {
          label: t('打开文件…'),
          hint: hint(shortcuts, 'open-file'),
          onClick: trigger('open-file'),
          separatorBefore: true,
        },
        {
          label: t('打开文件夹…'),
          hint: hint(shortcuts, 'open-folder'),
          onClick: trigger('open-folder'),
        },
        {
          label: t('保存'),
          hint: hint(shortcuts, 'save'),
          onClick: trigger('save'),
          separatorBefore: true,
        },
        { label: t('另存为…'), hint: hint(shortcuts, 'save-as'), onClick: trigger('save-as') },
        { label: t('导出 HTML'), onClick: trigger('export-html'), separatorBefore: true },
        { label: t('导出 PDF'), onClick: trigger('export-pdf') },
        { label: t('导出图片'), onClick: trigger('export-image') },
        { label: t('导出 Word'), onClick: trigger('export-docx') },
        { label: t('导入 Word 文档…'), onClick: trigger('import-docx'), separatorBefore: true },
        {
          label: t('关闭标签页'),
          hint: hint(shortcuts, 'close-tab'),
          onClick: trigger('close-tab'),
          separatorBefore: true,
        },
      ],
    },
    edit: {
      label: t('编辑'),
      items: [
        { label: t('撤销'), onClick: editorCmd.undo },
        { label: t('重做'), onClick: editorCmd.redo, separatorBefore: true },
        { label: t('剪切'), onClick: clipboardCmd.cut, separatorBefore: true },
        { label: t('复制'), onClick: clipboardCmd.copy },
        { label: t('粘贴'), onClick: clipboardCmd.paste },
        { label: t('全选'), onClick: clipboardCmd.selectAll, separatorBefore: true },
        {
          label: t('查找'),
          hint: hint(shortcuts, 'find'),
          onClick: trigger('find'),
          separatorBefore: true,
        },
        {
          label: t('在文件夹中搜索'),
          hint: hint(shortcuts, 'search-in-folder'),
          onClick: trigger('search-in-folder'),
        },
      ],
    },
    view: {
      label: t('视图'),
      items: [
        {
          label: t('切换侧边栏'),
          hint: hint(shortcuts, 'toggle-sidebar'),
          onClick: trigger('toggle-sidebar'),
        },
        {
          label: t('大纲'),
          hint: hint(shortcuts, 'toggle-outline'),
          onClick: trigger('toggle-outline'),
        },
        {
          label: t('切换源码模式'),
          hint: hint(shortcuts, 'toggle-source'),
          onClick: trigger('toggle-source'),
        },
        {
          label: t('专注模式'),
          hint: hint(shortcuts, 'toggle-focus'),
          onClick: trigger('toggle-focus'),
          separatorBefore: true,
        },
        {
          label: t('打字机模式'),
          hint: hint(shortcuts, 'toggle-typewriter'),
          onClick: trigger('toggle-typewriter'),
        },
        {
          label: t('命令面板'),
          hint: hint(shortcuts, 'command-palette'),
          onClick: trigger('command-palette'),
          separatorBefore: true,
        },
        {
          label: t('快捷键'),
          hint: hint(shortcuts, 'show-shortcuts'),
          onClick: trigger('show-shortcuts'),
        },
        { label: t('实际大小'), onClick: trigger('zoom-reset'), separatorBefore: true },
        { label: t('放大'), onClick: trigger('zoom-in') },
        { label: t('缩小'), onClick: trigger('zoom-out') },
        { label: t('切换全屏'), onClick: toggleFullscreen, separatorBefore: true },
      ],
    },
  }

  return (
    <div className="titlebar-menubar" data-titlebar-interactive>
      {(Object.keys(menus) as MenuId[]).map((id) => (
        <button
          key={id}
          type="button"
          ref={(el) => {
            if (el) buttonRefs.current[id] = el
            else delete buttonRefs.current[id]
          }}
          className={`titlebar-menubar-button${open === id ? ' active' : ''}`}
          onClick={() => (open === id ? setOpen(null) : showMenu(id))}
          onMouseEnter={() => {
            if (open && open !== id) showMenu(id)
          }}
        >
          {menus[id].label}
        </button>
      ))}
      {open && anchor && (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          items={menus[open].items}
          onClose={() => setOpen(null)}
          preserveSelection
        />
      )}
    </div>
  )
}
