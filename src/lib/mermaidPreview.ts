import type mermaid from 'mermaid'
import { t } from './i18n'

// 动态加载 mermaid（体积较大）：只有真正渲染图表时才加载，避免拖慢启动
type MermaidApi = typeof mermaid
let mermaidPromise: Promise<MermaidApi> | null = null
let currentTheme: string | null = null

async function getMermaid(theme: 'light' | 'dark'): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default)
  }
  const mermaid = await mermaidPromise
  const mTheme = theme === 'dark' ? 'dark' : 'default'
  if (currentTheme !== mTheme) {
    mermaid.initialize({ startOnLoad: false, theme: mTheme, securityLevel: 'strict' })
    currentTheme = mTheme
  }
  return mermaid
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
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
