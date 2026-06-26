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
  /** 最近打开的文件 */
  recentFiles: string[]
  /** 最近打开的文件夹 */
  recentFolders: string[]
  /** 收藏的常用目录 */
  favorites: string[]
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
  name: string
  content: string
  /** 是否有未保存的修改 */
  dirty: boolean
}
