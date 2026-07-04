/**
 * 代码语法高亮的语义化色板：CodeMirror 编辑态、静态渲染态（code-table.css）、
 * HTML 导出态三个消费点全部从这里（经由 CSS 变量）派生，不再各自维护一份
 * 颜色表——避免像此前那样三处手工同步、悄悄走样。
 *
 * ThemeName 只是文档标识，真正的颜色值以 foundation.css 里同名的
 * --code-keyword 等 CSS 变量为准；这里的常量仅供 mermaid 主题变量（需要
 * JS 侧的字面量颜色，无法直接吃 CSS 变量）在运行时读取当前 --code-* 计算值。
 */
export type ThemeName = 'light' | 'dark' | 'warm' | 'mint' | 'blue' | 'summer'

export interface CodeSyntaxPalette {
  keyword: string
  string: string
  comment: string
  number: string
  function: string
  type: string
  property: string
  variable: string
  tag: string
  operator: string
  meta: string
  link: string
  invalid: string
  diffAdded: string
  diffRemoved: string
}

/** 对应 foundation.css 里 --code-keyword 等变量名（不含 -- 前缀）。 */
export const CODE_PALETTE_CSS_VARS: Record<keyof CodeSyntaxPalette, string> = {
  keyword: 'code-keyword',
  string: 'code-string',
  comment: 'code-comment',
  number: 'code-number',
  function: 'code-function',
  type: 'code-type',
  property: 'code-property',
  variable: 'code-variable',
  tag: 'code-tag',
  operator: 'code-operator',
  meta: 'code-meta',
  link: 'code-link',
  invalid: 'code-invalid',
  diffAdded: 'code-diff-added',
  diffRemoved: 'code-diff-removed',
}

/** 从已挂载的 DOM 读取当前生效的 --code-* 计算值，供 mermaid 等只能接受字面量颜色的场景使用。 */
export function readComputedCodePalette(
  root: Element = document.documentElement,
): CodeSyntaxPalette {
  const style = getComputedStyle(root)
  const read = (name: string): string => style.getPropertyValue(`--${name}`).trim()
  const entries = Object.entries(CODE_PALETTE_CSS_VARS) as Array<[keyof CodeSyntaxPalette, string]>
  const result = {} as CodeSyntaxPalette
  for (const [key, cssVar] of entries) result[key] = read(cssVar)
  return result
}
