import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorState } from '@codemirror/state'
import { findClusterBreak, type Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { HEADING_NODE_NAMES } from './nodePolicy'
import type { PreviewRange } from './types'

/**
 * The minimal command set the WYSIWYG engine needs beyond CM6's own
 * defaults. Every blank line is now an ordinary, addressable document line
 * (see core/README.md), so plain Backspace/Delete/Enter already do the
 * right thing for blank-line editing — nothing here special-cases blank
 * lines. What remains here falls into two families:
 *
 * 1. Block split/join (`splitTopLevelMarkdownBlock`, `splitContainerMarkdownBlock`,
 *    `insertMarkdownHardBreak`, `insertContainerMarkdownHardBreak`,
 *    `joinContainerMarkdownBlock`) give Enter/Shift+Enter/Backspace/Delete
 *    ProseMirror-style block semantics for paragraphs, lists and quotes.
 * 2. Boundary deletion (`headingBoundaryDeletion`, `listBoundaryDeletion`,
 *    `quoteBoundaryDeletion`, `cleanupEmptyMarkdownFormatting`) gives the
 *    hidden, atomic prefix of a heading/list item/quote line ordinary
 *    rich-text backspace/delete semantics, and removes a formatting
 *    construct entirely once a user deletes its last visible character.
 */

function topLevelBlockAt(state: EditorState, position: number, bias: -1 | 1): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, bias)
  while (node && node.name !== 'Document') {
    if (
      node.parent?.name === 'Document' &&
      (node.name === 'Paragraph' || HEADING_NODE_NAMES.has(node.name))
    )
      return node
    node = node.parent
  }
  return null
}

function topLevelParagraphAt(
  state: EditorState,
  position: number,
  bias: -1 | 1,
): SyntaxNode | null {
  const node = topLevelBlockAt(state, position, bias)
  return node?.name === 'Paragraph' ? node : null
}

/**
 * ProseMirror-style Enter for a top-level text block: split the block,
 * rather than adding a source-only soft line. Markdown serializes the two
 * blocks with exactly one structural blank line (`\n\n`).
 */
export function splitTopLevelMarkdownBlock(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  const start = topLevelBlockAt(state, selection.from, -1)
  const end = topLevelBlockAt(state, selection.to, -1)
  if (!start || start !== end) return null

  const head = selection.head
  const line = state.doc.lineAt(head)
  let from = selection.from
  let to = selection.to
  // At document end, the second newline creates a trailing editable paragraph
  // whose source position is immediately after the first newline.
  let anchor = selection.to === state.doc.length ? from + 1 : from + 2

  // A soft source newline already inside one paragraph is replaced, not kept
  // as an additional explicit blank line when the user splits at its edge.
  if (
    selection.empty &&
    head === line.to &&
    line.to < state.doc.length &&
    state.doc.sliceString(head, head + 1) === '\n'
  ) {
    from = head
    to = head + 1
    anchor = head + 2
  } else if (
    selection.empty &&
    head === line.from &&
    head > 0 &&
    state.doc.sliceString(head - 1, head) === '\n'
  ) {
    from = head - 1
    to = head
    anchor = head + 1
  }

  return {
    changes: { from, to, insert: '\n\n' },
    selection: { anchor },
    scrollIntoView: true,
    userEvent: 'input',
  }
}

/** Insert a portable hard break; the backslash is hidden by live preview. */
export function insertMarkdownHardBreak(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  const block = topLevelParagraphAt(state, selection.from, -1)
  if (!block || block !== topLevelParagraphAt(state, selection.to, -1)) return null
  const from = selection.from
  return {
    changes: { from, to: selection.to, insert: '\\\n' },
    selection: { anchor: from + 2 },
    scrollIntoView: true,
    userEvent: 'input',
  }
}

interface ContainerLinePrefix {
  line: ReturnType<EditorState['doc']['lineAt']>
  quote: string
  list: {
    from: number
    to: number
    indentation: string
    marker: string
    task: boolean
  } | null
  contentFrom: number
}

