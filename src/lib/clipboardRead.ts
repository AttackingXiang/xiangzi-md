import { desktop } from '../platform'

export interface ClipboardPayload {
  /** `text/html` flavour when the clipboard carries one and the WebView allows reading it. */
  html: string | null
  text: string
}

/**
 * 读取系统剪贴板。
 *
 * 三条路径依次尝试，因为两个 WebView 的能力不一样：
 * - Web Clipboard API 的 `read()` 能拿到 `text/html`，WebView2（Chromium）支持；
 *   WKWebView 可能因为缺少用户手势而拒绝。
 * - Tauri 的 clipboard-manager 插件只提供纯文本读取（没有 readHtml），
 *   但它不受 WebView 权限限制，是 macOS 上最可靠的一条。
 * - 最后再试一次 Web 的 readText，兜住浏览器预览模式。
 *
 * 注意这不是 ⌘V 的实现路径——原生粘贴走 DOM 的 `paste` 事件，由 richPaste
 * 扩展处理，始终能拿到完整的 HTML。这里只服务于菜单项和右键菜单。
 */
export async function readClipboard(): Promise<ClipboardPayload | null> {
  if (navigator.clipboard?.read) {
    try {
      let html: string | null = null
      let text = ''
      for (const item of await navigator.clipboard.read()) {
        if (html === null && item.types.includes('text/html')) {
          html = await (await item.getType('text/html')).text()
        }
        if (!text && item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text()
        }
      }
      if (html !== null || text) return { html, text }
    } catch {
      // 权限被拒、无用户手势，或该 WebView 不支持二进制读取。
    }
  }

  try {
    const text = await desktop.readClipboardText()
    if (text) return { html: null, text }
  } catch {
    // 原生剪贴板不可用。
  }

  try {
    if (navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText()
      if (text) return { html: null, text }
    }
  } catch {
    // 读不到就当剪贴板是空的。
  }
  return null
}
