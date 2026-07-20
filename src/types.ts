import type { FileVersion, OpenedFile } from './platform/contracts'

export type {
  AppSettings,
  Draft,
  DraftSummary,
  FileNode,
  FileTreeSort,
  FileVersion,
  Folder,
  RecentDoc,
  SearchResult,
} from './platform/contracts'

export interface OutlineItem {
  level: number
  text: string
  /** 第几个标题（用于在 DOM 中定位） */
  index: number
  /** 标题行在完整 Markdown 中的字符偏移，用于虚拟编辑器定位未挂载块。 */
  offset: number
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
  /** 与 dirty 正交的外部磁盘状态；缺省表示内容与最近一次已知磁盘版本同步。 */
  diskState?:
    | { kind: 'changed'; snapshot: OpenedFile }
    | { kind: 'unavailable'; detectedAt: number }
  /** 锁定后无法被关闭（close / close-others / close-all 均跳过） */
  locked?: boolean
  /**
   * 该文档原始的换行风格（打开时用 detectLineEnding 判定一次，跟随文档直到
   * 关闭；关闭即弃，不写入设置/会话）。CM6 编辑器内部只认 LF，保存前需要用
   * applyLineEnding 按这个字段还原成磁盘原本的风格，避免整份文件被改写成
   * LF 导致 diff 爆炸。未设置（新建文件等场景）按 'lf' 处理。
   */
  eol?: 'lf' | 'crlf'
}