/** Source representation of the editable container stack for one line. */
function containerLinePrefixAt(state: EditorState, position: number): ContainerLinePrefix | null {
  const line = state.doc.lineAt(position)
  let offset = 0
  for (;;) {
    const match = /^( {0,3}>[ \t]?)/.exec(line.text.slice(offset))
    if (!match) break
    offset += match[0].length
  }
  const quote = line.text.slice(0, offset)
  const listMatch = /^(\s*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line.text.slice(offset))
  if (!quote && !listMatch) return null
  if (!listMatch) return { line, quote, list: null, contentFrom: line.from + offset }
  const listFrom = line.from + offset
  const listTo = listFrom + listMatch[0].length
  return {
    line,
    quote,
    list: {
      from: listFrom,
      to: listTo,
      indentation: listMatch[1],
      marker: listMatch[2],
      task: Boolean(listMatch[4]),
    },
    contentFrom: listTo,
  }
}

function nextListMarker(prefix: NonNullable<ContainerLinePrefix['list']>): string {
  if (prefix.task) return '- [ ] '
  if (/^\d/.test(prefix.marker)) {
    const next = Number.parseInt(prefix.marker, 10) + 1
    const delimiter = prefix.marker.endsWith(')') ? ')' : '.'
    return `${next}${delimiter} `
  }
  return `${prefix.marker} `
}

/** ProseMirror-style split/exit behaviour for list items and blockquotes. */
export function splitContainerMarkdownBlock(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  if (!selection.empty) return null
  const prefix = containerLinePrefixAt(state, selection.head)
  if (!prefix) return null
  const content = state.doc.sliceString(prefix.contentFrom, prefix.line.to)
  if (content.length === 0) {
    // Empty list item exits its list but stays in its enclosing quote. An empty
    // quote exits to a normal editable paragraph.
    const from = prefix.list ? prefix.list.from : prefix.line.from
    const to = prefix.list ? prefix.list.to : prefix.contentFrom
    const insert = prefix.list ? prefix.list.indentation : ''
    return {
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
      userEvent: 'input',
    }
  }
  const continuation = prefix.list
    ? `${prefix.quote}${prefix.list.indentation}${nextListMarker(prefix.list)}`
    : prefix.quote
  return {
    changes: { from: selection.head, to: selection.head, insert: `\n${continuation}` },
    selection: { anchor: selection.head + continuation.length + 1 },
    scrollIntoView: true,
    userEvent: 'input',
  }
}

/** Hard break inside a quote/list keeps the current container prefix. */
export function insertContainerMarkdownHardBreak(state: EditorState): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  if (!selection.empty) return null
  const prefix = containerLinePrefixAt(state, selection.head)
  if (!prefix) return null
  const continuation = prefix.list
    ? `${prefix.quote}${prefix.list.indentation}${' '.repeat(prefix.list.to - prefix.list.from - prefix.list.indentation.length)}`
    : prefix.quote
  return {
    changes: { from: selection.head, to: selection.head, insert: `\\\n${continuation}` },
    selection: { anchor: selection.head + continuation.length + 2 },
    scrollIntoView: true,
    userEvent: 'input',
  }
}

function sameContainerKind(left: ContainerLinePrefix, right: ContainerLinePrefix): boolean {
  if (left.quote !== right.quote) return false
  if (Boolean(left.list) !== Boolean(right.list)) return false
  if (!left.list || !right.list) return true
  return (
    left.list.indentation === right.list.indentation &&
    left.list.task === right.list.task &&
    /^\d/.test(left.list.marker) === /^\d/.test(right.list.marker)
  )
}

