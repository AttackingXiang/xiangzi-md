import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { languages } from '@codemirror/language-data'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  keymap,
} from '@codemirror/view'
import { cm6ToolbarState } from './toolbarState'

export const defaultCm6Theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--editor-font-size, 16px)',
  },
  '.cm-scroller': {
    overflowX: 'hidden',
    overflowY: 'auto',
    fontFamily: 'var(--editor-font-family, inherit)',
    lineHeight: 'var(--editor-line-height, 1.75)',
  },
  '.cm-sizer': {
    boxSizing: 'border-box',
    minWidth: '0',
    width: '100%',
  },
  '.cm-content': {
    maxWidth: 'var(--editor-content-width, 920px)',
    minWidth: '0',
    width: '100%',
    margin: '0 auto',
    padding: '32px 48px 50vh',
    caretColor: 'var(--accent)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection-color, rgba(99, 102, 241, 0.2))',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
})

export function createBaseExtensions(): Extension[] {
  return [
    markdown({ base: markdownLanguage, extensions: GFM, codeLanguages: languages }),
    history(),
    search({ top: true }),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    highlightActiveLine(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorState.allowMultipleSelections.of(true),
    cm6ToolbarState,
  ]
}
