import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

export interface AppSettings {
  /**
   * 附件（图片等）存放方式（对齐 Obsidian）：
   * - same           与文档相同目录
   * - subfolder      文档同级子文件夹（名 = attachmentFolder，如 assets）
   * - docSubfolder   文档同级、按文档名再分一层（如 assets/<文档名>/）
   * - vault          仓库（已打开文件夹）根目录
   * - vaultSubfolder 仓库根下的子文件夹（如 根/assets）
   */
  attachmentMode: 'same' | 'subfolder' | 'docSubfolder' | 'vault' | 'vaultSubfolder'
  /** 子文件夹名（subfolder / docSubfolder / vaultSubfolder 模式用，默认 assets） */
  attachmentFolder: string
  /** 图片最大显示宽度（像素），0 表示不限制 */
  imageMaxWidth: number
  /** 界面语言 */
  language: 'zh' | 'en'
  /** 主题 */
  theme: 'system' | 'light' | 'dark'
  /** 编辑区显示宽度 */
  editorWidth: 'normal' | 'wide' | 'full'
  /** 自定义主题 CSS 文件路径（空为不启用） */
  customCssPath: string
  /** 标题自动编号（1、1.1、1.1.1…） */
  headingNumber: boolean
  /** 自动保存 */
  autoSave: boolean
  /** 最近打开的文件（绝对路径，最新在前） */
  recentFiles: string[]
  /** 最近打开的文件夹 */
  recentFolders: string[]
  /** 收藏（置顶）的常用目录 */
  favorites: string[]
  /** 上次会话（用于重开恢复） */
  session: {
    folder: string | null
    openFiles: string[]
    activePath: string | null
  }
  /** 在文件树中隐藏附件文件夹 */
  hideAttachmentFolders: boolean
  /** 额外的图片搜索目录列表 */
  assetSearchPaths: string[]
}

const DEFAULTS: AppSettings = {
  attachmentMode: 'subfolder',
  attachmentFolder: 'assets',
  imageMaxWidth: 800,
  language: 'zh',
  theme: 'system',
  editorWidth: 'full',
  customCssPath: '',
  headingNumber: false,
  autoSave: false,
  recentFiles: [],
  recentFolders: [],
  favorites: [],
  session: { folder: null, openFiles: [], activePath: null },
  hideAttachmentFolders: false,
  assetSearchPaths: []
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: AppSettings | null = null

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache
  let loaded: AppSettings
  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8')
    loaded = { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    loaded = { ...DEFAULTS }
  }
  cache = loaded
  return loaded
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings()
  const next: AppSettings = { ...current, ...patch }
  cache = next
  await fs.writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