/** Join adjacent compatible list items or quote paragraphs at a block edge. */
export function joinContainerMarkdownBlock(
  state: EditorState,
  forward: boolean,
): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  if (!selection.empty) return null
  const current = containerLinePrefixAt(state, selection.head)
  if (!current) return null
  if (forward) {
    if (selection.head !== current.line.to || current.line.number >= state.doc.lines) return null
    const next = containerLinePrefixAt(state, current.line.to + 1)
    if (!next || next.line.number !== current.line.number + 1 || !sameContainerKind(current, next))
      return null
    return {
      changes: { from: current.line.to, to: next.contentFrom },
      selection: { anchor: current.line.to },
      scrollIntoView: true,
      userEvent: 'delete.forward',
    }
  }

  if (selection.head !== current.contentFrom || current.line.number <= 1) return null
  const previous = containerLinePrefixAt(state, current.line.from - 1)
  if (
    !previous ||
    previous.line.number !== current.line.number - 1 ||
    !sameContainerKind(previous, current)
  )
    return null
  return {
    changes: { from: previous.line.to, to: current.contentFrom },
    selection: { anchor: previous.line.to },
    scrollIntoView: true,
    userEvent: 'delete.backward',
  }
}

const MARKER_NAMES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'LinkMark',
  'QuoteMark',
])

const EMPTY_CLEANUP_NODES = new Set([
  'StrongEmphasis',
  'Emphasis',
  'Strikethrough',
  'InlineCode',
  'Link',
])

interface MarkdownConstruct {
  from: number
  to: number
  contentFrom: number
  contentTo: number
  node: SyntaxNode
}

/** Expand a marker to swallow the whitespace it visually owns (heading `#`/quote `>`). */
export function hiddenMarkerRange(state: EditorState, node: SyntaxNode): PreviewRange {
  if (!['HeaderMark', 'QuoteMark'].includes(node.name)) return { from: node.from, to: node.to }
  const line = state.doc.lineAt(node.to)
  const whitespace =
    node.name === 'HeaderMark'
      ? (/^[ \t]+/.exec(state.doc.sliceString(node.to, line.to))?.[0].length ?? 0)
      : (/^[ \t]/.exec(state.doc.sliceString(node.to, line.to))?.[0].length ?? 0)
  return { from: node.from, to: node.to + whitespace }
}

function markdownLinkLabelRange(node: SyntaxNode): PreviewRange | null {
  const marks: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'LinkMark') marks.push(child)
  }
  if (marks.length < 2) return null
  return { from: marks[0].to, to: marks[1].from }
}

function markdownConstruct(state: EditorState, node: SyntaxNode): MarkdownConstruct | null {
  if (HEADING_NODE_NAMES.has(node.name)) {
    if (node.name.startsWith('SetextHeading')) {
      const cursor = node.cursor()
      if (cursor.firstChild()) {
        do {
          if (cursor.name === 'HeaderMark') {
            return {
              from: node.from,
              to: node.to,
              contentFrom: node.from,
              contentTo: cursor.from,
              node,
            }
          }
        } while (cursor.nextSibling())
      }
      return null
    }
    let contentFrom = node.from
    const cursor = node.cursor()
    if (cursor.firstChild()) {
      do {
        if (cursor.name === 'HeaderMark') {
          contentFrom = hiddenMarkerRange(state, cursor.node).to
          break
        }
      } while (cursor.nextSibling())
    }
    return { from: node.from, to: node.to, contentFrom, contentTo: node.to, node }
  }

  if (!EMPTY_CLEANUP_NODES.has(node.name)) return null
  if (node.name === 'Link') {
    const label = markdownLinkLabelRange(node)
    return label
      ? { from: node.from, to: node.to, contentFrom: label.from, contentTo: label.to, node }
      : null
  }

  let firstMarkerTo = -1
  let lastMarkerFrom = -1
  const cursor = node.cursor()
  if (cursor.firstChild()) {
    do {
      if (MARKER_NAMES.has(cursor.name)) {
        if (firstMarkerTo < 0) firstMarkerTo = cursor.to
        lastMarkerFrom = cursor.from
      }
    } while (cursor.nextSibling())
  }
  return firstMarkerTo >= 0 && lastMarkerFrom >= firstMarkerTo
    ? { from: node.from, to: node.to, contentFrom: firstMarkerTo, contentTo: lastMarkerFrom, node }
    : null
}

