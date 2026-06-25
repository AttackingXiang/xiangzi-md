import mermaid from 'mermaid'

let currentTheme: string | null = null

function ensureInit(theme: 'light' | 'dark'): void {
  const mTheme = theme === 'dark' ? 'dark' : 'default'
  if (currentTheme !== mTheme) {
    mermaid.initialize({ startOnLoad: false, theme: mTheme, securityLevel: 'strict' })
    currentTheme = mTheme
  }
}

/**
 * 返回供 Crepe code-mirror 的 renderPreview 使用的回调：
 * 当代码块语言为 mermaid 时，渲染为图表；否则返回 null（不预览）。
 */
export function renderMermaid(theme: 'light' | 'dark') {
  return (language: string, content: string): HTMLElement | null => {
    if (!language || language.toLowerCase() !== 'mermaid') return null
    if (!content.trim()) return null
    ensureInit(theme)

    const container = document.createElement('div')
    container.className = 'mermaid-preview'
    const id = 'mmd-' + Math.random().toString(36).slice(2)

    mermaid
      .render(id, content)
      .then(({ svg }) => {
        container.innerHTML = svg
      })
      .catch((err: unknown) => {
        const pre = document.createElement('pre')
        pre.className = 'mermaid-error'
        pre.textContent = '图表语法有误：' + String((err as Error)?.message ?? err)
        container.innerHTML = ''
        container.appendChild(pre)
      })

    return container
  }
}
