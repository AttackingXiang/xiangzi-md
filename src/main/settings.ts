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
}

const DEFAULTS: AppSettings = {
  attachmentMode: 'subfolder',
  attachmentFolder: 'assets',
  imageMaxWidth: 800
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: AppSettings | null = null

export async function getSettings(): Promise<AppSettings> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(settingsFile(), 'utf-8')
    cache = { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export async function setSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings()
  cache = { ...current, ...patch }
  await fs.writeFile(settingsFile(), JSON.stringify(cache, null, 2), 'utf-8')
  return cache
}