function visibleConstructTextAfter(transaction: Transaction, construct: MarkdownConstruct): string {
  const contentFrom = transaction.changes.mapPos(construct.contentFrom, 1)
  const contentTo = transaction.changes.mapPos(construct.contentTo, -1)
  const hidden: PreviewRange[] = []
  construct.node.cursor().iterate((child) => {
    if (
      MARKER_NAMES.has(child.name) ||
      (child.name === 'URL' && child.node.parent?.name === 'Link')
    ) {
      const range = hiddenMarkerRange(transaction.startState, child.node)
      const from = Math.max(contentFrom, transaction.changes.mapPos(range.from, 1))
      const to = Math.min(contentTo, transaction.changes.mapPos(range.to, -1))
      if (to > from) hidden.push({ from, to })
    }
  })
  hidden.sort((a, b) => a.from - b.from)
  let position = contentFrom
  let visible = ''
  for (const range of hidden) {
    if (range.from > position) visible += transaction.newDoc.sliceString(position, range.from)
    position = Math.max(position, range.to)
  }
  if (position < contentTo) visible += transaction.newDoc.sliceString(position, contentTo)
  return visible
}

/**
 * Remove the source markers of a formatting construct when a user deletion
 * empties its visible content — heading or inline (`**`, `_`, `~~`, `` ` ``,
 * link). The construct is read from the pre-change tree, because strings
 * such as `****` stop being parsed as emphasis immediately. Once the whole
 * construct (marker included) is deleted, the line is ordinary and blank —
 * no extra bookkeeping is needed for it to stay addressable.
 */
export function cleanupEmptyMarkdownFormatting(transaction: Transaction): TransactionSpec | null {
  if (!transaction.docChanged || !transaction.isUserEvent('delete')) return null

  const deleted: PreviewRange[] = []
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA) deleted.push({ from: fromA, to: toA })
  })
  if (deleted.length === 0) return null

  const cleanup: PreviewRange[] = []
  syntaxTree(transaction.startState).iterate({
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'HTMLBlock')
        return false
      const construct = markdownConstruct(transaction.startState, node.node)
      if (!construct || construct.contentTo <= construct.contentFrom) return
      const touched = deleted.some(
        ({ from, to }) => from < construct.contentTo && to > construct.contentFrom,
      )
      if (!touched) return
      if (visibleConstructTextAfter(transaction, construct).trim().length > 0) return
      cleanup.push({
        from: transaction.changes.mapPos(construct.from, 1),
        to: transaction.changes.mapPos(construct.to, -1),
      })
    },
  })
  if (cleanup.length === 0) return null

  cleanup.sort((a, b) => a.from - b.from || b.to - a.to)
  const merged: PreviewRange[] = []
  for (const range of cleanup) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else merged.push({ ...range })
  }
  return {
    changes: merged.map(({ from, to }) => ({ from, to })),
    sequential: true,
  }
}

/**
 * Give the visual left edge of an ATX/Setext heading ordinary rich-text
 * semantics. Backspace at heading-content-start: a blank line directly
 * above is removed on its own (the heading moves up, keeping its level);
 * otherwise the heading's hidden `#`/underline marker is stripped, demoting
 * it to a plain paragraph line. Delete at either atomic resting position
 * removes the first visible character of the heading's text, never the
 * marker.
 */
export function headingBoundaryDeletion(
  state: EditorState,
  forward: boolean,
): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  if (!selection.empty) return null
  const line = state.doc.lineAt(selection.head)
  const prefix = /^( {0,3})#{1,6}[ \t]+/.exec(line.text)?.[0]
  if (!prefix) return null
  const contentFrom = line.from + prefix.length
  if (selection.head < line.from || selection.head > contentFrom) return null

  if (!forward) {
    if (line.number > 1) {
      const previous = state.doc.line(line.number - 1)
      if (previous.length === 0) {
        return {
          changes: { from: previous.from, to: line.from },
          selection: { anchor: contentFrom - (line.from - previous.from) },
          scrollIntoView: true,
          userEvent: 'delete.backward',
        }
      }
    }
    return {
      changes: { from: line.from, to: contentFrom },
      selection: { anchor: line.from },
      scrollIntoView: true,
      userEvent: 'delete.backward',
    }
  }
  if (contentFrom >= line.to) return null
  const content = state.doc.sliceString(contentFrom, line.to)
  const to = contentFrom + findClusterBreak(content, 0, true)
  return {
    changes: { from: contentFrom, to },
    selection: { anchor: contentFrom },
    scrollIntoView: true,
    userEvent: 'delete.forward',
  }
}

