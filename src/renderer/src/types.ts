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
  /** 附件存放方式：subfolder=文档同级子文件夹，same=与文档同目录 */
  attachmentMode: 'subfolder' | 'same'
  /** subfolder 模式下的子文件夹名（Obsidian 风格） */
  attachmentFolder: string
  /** 图片最大显示宽度（像素），0 表示不限制 */
  imageMaxWidth: number
  /** 主题 */
  theme: 'system' | 'light' | 'dark'
  /** 编辑区显示宽度 */
  editorWidth: 'normal' | 'wide' | 'full'
  /** 自定义主题 CSS 文件路径 */
  customCssPath: string
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
