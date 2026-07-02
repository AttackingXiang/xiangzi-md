import type { FileVersion } from './platform/contracts'

export type {
  AppSettings,
  Draft,
  DraftSummary,
  FileNode,
  FileVersion,
  Folder,
  SearchResult,
} from './platform/contracts'

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
  /** Rust 返回的磁盘版本，用于保存时检测外部修改。 */
  version: FileVersion | null
}
