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