interface ListLinePrefix {
  from: number
  to: number
  marker: string
  indentation: string
  task: boolean
  visibleContentFrom: number
}

export function listLinePrefix(state: EditorState, node: SyntaxNode): ListLinePrefix | null {
  if (node.name !== 'ListMark') return null
  const line = state.doc.lineAt(node.from)
  const beforeMarker = state.doc.sliceString(line.from, node.from)
  const rawIndentation = /[ \t]*$/.exec(beforeMarker)?.[0] ?? ''
  const beforeIndentation = beforeMarker.slice(0, beforeMarker.length - rawIndentation.length)
  // The first optional space after a blockquote `>` belongs to the quote
  // delimiter. It is not list nesting and must remain when list formatting is
  // removed at the visual left edge.
  const indentation =
    beforeIndentation.endsWith('>') && rawIndentation.startsWith(' ')
      ? rawIndentation.slice(1)
      : rawIndentation
  const trailing = /^[ \t]+/.exec(state.doc.sliceString(node.to, line.to))?.[0] ?? ''
  if (!trailing) return null
  const from = node.from - indentation.length
  const to = node.to + trailing.length
  const taskPrefix = /^\[[ xX]\][ \t]+/.exec(state.doc.sliceString(to, line.to))?.[0] ?? ''
  return {
    from,
    to,
    marker: state.doc.sliceString(node.from, node.to),
    indentation,
    task: taskPrefix.length > 0,
    visibleContentFrom: to + taskPrefix.length,
  }
}

function listLinePrefixAtSelection(state: EditorState): ListLinePrefix | null {
  const position = state.selection.main.head
  const line = state.doc.lineAt(position)
  let result: ListLinePrefix | null = null
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (node.name !== 'ListMark') return
      const prefix = listLinePrefix(state, node.node)
      if (prefix && position >= prefix.from && position <= prefix.visibleContentFrom) {
        result = prefix
        return false
      }
    },
  })
  return result
}

/**
 * Give hidden list prefixes the same deletion semantics as visible rich-text
 * list markers. Backspace outdents a nested item or turns a top-level item
 * into a paragraph; Delete removes the first visible grapheme.
 */
export function listBoundaryDeletion(state: EditorState, forward: boolean): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  if (!selection.empty) return null
  const line = state.doc.lineAt(selection.head)
  const parsed = listLinePrefixAtSelection(state)
  const fallback = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+/.exec(line.text)
  const fallbackTaskPrefix = fallback
    ? (/^\[[ xX]\][ \t]+/.exec(line.text.slice(fallback[0].length))?.[0] ?? '')
    : ''
  const prefix =
    parsed ??
    (fallback
      ? {
          from: line.from,
          to: line.from + fallback[0].length,
          marker: '',
          indentation: fallback[1],
          task: fallbackTaskPrefix.length > 0,
          visibleContentFrom: line.from + fallback[0].length + fallbackTaskPrefix.length,
        }
      : null)
  if (!prefix) return null

  const { indentation, visibleContentFrom } = prefix
  if (selection.head < prefix.from || selection.head > visibleContentFrom) return null

  if (!forward) {
    if (indentation.length > 0) {
      const removeCount = indentation.endsWith('\t') ? 1 : Math.min(2, indentation.length)
      const from = prefix.from + indentation.length - removeCount
      return {
        changes: { from, to: from + removeCount },
        selection: { anchor: visibleContentFrom - removeCount },
        scrollIntoView: true,
        userEvent: 'delete.backward',
      }
    }
    return {
      changes: { from: prefix.from, to: visibleContentFrom },
      selection: { anchor: prefix.from },
      scrollIntoView: true,
      userEvent: 'delete.backward',
    }
  }

  if (visibleContentFrom >= line.to) return null
  const content = state.doc.sliceString(visibleContentFrom, line.to)
  const to = visibleContentFrom + findClusterBreak(content, 0, true)
  return {
    changes: { from: visibleContentFrom, to },
    selection: { anchor: visibleContentFrom },
    scrollIntoView: true,
    userEvent: 'delete.forward',
  }
}

