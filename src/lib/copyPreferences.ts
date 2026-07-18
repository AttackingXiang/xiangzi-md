/** 复制控制偏好：一个进程内单例，供剪贴板逻辑同步读取。
 *
 * 图片和 Mermaid 的复制逻辑分别在 richClipboard 的 copy 事件处理器、以及
 * 代码块预览等非 React 渲染逻辑里——它们拿不到
 * props/context，所以用这个模块在 copy 发生的一瞬间同步读当前设置。设置变化时
 * 由 App 的 effect 调 setCopyPreferences 推进来。 */

/** 复制包含图片的内容时：'image' 复制图片本身（默认），'address' 复制地址
 * （不拦截，交给编辑器复制 Markdown 里原样的路径/链接）。 */
export type ImageCopyMode = 'image' | 'address'

/** 复制 Mermaid 图表时：'image' 复制渲染出的图片（默认），'source' 复制源码文本。 */
export type MermaidCopyMode = 'image' | 'source'

/** 普通复制的默认载荷：rich 写 HTML + 纯文本兜底，plain 只写纯文本。 */
export type ClipboardFormat = 'rich' | 'plain'

export interface CopyPreferences {
  imageCopyMode: ImageCopyMode
  mermaidCopyMode: MermaidCopyMode
  clipboardFormat: ClipboardFormat
}

const current: CopyPreferences = {
  imageCopyMode: 'image',
  mermaidCopyMode: 'image',
  clipboardFormat: 'rich',
}

export function setCopyPreferences(prefs: Partial<CopyPreferences>): void {
  if (prefs.imageCopyMode) current.imageCopyMode = prefs.imageCopyMode
  if (prefs.mermaidCopyMode) current.mermaidCopyMode = prefs.mermaidCopyMode
  if (prefs.clipboardFormat) current.clipboardFormat = prefs.clipboardFormat
}

export function getImageCopyMode(): ImageCopyMode {
  return current.imageCopyMode
}

export function getMermaidCopyMode(): MermaidCopyMode {
  return current.mermaidCopyMode
}

export function getClipboardFormat(): ClipboardFormat {
  return current.clipboardFormat
}
