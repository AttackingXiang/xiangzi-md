import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

export interface AppSettings {
  /** 附件（图片等）存放方式 */
  attachmentMode: 'subfolder' | 'same'
  /** subfolder 模式下，文档同级的子文件夹名（Obsidian 风格，如 assets） */
  attachmentFolder: string
  /** 图片最大显示宽度（像素），0 表示不限制 */
  imageMaxWidth: number
  /** 主题 */
  theme: 'system' | 'light' | 'dark'
  /** 自动保存 */
  autoSave: boolean
  /** 最近打开的文件（绝对路径，最新在前） */
  recentFiles: string[]
  /** 最近打开的文件夹 */
  recentFolders: string[]
  /** 收藏（置顶）的常用目录 */
  favorites: string[]
}

const DEFAULTS: AppSettings = {
  attachmentMode: 'subfolder',
  attachmentFolder: 'assets',
  imageMaxWidth: 800,
  theme: 'system',
  autoSave: false,
  recentFiles: [],
  recentFolders: [],
  favorites: []
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
