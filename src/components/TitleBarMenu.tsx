import { useRef, useState } from 'react'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { clipboardCmd, editorCmd } from '../lib/editorCommands'
import { getLang } from '../lib/i18n'
import {
  MENU_MODEL,
  menuItemsFor,
  menuLabel,
  type MenuModelItem,
  type NativeMenuRole,
} from '../lib/menuModel'
import { currentDesktopPlatform } from '../lib/platform'
import { displayShortcut, effectiveShortcut } from '../lib/shortcuts'
import { toggleWindowFullscreen } from '../lib/windowActions'
import { desktop } from '../platform'
import appIconUrl from '../../src-tauri/icons/icon.png'

interface Props {
  shortcuts: Record<string, string>
  onOpenAbout: () => void
  onAddProperty?: () => void
  canAddProperty?: boolean
}

function trigger(id: string): () => void {
  return () => desktop.triggerMenuAction(id)
}

function toggleFullscreen(): void {
  void toggleWindowFullscreen().catch((error: unknown) =>
    console.error('Toggle fullscreen failed', error),
  )
}

/**
 * 原生角色在这一侧的对应实现。
 *
 * macOS 侧这些必须是真的原生菜单项——撤销/剪切/粘贴要走 WebView 的响应链才有效
 * （`document.execCommand('paste')` 是被禁的）。Windows 没有原生菜单栏可依托，
 * 所以在这里接到应用自己的命令上。
 */
const NATIVE_ROLE_COMMANDS: Record<NativeMenuRole, (() => void) | null> = {
  about: null, // 由 onOpenAbout 注入
  hide: null, // macOS 专属，本侧不会出现
  hideOthers: null,
  showAll: null,
  undo: editorCmd.undo,
  redo: editorCmd.redo,
  cut: clipboardCmd.cut,
  copy: clipboardCmd.copy,
  paste: clipboardCmd.paste,
  fullscreen: toggleFullscreen,
}

const NOOP = (): void => undefined

export default function TitleBarMenu({
  shortcuts,
  onOpenAbout,
  onAddProperty,
  canAddProperty = false,
}: Props): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const buttonRefs = useRef<Record<string, HTMLButtonElement>>({})
  const platform = currentDesktopPlatform()
  const lang = getLang()

  const showMenu = (id: string): void => {
    const rect = buttonRefs.current[id]?.getBoundingClientRect()
    if (!rect) return
    setAnchor({ x: rect.left, y: rect.bottom + 2 })
    setOpen(id)
  }

  /**
   * 加速键提示：`shortcut` 引用用户可改的快捷键表，`accelerator` 是写死的固定键。
   * 两者都没有就不显示。
   */
  const hintFor = (item: Extract<MenuModelItem, { kind: 'action' }>): string | undefined => {
    const binding = item.shortcut ? effectiveShortcut(shortcuts, item.shortcut) : item.accelerator
    return binding ? displayShortcut(binding).join('+') : undefined
  }

  const toMenuItems = (items: MenuModelItem[]): MenuItem[] => {
    const built: MenuItem[] = []
    let separatorPending = false

    for (const item of items) {
      if (item.kind === 'separator') {
        separatorPending = built.length > 0
        continue
      }
      const label = menuLabel(item.label, lang)
      const separatorBefore = separatorPending
      separatorPending = false

      if (item.kind === 'submenu') {
        built.push({ label, onClick: NOOP, submenu: toMenuItems(item.items), separatorBefore })
        continue
      }
      if (item.kind === 'native') {
        const onClick = item.role === 'about' ? onOpenAbout : NATIVE_ROLE_COMMANDS[item.role]
        if (!onClick) continue
        built.push({ label, onClick, separatorBefore })
        continue
      }

      // 「添加属性」要跟着当前文档的可用性禁用，是本侧独有的状态。
      if (item.id === 'add-property') {
        built.push({
          label,
          onClick: onAddProperty ?? NOOP,
          disabled: !canAddProperty,
          separatorBefore,
        })
        continue
      }
      // 复制为纯文本没有走 menu-action 往返，直接就地执行。
      if (item.id === 'copy-as-plain-text') {
        built.push({ label, onClick: clipboardCmd.copyAsPlainText, separatorBefore })
        continue
      }
      built.push({ label, hint: hintFor(item), onClick: trigger(item.id), separatorBefore })
    }
    return built
  }

  const menus = MENU_MODEL.map((submenu) => ({
    id: submenu.id,
    label: menuLabel(submenu.label, lang),
    items: toMenuItems(menuItemsFor(submenu.items, platform)),
  })).filter((submenu) => submenu.items.length > 0)

  const active = menus.find((submenu) => submenu.id === open)

  return (
    <div className="titlebar-menubar" data-window-drag-interactive>
      {menus.map((submenu) => (
        <button
          key={submenu.id}
          type="button"
          ref={(el) => {
            if (el) buttonRefs.current[submenu.id] = el
            else delete buttonRefs.current[submenu.id]
          }}
          className={`titlebar-menubar-button${submenu.id === 'app' ? ' titlebar-menubar-button-app' : ''}${open === submenu.id ? ' active' : ''}`}
          aria-label={submenu.label}
          title={submenu.id === 'app' ? submenu.label : undefined}
          onClick={() => (open === submenu.id ? setOpen(null) : showMenu(submenu.id))}
          onMouseEnter={() => {
            if (open && open !== submenu.id) showMenu(submenu.id)
          }}
        >
          {submenu.id === 'app' ? (
            <img className="titlebar-app-icon" src={appIconUrl} alt="" draggable={false} />
          ) : (
            submenu.label
          )}
        </button>
      ))}
      {active && anchor && (
        <ContextMenu
          x={anchor.x}
          y={anchor.y}
          items={active.items}
          onClose={() => setOpen(null)}
          preserveSelection
        />
      )}
    </div>
  )
}
