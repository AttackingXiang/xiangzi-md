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
import { pendingTextColor, planPendingColorInput } from './commands'
import { contextMenuSelection } from './contextMenuSelection'
import { richMarkdownPaste } from './richPaste'
import { activeSearchMatchHighlight } from './searchMatchHighlight'
import { selectionCoordinator } from './selection/selectionCoordinator'
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
    backgroundColor: 'var(--xmd-document-selection-bg)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
})

export function createBaseExtensions(): Extension[] {
  return [
    markdown({ base: markdownLanguage, extensions: GFM, codeLanguages: languages }),
    history(),
    search({ top: true }),
    activeSearchMatchHighlight(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    highlightActiveLine(),
    selectionCoordinator(),
    contextMenuSelection(),
    pendingTextColor,
    EditorView.inputHandler.of((view, from, to, text) => {
      // IME 组合期间不能接管：自行 dispatch 并返回 true 会打断 composition，
      // 中文/日文输入会变成半成品。planPendingColorInput 不知道 composing，
      // 所以这一条留在这里判断。
      const plan = planPendingColorInput(view.state, from, to, text, view.composing)
      if (!plan) return false
      view.dispatch(plan)
      return plan.changes !== undefined
    }),
    richMarkdownPaste(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorState.allowMultipleSelections.of(true),
    cm6ToolbarState,
  ]
}
