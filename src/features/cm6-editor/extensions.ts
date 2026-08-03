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
import { pendingTextColor, setPendingTextColor } from './commands'
import { contextMenuSelection } from './contextMenuSelection'
import { richMarkdownPaste } from './richPaste'
import { activeInlineSearchMatchHighlight } from './searchMatchHighlight'
import { selectionCoordinator } from './selection/selectionCoordinator'
import { cm6ToolbarState, selectionTouchesCodeBlock } from './toolbarState'

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
    activeInlineSearchMatchHighlight(),
    drawSelection(),
    dropCursor(),
    bracketMatching(),
    highlightActiveLine(),
    selectionCoordinator(),
    contextMenuSelection(),
    pendingTextColor,
    EditorView.inputHandler.of((view, from, to, text) => {
      const color = view.state.field(pendingTextColor, false)
      if (!color || !text) return false

      const line = view.state.doc.lineAt(from)
      const linePrefix = line.text.slice(0, from - line.from)
      const prospectiveLine = `${linePrefix}${text}`
      const startsFence =
        /^\s{0,3}`/.test(prospectiveLine) && /^\s{0,3}`{1,3}(?:$|[^`])/.test(prospectiveLine)
      const startsIndentedText = linePrefix.trim() === '' && /^\s/.test(text)
      if (selectionTouchesCodeBlock(view.state) || startsFence || startsIndentedText) {
        view.dispatch({ effects: setPendingTextColor.of(null) })
        return false
      }

      // Keep consecutive keystrokes in one semantic span. Browser input events
      // commonly arrive one character at a time; replacing the closing tag on
      // the next event avoids producing one `<font>` pair per character.
      const opening = `<font color="${color}">`
      const closing = '</font>'
      const previous = view.state.sliceDoc(Math.max(0, from - closing.length), from)
      const contentEnd = from - closing.length
      const openingFrom = view.state.sliceDoc(0, contentEnd).lastIndexOf(opening)
      const canExtend =
        previous === closing &&
        openingFrom >= 0 &&
        !view.state.sliceDoc(openingFrom + opening.length, contentEnd).includes(closing)
      const insert = canExtend ? `${text}${closing}` : `${opening}${text}${closing}`
      const replaceFrom = canExtend ? from - closing.length : from
      view.dispatch({
        changes: { from: replaceFrom, to, insert },
        selection: { anchor: replaceFrom + insert.length },
        effects: setPendingTextColor.of(color),
        userEvent: 'input.type',
      })
      return true
    }),
    richMarkdownPaste(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorState.allowMultipleSelections.of(true),
    cm6ToolbarState,
  ]
}
