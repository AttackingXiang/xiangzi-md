import { describe, expect, it } from 'vitest'
import {
  MENU_MODEL,
  collectActionIds,
  menuItemsFor,
  menuLabel,
  type MenuModelItem,
} from './menuModel'
import { SHORTCUT_DEFINITIONS } from './shortcuts'

function walk(items: readonly MenuModelItem[], visit: (item: MenuModelItem) => void): void {
  for (const item of items) {
    visit(item)
    if (item.kind === 'submenu') walk(item.items, visit)
  }
}

const allItems: MenuModelItem[] = []
for (const submenu of MENU_MODEL) walk(submenu.items, (item) => allItems.push(item))

describe('shared menu model', () => {
  it('exposes the five top-level menus', () => {
    expect(MENU_MODEL.map((submenu) => submenu.id)).toEqual([
      'app',
      'file',
      'edit',
      'view',
      'tools',
    ])
  })

  it('only references shortcuts that exist in the shared registry', () => {
    // 写错一个 id 不会报错，只会让加速键静默消失。Rust 侧有一份对应的检查。
    const known = new Set(SHORTCUT_DEFINITIONS.map((definition) => definition.id))
    const referenced = allItems.flatMap((item) =>
      item.kind === 'action' && item.shortcut ? [item.shortcut] : [],
    )
    expect(referenced.length).toBeGreaterThan(0)
    for (const id of referenced) expect(known).toContain(id)
  })

  it('gives every action a unique id', () => {
    const ids = collectActionIds()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('translates both languages for every labelled item', () => {
    for (const item of allItems) {
      if (item.kind === 'separator') continue
      expect(menuLabel(item.label, 'zh')).toBeTruthy()
      expect(menuLabel(item.label, 'en')).toBeTruthy()
    }
  })

  it('drops macOS-only items on Windows', () => {
    const appMenu = MENU_MODEL.find((submenu) => submenu.id === 'app')
    if (!appMenu) throw new Error('app menu missing')

    const mac = menuItemsFor(appMenu.items, 'macos')
    const windows = menuItemsFor(appMenu.items, 'windows')
    const roles = (items: MenuModelItem[]): string[] =>
      items.flatMap((item) => (item.kind === 'native' ? [item.role] : []))

    expect(roles(mac)).toContain('hide')
    expect(roles(windows)).not.toContain('hide')
    // 关于在两个平台都有，只是实现不同。
    expect(roles(windows)).toContain('about')
  })

  it('never leaves a leading, trailing, or doubled separator after filtering', () => {
    for (const submenu of MENU_MODEL) {
      for (const platform of ['macos', 'windows', 'linux'] as const) {
        const items = menuItemsFor(submenu.items, platform)
        expect(items[0]?.kind).not.toBe('separator')
        expect(items.at(-1)?.kind).not.toBe('separator')
        items.forEach((item, index) => {
          if (index === 0) return
          expect(item.kind === 'separator' && items[index - 1]?.kind === 'separator').toBe(false)
        })
      }
    }
  })
})
