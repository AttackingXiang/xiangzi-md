import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * CodeMirror 的语法高亮颜色一律引用 --code-* CSS 变量（定义在
 * foundation.css，与静态渲染态、HTML 导出态共用同一份色板，见
 * src/lib/codeSyntaxPalette.ts）。style-mod（EditorView.theme 的底层实现）
 * 只是把这些值原样写进生成的 <style> 规则，浏览器按正常的 CSS 层叠去解析
 * var(...)，因此这份高亮定义天然不区分主题——切换 [data-theme] 时颜色自动
 *跟着变，不需要为每个新主题单独维护一份 HighlightStyle。
 */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--code-string)' },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--code-comment)',
    fontStyle: 'italic',
  },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: 'var(--code-function)',
  },
  {
    tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)],
    color: 'var(--code-type)',
  },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-property)' },
  { tag: [t.variableName, t.definition(t.variableName)], color: 'var(--code-variable)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--code-tag)' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: 'var(--code-operator)' },
  { tag: [t.meta, t.documentMeta], color: 'var(--code-meta)' },
  { tag: [t.heading], fontWeight: '600' },
  { tag: [t.link, t.url], color: 'var(--code-link)', textDecoration: 'underline' },
  { tag: [t.invalid], color: 'var(--code-invalid)' },
])

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--code-text)' },
  '.cm-scroller': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--code-btn-color)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--code-selection-bg)' },
  '&.cm-focused .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--code-selection-bg)',
  },
  '.cm-selectionBackground': { backgroundColor: 'var(--code-selection-bg)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--code-selection-bg)' },
})

export function codeMirrorTheme(): Extension {
  return [theme, syntaxHighlighting(highlight)]
}
