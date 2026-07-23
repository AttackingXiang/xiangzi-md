import { syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'
import type { EditorState } from '@codemirror/state'
import { mermaidSourceRange } from './mermaidPreview'

export interface FencedCodeData {
  from: number
  to: number
  language: string
  languageFrom: number
  languageTo: number
  codeFrom: number
  codeTo: number
  firstCodeLineFrom: number
  lastCodeLineFrom: number
  closingFrom: number | null
}

/** Mermaid normally owns its whole fenced block as a rendered replacement.
 * While one diagram is explicitly opened as source, let the ordinary fenced
 * code presentation own that block so editing looks and behaves like every
 * other code block. */
export function isEditableMermaidSource(state: EditorState, data: FencedCodeData): boolean {
  if (data.language.toLowerCase() !== 'mermaid') return false
  const source = state.field(mermaidSourceRange, false)
  return source?.from === data.from && source.to === data.to
}

export function isCodeBlockPresentation(state: EditorState, data: FencedCodeData): boolean {
  return data.language.toLowerCase() !== 'mermaid' || isEditableMermaidSource(state, data)
}

export function readFencedCode(
  state: EditorState,
  from: number,
  to: number,
  tree: Tree = syntaxTree(state),
): FencedCodeData {
  let targetFenceFrom: number | null = null
  let openingMarkFrom: number | null = null
  let openingMarkTo: number | null = null
  let closingMarkFrom: number | null = null
  let language = ''
  let languageFrom: number | null = null
  let languageTo: number | null = null

  // The Markdown parser has already applied container indentation rules.
  // Read its direct FencedCode children instead of re-parsing physical lines
  // with a 0–3-space regex: a fence nested under a list legitimately has four
  // or more leading spaces in the source document.
  tree.iterate({
    from,
    to,
    enter(node) {
      const parent = node.node.parent
      if (node.name === 'CodeMark' && parent?.name === 'FencedCode') {
        targetFenceFrom ??= parent.from
        if (parent.from !== targetFenceFrom) return
        if (openingMarkFrom === null) {
          openingMarkFrom = node.from
          openingMarkTo = node.to
        } else if (closingMarkFrom === null) {
          closingMarkFrom = node.from
        }
        return
      }
      if (node.name === 'CodeInfo') {
        if (targetFenceFrom !== null && parent?.from !== targetFenceFrom) return
        language = state.doc.sliceString(node.from, node.to).trim().split(/\s+/, 1)[0] ?? ''
        languageFrom = node.from
        languageTo = node.to
      }
    },
  })

  const opening = state.doc.lineAt(openingMarkFrom ?? from)
  const closing = closingMarkFrom === null ? null : state.doc.lineAt(closingMarkFrom)
  const fallbackLanguageFrom = Math.min(opening.to, openingMarkTo ?? opening.from + 3)
  // The body range is structural: everything between the two fence lines.
  // CodeText nodes deliberately omit some blank lines and may be split by the
  // language parser, so they must not be used as the editable/copy range.
  const codeFrom = Math.min(state.doc.length, opening.to + 1)
  const codeTo = Math.max(codeFrom, closing ? closing.from - 1 : to)
  const firstCodeLineFrom = state.doc.lineAt(codeFrom).from
  // `codeTo` is the structural end boundary of the body, not the position of
  // its final character.  This distinction matters when the body ends in a
  // blank line: after pressing Enter at the end of the last code line, codeTo
  // points at that new blank line. Looking at codeTo - 1 would keep the
  // previous non-empty line marked as the visual last line and render the new
  // blank line as a second, detached code card.
  const lastCodeLineFrom = state.doc.lineAt(Math.max(codeFrom, codeTo)).from
  return {
    from,
    to,
    language,
    languageFrom: languageFrom ?? fallbackLanguageFrom,
    languageTo: languageTo ?? fallbackLanguageFrom,
    codeFrom,
    codeTo,
    firstCodeLineFrom,
    lastCodeLineFrom,
    closingFrom: closing?.from ?? null,
  }
}

/**
 * Find the `FencedCode` node (if any) whose span contains `position`. Accepts
 * an already-resolved `tree` so callers that raced ahead of the background
 * parser (via `ensureSyntaxTree`) can supply a complete tree instead of the
 * possibly-stale one `syntaxTree(state)` would otherwise recompute. Defaults
 * to `syntaxTree(state)` for every other (hot-path) caller, unchanged from
 * before.
 */
export function fencedCodeAt(
  state: EditorState,
  position: number,
  tree: Tree = syntaxTree(state),
): FencedCodeData | null {
  let result: FencedCodeData | null = null
  tree.iterate({
    from: Math.max(0, position - 1),
    to: Math.min(state.doc.length, position + 1),
    enter(node) {
      if (node.name !== 'FencedCode' || position < node.from || position > node.to) return
      result = readFencedCode(state, node.from, node.to, tree)
      return false
    },
  })
  return result
}

export function fencedCodeAtSelection(state: EditorState, tree?: Tree): FencedCodeData | null {
  return fencedCodeAt(state, state.selection.main.head, tree)
}

export function findFencedCodeAt(state: EditorState, blockFrom: number): FencedCodeData | null {
  let result: FencedCodeData | null = null
  syntaxTree(state).iterate({
    from: blockFrom,
    to: Math.min(state.doc.length, blockFrom + 1),
    enter(node) {
      if (node.name !== 'FencedCode' || node.from !== blockFrom) return
      result = readFencedCode(state, node.from, node.to)
      return false
    },
  })
  return result
}

/** The fenced code block owning the primary selection head, when it is an
 * editable (non-Mermaid) block — the block the singleton overlays serve. */
export function activeEditableFencedCode(state: EditorState): FencedCodeData | null {
  const data = fencedCodeAtSelection(state)
  return data !== null && isCodeBlockPresentation(state, data) ? data : null
}

/** Use the browser's native selection painting only for a single range that is
 * fully contained by one editable code body. Unlike CM6's full-line rectangle
 * layer, the native highlight is clipped by each line's horizontal scroller
 * and cannot escape the card. Cross-block selections keep CM6 painting so its
 * virtualized selection remains visible while the editor scrolls. */
export function selectionIntersectsFencedCode(state: EditorState): boolean {
  if (state.selection.ranges.length !== 1) return false
  const range = state.selection.main
  if (range.empty) return false
  const data = fencedCodeAt(state, range.from)
  return (
    data !== null &&
    isCodeBlockPresentation(state, data) &&
    range.from >= data.codeFrom &&
    range.to <= data.codeTo
  )
}

/** Whether a code-caret repaint is warranted after a nested code-row scroller
 * moved outside a view update (see `queueCodeCaretRepaint`): any collapsed
 * CM6 range inside an editable non-Mermaid code body depends on that nested
 * `scrollLeft`; selections elsewhere do not. */
export function needsCodeCaretRepaint(state: EditorState): boolean {
  return state.selection.ranges.some((range) => {
    if (!range.empty) return false
    const data = fencedCodeAt(state, range.head)
    return (
      data !== null &&
      isCodeBlockPresentation(state, data) &&
      range.head >= data.codeFrom &&
      range.head <= data.codeTo
    )
  })
}
