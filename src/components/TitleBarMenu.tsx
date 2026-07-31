import { useRef, useState } from 'react'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { clipboardCmd, editorCmd } from '../lib/editorCommands'
import { t } from '../lib/i18n'
import { displayShortcut, effectiveShortcut, type ShortcutAction } from '../lib/shortcuts'
import { toggleWindowFullscreen } from '../lib/windowActions'
import { desktop } from '../platform'
import appIconUrl from '../../src-tauri/icons/icon.png'

interface Props {
  shortcuts: Record<string, string>
  onOpenAbout: () => void
  onAddProperty?: () => void
  canAddProperty?: boolean
}

type MenuId = 'app' | 'file' | 'edit' | 'view' | 'tools'

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

export default function TitleBarMenu({
  shortcuts,
  onOpenAbout,
  onAddProperty,
  canAddProperty = false,
}: Props): JSX.Element {
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
        {
          label: t('添加属性…'),
          onClick: onAddProperty ?? (() => undefined),
          disabled: !canAddProperty,
          separatorBefore: true,
        },
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
    tools: {
      label: t('工具'),
      items: [
        {
          label: t('顶部工具栏'),
          hint: hint(shortcuts, 'toggle-toolbar'),
          onClick: trigger('toggle-toolbar'),
        },
        {
          label: t('选中文本工具栏'),
          hint: hint(shortcuts, 'toggle-selection-toolbar'),
          onClick: trigger('toggle-selection-toolbar'),
        },
        {
          label: t('正文'),
          hint: hint(shortcuts, 'paragraph'),
          onClick: trigger('paragraph'),
          separatorBefore: true,
        },
        {
          label: t('标题'),
          onClick: () => undefined,
          submenu: [
            { label: t('标题 1'), hint: hint(shortcuts, 'heading-1'), onClick: trigger('heading-1') },
            { label: t('标题 2'), hint: hint(shortcuts, 'heading-2'), onClick: trigger('heading-2') },
            { label: t('标题 3'), hint: hint(shortcuts, 'heading-3'), onClick: trigger('heading-3') },
            { label: t('标题 4'), hint: hint(shortcuts, 'heading-4'), onClick: trigger('heading-4') },
            { label: t('标题 5'), hint: hint(shortcuts, 'heading-5'), onClick: trigger('heading-5') },
            { label: t('标题 6'), hint: hint(shortcuts, 'heading-6'), onClick: trigger('heading-6') },
          ],
        },
        {
          label: t('升级标题'),
          hint: hint(shortcuts, 'promote-heading'),
          onClick: trigger('promote-heading'),
        },
        {
          label: t('降级标题'),
          hint: hint(shortcuts, 'demote-heading'),
          onClick: trigger('demote-heading'),
        },
        {
          label: t('加粗'),
          hint: hint(shortcuts, 'bold'),
          onClick: trigger('bold'),
          separatorBefore: true,
        },
        { label: t('斜体'), hint: hint(shortcuts, 'italic'), onClick: trigger('italic') },
        { label: t('删除线'), hint: hint(shortcuts, 'strike'), onClick: trigger('strike') },
        {
          label: t('行内代码'),
          hint: hint(shortcuts, 'inline-code'),
          onClick: trigger('inline-code'),
        },
        {
          label: t('引用'),
          hint: hint(shortcuts, 'quote'),
          onClick: trigger('quote'),
          separatorBefore: true,
        },
        {
          label: t('代码块'),
          hint: hint(shortcuts, 'code-block'),
          onClick: trigger('code-block'),
        },
        {
          label: t('无序列表'),
          hint: hint(shortcuts, 'bullet-list'),
          onClick: trigger('bullet-list'),
          separatorBefore: true,
        },
        {
          label: t('有序列表'),
          hint: hint(shortcuts, 'ordered-list'),
          onClick: trigger('ordered-list'),
        },
        {
          label: t('任务列表'),
          hint: hint(shortcuts, 'task-list'),
          onClick: trigger('task-list'),
        },
        {
          label: t('插入表格'),
          hint: hint(shortcuts, 'insert-table'),
          onClick: trigger('insert-table'),
          separatorBefore: true,
        },
        {
          label: t('插入链接'),
          hint: hint(shortcuts, 'insert-link'),
          onClick: trigger('insert-link'),
        },
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
          className={`titlebar-menubar-button${id === 'app' ? ' titlebar-menubar-button-app' : ''}${open === id ? ' active' : ''}`}
          aria-label={menus[id].label}
          title={id === 'app' ? menus[id].label : undefined}
          onClick={() => (open === id ? setOpen(null) : showMenu(id))}
          onMouseEnter={() => {
            if (open && open !== id) showMenu(id)
          }}
        >
          {id === 'app' ? (
            <img className="titlebar-app-icon" src={appIconUrl} alt="" draggable={false} />
          ) : (
            menus[id].label
          )}
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
