import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/** 浅色主题：GitHub 风格配色 */
const lightHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: '#cf222e' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#0a3069' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6e7781', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#0550ae' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#8250df' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: '#953800' },
  { tag: [t.propertyName, t.attributeName], color: '#116329' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#1e293b' },
  { tag: [t.tagName, t.angleBracket], color: '#116329' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#57606a' },
  { tag: [t.meta, t.documentMeta], color: '#6e7781' },
  { tag: [t.heading], fontWeight: '600' },
  { tag: [t.link, t.url], color: '#0969da', textDecoration: 'underline' },
  { tag: [t.invalid], color: '#cf222e' },
])

const lightTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: '#1e293b' },
  '.cm-scroller': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#94a3b8' },
  '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.03)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '.cm-cursor': { borderLeftColor: '#4f46e5' },
})

/** 深色主题：GitHub Dimmed 风格，完全 transparent 背景，让外层 CSS 控制底色 */
const darkHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: '#c678dd' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#98c379' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#5c6370', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#d19a66' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#61afef' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: '#e5c07b' },
  { tag: [t.propertyName, t.attributeName], color: '#56b6c2' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#e06c75' },
  { tag: [t.tagName, t.angleBracket], color: '#e06c75' },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: '#56b6c2' },
  { tag: [t.meta, t.documentMeta], color: '#5c6370' },
  { tag: [t.heading], fontWeight: '600' },
  { tag: [t.link, t.url], color: '#61afef', textDecoration: 'underline' },
  { tag: [t.invalid], color: '#e06c75' },
])

const darkTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#adbac7' },
    '.cm-scroller': { backgroundColor: 'transparent' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#4d5566' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-cursor': { borderLeftColor: '#818cf8' },
  },
  { dark: true },
)

function selectionTheme(mode: 'light' | 'dark'): Extension {
  const sel = mode === 'dark' ? 'rgba(125,175,255,0.2)' : '#bfdbfe'
  return EditorView.theme(
    {
      '.cm-selectionLayer .cm-selectionBackground': { backgroundColor: sel },
      '&.cm-focused .cm-selectionLayer .cm-selectionBackground': { backgroundColor: sel },
      '.cm-selectionBackground': { backgroundColor: sel },
      '&.cm-focused .cm-selectionBackground': { backgroundColor: sel },
    },
    { dark: mode === 'dark' },
  )
}

export function codeMirrorTheme(mode: 'light' | 'dark'): Extension {
  if (mode === 'dark') return [darkTheme, syntaxHighlighting(darkHighlight), selectionTheme('dark')]
  return [lightTheme, syntaxHighlighting(lightHighlight), selectionTheme('light')]
}