export function quoteLinePrefixes(state: EditorState, lineNumber: number): PreviewRange[] {
  const line = state.doc.line(lineNumber)
  const prefixes: PreviewRange[] = []
  let offset = 0
  while (offset < line.length) {
    const match = /^( {0,3})>[ \t]?/.exec(line.text.slice(offset))
    if (!match) break
    prefixes.push({ from: line.from + offset, to: line.from + offset + match[0].length })
    offset += match[0].length
  }
  return prefixes
}

/** Rich-text deletion semantics for one or more hidden blockquote prefixes. */
export function quoteBoundaryDeletion(
  state: EditorState,
  forward: boolean,
): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  if (!selection.empty) return null
  const line = state.doc.lineAt(selection.head)
  const prefixes = quoteLinePrefixes(state, line.number)
  const last = prefixes.at(-1)
  if (!last || selection.head < line.from || selection.head > last.to) return null

  if (!forward) {
    return {
      changes: last,
      selection: { anchor: last.from },
      scrollIntoView: true,
      userEvent: 'delete.backward',
    }
  }
  if (last.to >= line.to) return null
  const content = state.doc.sliceString(last.to, line.to)
  const to = last.to + findClusterBreak(content, 0, true)
  return {
    changes: { from: last.to, to },
    selection: { anchor: last.to },
    scrollIntoView: true,
    userEvent: 'delete.forward',
  }
}

/**
 * Backspace/Delete at a position that touches a *hidden* (not widget-owned)
 * range: try the heading/list/quote boundary commands first, then fall back
 * to removing a thematic break (HR) as one atomic unit, or — for any other
 * hidden touch this engine does not have a dedicated command for — simply
 * consume the key so CM6's default atomic-aware deletion cannot leave the
 * caret in an inconsistent spot. `hiddenRangesNear` is supplied by the
 * feature registering hidden ranges (see `livePreview.ts`), since only it
 * knows the concrete Markdown-construct-to-range mapping.
 */
export function deleteAtHiddenBoundary(
  view: EditorView,
  forward: boolean,
  hiddenRangesNear: (state: EditorState, from: number, to: number) => Iterable<PreviewRange>,
): boolean {
  if (view.state.readOnly) return false
  const heading = headingBoundaryDeletion(view.state, forward)
  if (heading) {
    view.dispatch(heading)
    return true
  }
  const list = listBoundaryDeletion(view.state, forward)
  if (list) {
    view.dispatch(list)
    return true
  }
  const quote = quoteBoundaryDeletion(view.state, forward)
  if (quote) {
    view.dispatch(quote)
    return true
  }

  const selection = view.state.selection.main
  if (!selection.empty) return false
  const position = selection.head
  const probeFrom = Math.max(0, position - 1)
  const probeTo = Math.min(view.state.doc.length, position + 1)

  let touches = false
  let horizontalRule: PreviewRange | null = null
  for (const range of hiddenRangesNear(view.state, probeFrom, probeTo)) {
    const touchesPosition =
      (forward && range.from === position) ||
      (!forward && range.to === position) ||
      (range.from < position && position < range.to)
    if (!touchesPosition) continue
    touches = true
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name === 'HorizontalRule' && node.from === range.from && node.to === range.to) {
          horizontalRule = { from: range.from, to: range.to }
          return false
        }
      },
    })
  }

  if (horizontalRule) {
    const { from, to } = horizontalRule
    view.dispatch({
      changes: { from, to },
      selection: { anchor: from },
      scrollIntoView: true,
      userEvent: forward ? 'delete.forward' : 'delete.backward',
    })
    return true
  }
  return touches
}
