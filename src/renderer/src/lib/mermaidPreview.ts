import mermaid from 'mermaid'

let currentTheme: string | null = null

function ensureInit(theme: 'light' | 'dark'): void {
  const mTheme = theme === 'dark' ? 'dark' : 'default'
  if (currentTheme !== mTheme) {
    mermaid.initialize({ startOnLoad: false, theme: mTheme, securityLevel: 'strict' })
    currentTheme = mTheme
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

/**
 * 供 Crepe code-mirror 的 renderPreview 使用：mermaid 代码块异步渲染为图表。
 *
 * 注意：PreviewPanel 仅在 preview 值被「重新赋值」时刷新，且会 sanitizeSvg(value)。
 * 因此必须返回 undefined 表示异步，并在渲染完成后通过 applyPreview 传入 SVG 字符串。
 */
export function renderMermaid(theme: 'light' | 'dark') {
  return (
    language: string,
    content: string,
    applyPreview: (value: null | string | HTMLElement) => void
  ): void | null => {
    if (!language || language.toLowerCase() !== 'mermaid') return null
    if (!content.trim()) return null
    ensureInit(theme)

    const id = 'mmd-' + Math.random().toString(36).slice(2)
    mermaid
      .render(id, content)
      .then(({ svg }) => applyPreview(`<div class="mermaid-preview">${svg}</div>`))
      .catch((err: unknown) => {
        const msg = escapeHtml(String((err as Error)?.message ?? err))
        applyPreview(`<div class="mermaid-error">图表语法有误：${msg}</div>`)
      })

    // 返回 undefined：告知组件这是异步预览（先显示 loading，待 applyPreview 回填）
    return undefined
  }
}
