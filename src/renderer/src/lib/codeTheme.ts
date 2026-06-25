import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { tags as t } from '@lezer/highlight'

/** 浅色主题下的语法高亮（GitHub 风格配色） */
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: '#cf222e' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#0a3069' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6e7781', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#0550ae' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#8250df' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: '#953800' },
  { tag: [t.propertyName, t.attributeName], color: '#116329' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#24292f' },
  { tag: [t.tagName, t.angleBracket], color: '#116329' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#57606a' },
  { tag: [t.meta, t.documentMeta], color: '#6e7781' },
  { tag: [t.heading], fontWeight: '600' },
  { tag: [t.link, t.url], color: '#0969da', textDecoration: 'underline' },
  { tag: [t.invalid], color: '#cf222e' }
])

const lightTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: '#24292f' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#8c959f' },
  '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' }
})

/** 选中文本配色：柔和、低饱和，不发黑 */
function selectionTheme(mode: 'light' | 'dark'): Extension {
  const sel = mode === 'dark' ? 'rgba(125,175,255,0.22)' : '#eaf1ff'
  return EditorView.theme(
    {
      '.cm-selectionLayer .cm-selectionBackground': { backgroundColor: sel },
      '&.cm-focused .cm-selectionLayer .cm-selectionBackground': { backgroundColor: sel },
      '.cm-selectionBackground': { backgroundColor: sel },
      '&.cm-focused .cm-selectionBackground': { backgroundColor: sel },
      '.cm-content ::selection': { backgroundColor: sel },
      '.cm-line::selection': { backgroundColor: sel }
    },
    { dark: mode === 'dark' }
  )
}

/** 按当前主题返回代码块的 CodeMirror 主题扩展 */
export function codeMirrorTheme(mode: 'light' | 'dark'): Extension {
  if (mode === 'dark') return [oneDark, selectionTheme('dark')]
  return [lightTheme, syntaxHighlighting(lightHighlight), selectionTheme('light')]
}
