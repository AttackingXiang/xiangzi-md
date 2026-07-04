import type mermaid from 'mermaid'
import { t } from './i18n'

// 动态加载 mermaid（体积较大）：只有真正渲染图表时才加载，避免拖慢启动
type MermaidApi = typeof mermaid
let mermaidPromise: Promise<MermaidApi> | null = null
let currentMode: string | null = null

/**
 * htmlLabels=false 用于导出/复制成图：屏幕预览用 foreignObject 排版更好，但
 * WebKit 把含 foreignObject 的 SVG 画上 canvas 会污染画布，无法转 PNG。
 * mermaid 的配置是全局的（%%{init}%% 指令对 htmlLabels 实测不生效），因此
 * 这里按「主题+标签模式」记忆当前配置，模式变化时重新 initialize。
 */
async function getMermaid(theme: 'light' | 'dark', htmlLabels = true): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default)
  }
  const mermaid = await mermaidPromise
  const mTheme = theme === 'dark' ? 'dark' : 'default'
  const mode = `${mTheme}|${String(htmlLabels)}`
  if (currentMode !== mode) {
    // mermaid 11 起各图表的 htmlLabels 子配置已废弃，顶层 htmlLabels 优先生效
    mermaid.initialize({
      startOnLoad: false,
      theme: mTheme,
      securityLevel: 'strict',
      htmlLabels,
    })
    currentMode = mode
  }
  return mermaid
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

/**
 * 以「可栅格化」配置（htmlLabels:false，纯 <text> 标签、无 foreignObject）
 * 重新渲染 mermaid 源码，返回 SVG 字符串，专供复制/导出成图片。
 * 不影响屏幕预览：下一次预览渲染会按需切回 htmlLabels:true。
 */
export async function renderMermaidForExport(
  theme: 'light' | 'dark',
  content: string,
): Promise<string> {
  const mermaid = await getMermaid(theme, false)
  const id = 'mmdx-' + Math.random().toString(36).slice(2)
  const { svg } = await mermaid.render(id, content)
  return svg
}

/**
 * 供 Crepe code-mirror 的 renderPreview 使用：mermaid 代码块异步渲染为图表。
 * 返回 undefined 表示异步，渲染完成后经 applyPreview 回填 SVG 字符串。
 */
export function renderMermaid(theme: 'light' | 'dark') {
  return (
    language: string,
    content: string,
    applyPreview: (value: null | string | HTMLElement) => void,
  ): void | null => {
    if (!language || language.toLowerCase() !== 'mermaid') return null
    if (!content.trim()) return null

    const id = 'mmd-' + Math.random().toString(36).slice(2)
    void (async () => {
      try {
        const mermaid = await getMermaid(theme)
        const { svg } = await mermaid.render(id, content)
        applyPreview(`<div class="mermaid-preview">${svg}</div>`)
      } catch (err: unknown) {
        const msg = escapeHtml(String((err as Error)?.message ?? err))
        applyPreview(`<div class="mermaid-error">${t('图表语法有误')}: ${msg}</div>`)
      }
    })()

    return undefined
  }
}
