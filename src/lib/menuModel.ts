import menuJson from '../../shared/menu.json'
import type { DesktopPlatform } from './platform'
import type { ShortcutAction } from './shortcuts'

/**
 * 应用菜单结构，读自 shared/menu.json —— macOS 原生菜单栏和 Windows 应用内菜单
 * 的唯一来源。这个模块只负责解析和过滤；两侧各自的行为绑定留在各自的实现里，
 * 因为它们本来就不同（macOS 的编辑菜单必须用原生角色才能接上 WebView 响应链）。
 */

/** 交给平台原生处理的菜单角色。 */
export type NativeMenuRole =
  | 'about'
  | 'hide'
  | 'hideOthers'
  | 'showAll'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'fullscreen'

export interface MenuLabel {
  zh: string
  en: string
}

export type MenuModelItem =
  | { kind: 'separator'; platforms?: DesktopPlatform[] }
  | {
      kind: 'action'
      id: string
      label: MenuLabel
      /** 引用 shared/shortcuts.json 里的可自定义快捷键。 */
      shortcut?: ShortcutAction
      /** 不进用户快捷键表的固定加速键。 */
      accelerator?: string
      platforms?: DesktopPlatform[]
    }
  | { kind: 'submenu'; label: MenuLabel; items: MenuModelItem[]; platforms?: DesktopPlatform[] }
  | { kind: 'native'; role: NativeMenuRole; label: MenuLabel; platforms?: DesktopPlatform[] }

export interface MenuModelSubmenu {
  id: string
  label: MenuLabel
  items: MenuModelItem[]
}

const model = menuJson as unknown as { menus: MenuModelSubmenu[] }

export const MENU_MODEL: readonly MenuModelSubmenu[] = model.menus

/** 某条目是否在当前平台出现。省略 platforms 表示全平台。 */
export function itemAppliesTo(item: MenuModelItem, platform: DesktopPlatform): boolean {
  return item.platforms === undefined || item.platforms.includes(platform)
}

/**
 * 按平台过滤，并收拾掉过滤后留下的多余分隔线——开头、结尾和连续的分隔线
 * 在菜单里都是视觉噪音。
 */
export function menuItemsFor(
  items: readonly MenuModelItem[],
  platform: DesktopPlatform,
): MenuModelItem[] {
  const kept = items
    .filter((item) => itemAppliesTo(item, platform))
    .map((item) =>
      item.kind === 'submenu' ? { ...item, items: menuItemsFor(item.items, platform) } : item,
    )
  return kept.filter((item, index) => {
    if (item.kind !== 'separator') return true
    if (index === 0 || index === kept.length - 1) return false
    return kept[index - 1]?.kind !== 'separator'
  })
}

/** 遍历模型里的每个 action id，供测试和一致性校验使用。 */
export function collectActionIds(items: readonly MenuModelItem[] = allItems()): string[] {
  const ids: string[] = []
  for (const item of items) {
    if (item.kind === 'action') ids.push(item.id)
    else if (item.kind === 'submenu') ids.push(...collectActionIds(item.items))
  }
  return ids
}

function allItems(): MenuModelItem[] {
  return MENU_MODEL.flatMap((submenu) => submenu.items)
}

export function menuLabel(label: MenuLabel, lang: 'zh' | 'en'): string {
  return lang === 'en' ? label.en : label.zh
}
