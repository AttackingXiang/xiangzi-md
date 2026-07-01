export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface Folder {
  root: string
  name: string
  tree: FileNode[]
}

export interface AppSettings {
  /** 持久化设置结构版本，由 Rust migration 维护 */
  schemaVersion: number
  /** 附件存放方式（对齐 Obsidian 的多种模式） */
  attachmentMode: 'same' | 'subfolder' | 'docSubfolder' | 'vault' | 'vaultSubfolder'
  /** 子文件夹名（subfolder / docSubfolder / vaultSubfolder 用） */
  attachmentFolder: string
  /** 图片最大显示宽度（像素），0 表示不限制 */
  imageMaxWidth: number
  /** 界面语言 */
  language: 'zh' | 'en'
  /** 主题 */
  theme: 'system' | 'light' | 'dark'
  /** 编辑区显示宽度 */
  editorWidth: 'normal' | 'wide' | 'full'
  /** 自定义主题 CSS 文件路径 */
  customCssPath: string
  /** 标题自动编号 */
  headingNumber: boolean
  /** 自动保存 */
  autoSave: boolean
  /** 启动后在后台检查新版本 */
  checkUpdatesOnStartup: boolean
  /** 用户覆盖的快捷键；未出现的动作使用内置默认值 */
  shortcuts: Record<string, string>
  /** 最近打开的文件 */
  recentFiles: string[]
  /** 最近打开的文件夹 */
  recentFolders: string[]
  /** 收藏的常用目录 */
  favorites: string[]
  /** 收藏目录是否收起 */
  favoritesCollapsed: boolean
  /** 收藏目录的展示名称；键为实际路径，不会修改磁盘名称 */
  favoriteLabels: Record<string, string>
  /** 上次会话 */
  session: { folder: string | null; openFiles: string[]; activePath: string | null }
  /** 在文件树中隐藏附件文件夹（按 attachmentFolder 名称匹配） */
  hideAttachmentFolders: boolean
  /** 额外的图片搜索目录（每行一个绝对路径），用于解析无法在文档目录找到的图片 */
  assetSearchPaths: string[]
}

export interface SearchMatch {
  lineNumber: number
  text: string
}

export interface SearchResult {
  path: string
  name: string
  matches: SearchMatch[]
}

export interface DraftSummary {
  id: string
  path: string | null
  name: string
  preview: string
  sizeBytes: number
  updatedAt: number
}

export interface Draft {
  id: string
  path: string | null
  name: string
  content: string
  updatedAt: number
}

export interface OutlineItem {
  level: number
  text: string
  /** 第几个标题（用于在 DOM 中定位） */
  index: number
}

export interface Tab {
  id: string
  /** 已保存文件的绝对路径；新建未保存文件为 null */
  path: string | null
  /** 恢复草稿的原文件路径，仅用于解析相对资源，不会作为保存目标 */
  recoverySourcePath?: string | null
  name: string
  content: string
  /** 最近一次成功保存/读取的内容，用于判断脏状态和展示关闭前差异 */
  savedContent: string
  /** 是否有未保存的修改 */
  dirty: boolean
  /** 内容变化序号，用于避免重复写入相同草稿快照 */
  revision: number
}
