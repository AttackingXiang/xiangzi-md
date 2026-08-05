import type { AppSettings } from '../types'

/**
 * 侧边栏顶部各按钮的显隐。
 *
 * 整组一起传，而不是八个 `showSidebarXxxButton` 布尔逐层透传：
 * App → Sidebar → SidebarHeader 三层，每加一个按钮就要在三处各写三遍
 * （接口、解构、转发），而这些标志永远是一起读、一起变的。
 */
export interface SidebarControls {
  undo: boolean
  favorite: boolean
  refresh: boolean
  search: boolean
  tags: boolean
  sort: boolean
  openFolder: boolean
  settings: boolean
}

/**
 * 设置尚未加载完成时的占位值。此时整个侧边栏都还没渲染，所以具体取值观察不到；
 * 用"全部隐藏"是为了万一渲染顺序变了，也不会闪出一排按钮。
 */
export const HIDDEN_SIDEBAR_CONTROLS: SidebarControls = {
  undo: false,
  favorite: false,
  refresh: false,
  search: false,
  tags: false,
  sort: false,
  openFolder: false,
  settings: false,
}

export function sidebarControlsFromSettings(settings: AppSettings): SidebarControls {
  return {
    undo: settings.showSidebarUndoButton,
    favorite: settings.showSidebarFavoriteButton,
    refresh: settings.showSidebarRefreshButton,
    search: settings.showSidebarSearchButton,
    tags: settings.showSidebarTagsButton,
    sort: settings.showSidebarSortButton,
    openFolder: settings.showOpenFolderButton,
    settings: settings.showSettingsButton,
  }
}
