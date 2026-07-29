import { syntaxTree } from '@codemirror/language'
import { getSearchQuery } from '@codemirror/search'
import { Prec, type EditorState, type Extension, type SelectionRange } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

const activeInlineSearchMatch = Decoration.mark({ class: 'xmd-cm-active-search-match' })

function isInsideInlineCode(state: EditorState, range: SelectionRange): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(range.from, 1)
  while (node) {
    if (node.name === 'InlineCode') return range.to <= node.to
    node = node.parent
  }
  return false
}

function isExactSearchMatch(state: EditorState, range: SelectionRange): boolean {
  if (range.empty) return false
  const query = getSearchQuery(state)
  if (!query.valid) return false
  const result = query.getCursor(state, range.from, range.to).next()
  return !result.done && result.value.from === range.from && result.value.to === range.to
}

export function activeInlineSearchMatchDecorations(state: EditorState): DecorationSet {
  const ranges = state.selection.ranges
    .filter((range) => isExactSearchMatch(state, range) && isInsideInlineCode(state, range))
    .map((range) => activeInlineSearchMatch.range(range.from, range.to))
  return Decoration.set(ranges, true)
}

class ActiveInlineSearchMatchPlugin {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = activeInlineSearchMatchDecorations(view.state)
  }

  update(update: { state: EditorState }): void {
    this.decorations = activeInlineSearchMatchDecorations(update.state)
  }
}

/** Paint the active search range above an inline-code surface while the find input owns focus. */
export function activeInlineSearchMatchHighlight(): Extension {
  return Prec.high(
    ViewPlugin.fromClass(ActiveInlineSearchMatchPlugin, {
      decorations: (plugin) => plugin.decorations,
    }),
  )
}
