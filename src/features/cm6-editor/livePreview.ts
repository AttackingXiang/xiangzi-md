import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import {
  EditorSelection,
  EditorState,
  findClusterBreak,
  Prec,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
  type Extension,
} from '@codemirror/state'
import { keymap } from '@codemirror/view'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  partiallyDeletesFencedCodeFence,
  protectsEmptyFencedCodeBodyDeletion,
  restoreEmptyFencedCodeBody,
} from './codeBlockPreview'
import { decodeMarkdownDestination, resolveMarkdownReference } from './markdownReferences'

export interface PreviewRange {
  from: number
  to: number
}

export interface LivePreviewOptions {
  /** Extra source characters parsed around each viewport boundary. */
  viewportMargin?: number
}

export interface VisualGapEdit {
  anchor: number
}

export type BlankLineKind = 'structural' | 'explicit' | null

const setEditableBlank = StateEffect.define<number | null>()

/**
 * A blank line created by Enter is an editor paragraph until the caret leaves
 * it. The marker is UI state only: the authoritative Markdown is untouched.
 */
export const editableBlankParagraph = StateField.define<number | null>({
  create: () => null,
  update(value, transaction) {
    value = value === null ? null : transaction.changes.mapPos(value)
    if (value === null && transaction.docChanged && transaction.isUserEvent('input')) {
      let insertedLineBreak = false
      transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
        if (inserted.toString().includes('\n')) insertedLineBreak = true
      })
      if (insertedLineBreak && transaction.state.selection.main.empty) {
        const line = transaction.state.doc.lineAt(transaction.state.selection.main.head)
        if (line.length === 0) value = line.from
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(setEditableBlank)) value = effect.value
    }
    if (value !== null) {
      const line = transaction.state.doc.lineAt(Math.min(value, transaction.state.doc.length))
      if (line.length !== 0 || transaction.state.selection.main.head !== line.from) return null
      return line.from
    }
    return null
  },
})

function editableBlankAt(state: EditorState): number | null {
  return state.field(editableBlankParagraph, false) ?? null
}

function topLevelBlockAt(
  state: EditorState,
  position: number,
  bias: -1 | 1,
): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, bias)
  while (node && node.name !== 'Document') {
    if (
      node.parent?.name === 'Document' &&
      (node.name === 'Paragraph' || HEADING_NAMES.has(node.name))
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
 * Classify a *run* of blank source lines like a ProseMirror document model.
 * One blank line between two blocks is syntax only; extra blank lines are an
 * explicit authorial gap and must remain a selectable editor row.
 */
export function blankLineKind(state: EditorState, lineNumber: number): BlankLineKind {
  if (lineNumber < 1 || lineNumber > state.doc.lines) return null
  const line = state.doc.line(lineNumber)
  if (line.text.trim().length !== 0) return null
  if (editableBlankAt(state) === line.from) return 'explicit'

  const probe = Math.min(line.from, Math.max(0, state.doc.length - 1))
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(probe, 1)
  while (node && node.name !== 'Document') {
    // Blank lines inside literal/container blocks belong to that block.
    if (['FencedCode', 'CodeBlock', 'HTMLBlock'].includes(node.name)) return 'explicit'
    node = node.parent
  }

  let runStart = lineNumber
  let runEnd = lineNumber
  while (runStart > 1 && state.doc.line(runStart - 1).text.trim().length === 0) runStart -= 1
  while (runEnd < state.doc.lines && state.doc.line(runEnd + 1).text.trim().length === 0)
    runEnd += 1

  // A leading/trailing empty line represents an editable empty paragraph. A
  // run only has a structural delimiter when it actually separates two blocks.
  if (runStart === 1 || runEnd === state.doc.lines) return 'explicit'
  return lineNumber === runStart ? 'structural' : 'explicit'
}

/** A source-only structural line that must not become a rendered editor row. */
export function isBlockSeparatorLine(state: EditorState, lineNumber: number): boolean {
  if (lineNumber < 1 || lineNumber > state.doc.lines) return false
  const line = state.doc.line(lineNumber)
  if (line.text.trim().length === 0) return blankLineKind(state, lineNumber) === 'structural'

  let structuralMarker = false
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (
        node.name === 'HeaderMark' &&
        node.from === line.from &&
        node.to === line.to &&
        node.node.parent?.name.startsWith('SetextHeading')
      ) {
        structuralMarker = true
        return false
      }
      if (node.name === 'LinkReference' && node.from <= line.from && node.to >= line.to) {
        structuralMarker = true
        return false
      }
    },
  })
  return structuralMarker
}

/**
 * Map a click in layout-only space back to the authoritative Markdown source.
 *
 * Block widgets have CSS margins that do not correspond to a document position.
 * Only reuse a real empty Markdown line. A click must never dirty the document
 * merely because CSS creates visual spacing between two rendered blocks.
 */
export function visualGapEdit(state: EditorState, position: number): VisualGapEdit | null {
  const line = state.doc.lineAt(Math.max(0, Math.min(position, state.doc.length)))
  for (const number of [line.number, line.number - 1, line.number + 1]) {
    if (number < 1 || number > state.doc.lines) continue
    const candidate = state.doc.line(number)
    if (blankLineKind(state, number) === 'explicit') return { anchor: candidate.from }
  }

  return null
}

/**
 * ProseMirror-style Enter for a top-level text block: split the block, rather
 * than adding a source-only soft line. Markdown serializes the two blocks with
 * exactly one structural blank line (`\n\n`).
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
  if (selection.empty && head === line.to && line.to < state.doc.length && state.doc.sliceString(head, head + 1) === '\n') {
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
  list:
    | {
        from: number
        to: number
        indentation: string
        marker: string
        task: boolean
      }
    | null
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
  const listMatch = /^(\s*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(
    line.text.slice(offset),
  )
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

/**
 * Delete an explicit empty paragraph as one ProseMirror block. Without this,
 * source-level Backspace can leave the caret on the preceding collapsed
 * structural delimiter after removing a newline character.
 */
export function explicitBlankParagraphDeletion(
  state: EditorState,
  forward: boolean,
): TransactionSpec | null {
  if (state.readOnly) return null
  const selection = state.selection.main
  if (!selection.empty) return null
  const line = state.doc.lineAt(selection.head)
  if (
    selection.head !== line.from ||
    line.text.length !== 0 ||
    blankLineKind(state, line.number) !== 'explicit'
  )
    return null

  if (forward) {
    if (line.from >= state.doc.length || state.doc.sliceString(line.from, line.from + 1) !== '\n')
      return null
    return {
      changes: { from: line.from, to: line.from + 1 },
      selection: { anchor: line.from },
      scrollIntoView: true,
      userEvent: 'delete.forward',
    }
  }

  if (line.from === 0) return null
  // A trailing empty paragraph is encoded by two terminal newlines. Removing
  // it restores the preceding block exactly, rather than leaving one stray
  // source newline behind.
  const isOnlyTrailingEmptyParagraph =
    line.from + 1 === state.doc.length &&
    state.doc.sliceString(line.from - 1, line.from + 1) === '\n\n'
  if (isOnlyTrailingEmptyParagraph) {
    return {
      changes: { from: line.from - 1, to: line.from + 1 },
      selection: { anchor: line.from - 1 },
      scrollIntoView: true,
      userEvent: 'delete.backward',
    }
  }
  return {
    changes: { from: line.from - 1, to: line.from },
    selection: { anchor: line.from },
    scrollIntoView: true,
    userEvent: 'delete.backward',
  }
}

const HEADING_NAMES = new Map([
  ['ATXHeading1', 1],
  ['ATXHeading2', 2],
  ['ATXHeading3', 3],
  ['ATXHeading4', 4],
  ['ATXHeading5', 5],
  ['ATXHeading6', 6],
  ['SetextHeading1', 1],
  ['SetextHeading2', 2],
])

const MARKER_NAMES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'StrikethroughMark',
  'CodeMark',
  'LinkMark',
  'QuoteMark',
])

const INLINE_CLASSES: Readonly<Record<string, string>> = {
  StrongEmphasis: 'xmd-cm-strong',
  Emphasis: 'xmd-cm-emphasis',
  Strikethrough: 'xmd-cm-strikethrough',
  InlineCode: 'xmd-cm-inline-code',
}

const CALLOUT_KINDS = new Set(['NOTE', 'TIP', 'WARNING', 'IMPORTANT', 'CAUTION'])

interface CalloutStart {
  kind: string
  markerFrom: number
  markerTo: number
}

/** GitHub/Obsidian-style alert header at the start of a quote line. */
function calloutStartAtLine(state: EditorState, lineNumber: number): CalloutStart | null {
  const line = state.doc.line(lineNumber)
  const prefix = /^(?: {0,3}>[ \t]?)+/.exec(line.text)?.[0]
  if (!prefix) return null
  const match = /^\[!([A-Za-z]+)\][ \t]*/.exec(line.text.slice(prefix.length))
  if (!match) return null
  const kind = match[1].toUpperCase()
  if (!CALLOUT_KINDS.has(kind)) return null
  return {
    kind,
    markerFrom: line.from + prefix.length,
    markerTo: line.from + prefix.length + match[0].length,
  }
}

class CalloutLabelWidget extends WidgetType {
  constructor(readonly kind: string) {
    super()
  }

  eq(other: CalloutLabelWidget): boolean {
    return other.kind === this.kind
  }

  toDOM(): HTMLElement {
    const label = document.createElement('span')
    label.className = `xmd-cm-callout-label xmd-cm-callout-${this.kind.toLowerCase()}`
    label.textContent = this.kind
    return label
  }

  ignoreEvent(): boolean {
    return false
  }
}

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

interface ListLinePrefix {
  from: number
  to: number
  marker: string
  indentation: string
  task: boolean
  visibleContentFrom: number
}

function listLinePrefix(state: EditorState, node: SyntaxNode): ListLinePrefix | null {
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

function markdownConstruct(state: EditorState, node: SyntaxNode): MarkdownConstruct | null {
  if (HEADING_NAMES.has(node.name)) {
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
    const link = markdownLinkData(state, node)
    return link
      ? { from: node.from, to: node.to, contentFrom: link.labelFrom, contentTo: link.labelTo, node }
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
    ? {
        from: node.from,
        to: node.to,
        contentFrom: firstMarkerTo,
        contentTo: lastMarkerFrom,
        node,
      }
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
 * empties its visible content. The construct is read from the pre-change tree,
 * because strings such as `****` stop being parsed as emphasis immediately.
 */
export function cleanupEmptyMarkdownFormatting(transaction: Transaction): TransactionSpec | null {
  if (!transaction.docChanged || !transaction.isUserEvent('delete')) return null

  const deleted: PreviewRange[] = []
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA) deleted.push({ from: fromA, to: toA })
  })
  if (deleted.length === 0) return null

  const cleanup: PreviewRange[] = []
  let emptiedHeadingAt: number | null = null
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
      if (HEADING_NAMES.has(construct.node.name)) {
        emptiedHeadingAt = transaction.changes.mapPos(construct.from, 1)
      }
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
    effects: emptiedHeadingAt === null ? undefined : setEditableBlank.of(emptiedHeadingAt),
    sequential: true,
  }
}

/**
 * Give the visual left edge of an ATX heading ordinary rich-text semantics.
 * The caret may be placed on either side of the atomic, hidden `# ` prefix.
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
    // Mirror ProseMirror's joinBackward priority: an empty block immediately
    // before a heading is removed first. Only when there is no predecessor to
    // join through do we lower the heading to a paragraph.
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
      effects: contentFrom === line.to ? setEditableBlank.of(line.from) : undefined,
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

function quoteLinePrefixes(state: EditorState, lineNumber: number): PreviewRange[] {
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
      effects:
        prefixes.length === 1 && last.to === line.to ? setEditableBlank.of(line.from) : undefined,
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

function hiddenMarkerRange(state: EditorState, node: SyntaxNode): PreviewRange {
  if (!['HeaderMark', 'QuoteMark'].includes(node.name)) return { from: node.from, to: node.to }
  const line = state.doc.lineAt(node.to)
  const whitespace =
    node.name === 'HeaderMark'
      ? (/^[ \t]+/.exec(state.doc.sliceString(node.to, line.to))?.[0].length ?? 0)
      : (/^[ \t]/.exec(state.doc.sliceString(node.to, line.to))?.[0].length ?? 0)
  return { from: node.from, to: node.to + whitespace }
}

export function safeMarkdownLinkHref(href: string): string | null {
  const normalized = href.trim()
  if (!normalized || /[\u0000-\u001f\u007f\\]/.test(normalized)) return null
  if (normalized.startsWith('//')) return null

  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase()
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return null
  return normalized
}

function markdownLinkData(
  state: EditorState,
  node: SyntaxNode,
): { labelFrom: number; labelTo: number; href: string; hidden: PreviewRange[] } | null {
  if (node.name === 'URL') {
    const text = state.doc.sliceString(node.from, node.to)
    const detectedHref = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
      ? `mailto:${text}`
      : /^www\./i.test(text)
        ? `https://${text}`
        : text
    const safeHref = safeMarkdownLinkHref(detectedHref)
    return safeHref ? { labelFrom: node.from, labelTo: node.to, href: safeHref, hidden: [] } : null
  }

  const marks: SyntaxNode[] = []
  let urlNode: SyntaxNode | null = null
  let labelNode: SyntaxNode | null = null
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'LinkMark') marks.push(child)
    if (child.name === 'URL') urlNode = child
    if (child.name === 'LinkLabel') labelNode = child
  }
  if (node.name === 'Autolink') {
    if (!urlNode) return null
    const text = state.doc.sliceString(urlNode.from, urlNode.to)
    const href = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? `mailto:${text}` : text
    const safeHref = safeMarkdownLinkHref(href)
    return safeHref
      ? {
          labelFrom: urlNode.from,
          labelTo: urlNode.to,
          href: safeHref,
          hidden: [
            { from: node.from, to: urlNode.from },
            { from: urlNode.to, to: node.to },
          ],
        }
      : null
  }
  if (node.name !== 'Link' || marks.length < 2) return null

  const labelFrom = marks[0].to
  const labelTo = marks[1].from
  const visibleLabel = state.doc.sliceString(labelFrom, labelTo)
  const explicitLabel = labelNode
    ? state.doc.sliceString(labelNode.from + 1, Math.max(labelNode.from + 1, labelNode.to - 1))
    : null
  const definition = urlNode ? null : resolveMarkdownReference(state, explicitLabel, visibleLabel)
  const href = urlNode
    ? decodeMarkdownDestination(state.doc.sliceString(urlNode.from, urlNode.to))
    : (definition?.destination ?? '')
  const safeHref = safeMarkdownLinkHref(href)
  return labelFrom >= 0 && labelTo >= labelFrom && safeHref
    ? {
        labelFrom,
        labelTo,
        href: safeHref,
        hidden: [
          { from: node.from, to: labelFrom },
          { from: labelTo, to: node.to },
        ],
      }
    : null
}

class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('span')
    element.className = `xmd-cm-task-checkbox${this.checked ? ' is-checked' : ''}`
    element.setAttribute('role', 'checkbox')
    element.setAttribute('aria-checked', String(this.checked))
    element.setAttribute('aria-label', this.checked ? '标记为未完成' : '标记为已完成')
    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (view.state.readOnly) return
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' },
      })
      view.focus()
    })
    return element
  }

  ignoreEvent(event: Event): boolean {
    return event.type === 'click'
  }
}

class ListMarkerWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly depth: number,
    readonly task: boolean,
  ) {
    super()
  }

  eq(other: ListMarkerWidget): boolean {
    return other.label === this.label && other.depth === this.depth && other.task === this.task
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = `xmd-cm-list-marker${this.task ? ' is-task' : ''}`
    element.style.setProperty('--xmd-list-depth', String(this.depth))
    element.setAttribute('aria-hidden', 'true')
    element.textContent = this.label
    return element
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'xmd-cm-horizontal-rule-widget'
    element.setAttribute('role', 'separator')
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}

function expandedVisibleRanges(
  state: EditorState,
  ranges: readonly PreviewRange[],
  margin: number,
): PreviewRange[] {
  const expanded = ranges
    .map(({ from, to }) => ({
      from: Math.max(0, from - margin),
      to: Math.min(state.doc.length, to + margin),
    }))
    .sort((a, b) => a.from - b.from)
  const merged: PreviewRange[] = []
  for (const range of expanded) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else merged.push(range)
  }
  return merged
}

/**
 * Builds decorations only for the supplied viewport ranges. This function is
 * exported separately so range/selection behaviour can be unit tested without
 * constructing an EditorView.
 */
export function buildLivePreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: LivePreviewOptions = {},
): DecorationSet {
  const ranges: Array<ReturnType<Decoration['range']>> = []
  const margin = Math.max(0, options.viewportMargin ?? 256)
  const decoratedEmptyLines = new Set<number>()
  const editableFrom = editableBlankAt(state)
  const editableLine = editableFrom === null ? null : state.doc.lineAt(editableFrom)
  const paragraphBeforeEditable =
    editableLine && editableLine.number > 1
      ? topLevelParagraphAt(state, state.doc.line(editableLine.number - 1).to, -1)
      : null
  const paragraphAfterEditable =
    editableLine && editableLine.number < state.doc.lines
      ? topLevelParagraphAt(state, state.doc.line(editableLine.number + 1).from, 1)
      : null

  for (const visible of expandedVisibleRanges(state, visibleRanges, margin)) {
    const quoteDepthByLine = new Map<number, number>()
    const firstLine = state.doc.lineAt(visible.from)
    const lastLine = state.doc.lineAt(visible.to)
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      const line = state.doc.line(number)
      if (editableLine?.from === line.from && !decoratedEmptyLines.has(line.from)) {
        decoratedEmptyLines.add(line.from)
        const first = paragraphBeforeEditable === null ? ' xmd-cm-paragraph-first' : ''
        const last = paragraphAfterEditable === null ? ' xmd-cm-paragraph-last' : ''
        ranges.push(Decoration.line({ class: `xmd-cm-paragraph${first}${last}` }).range(line.from))
        continue
      }
      if (!isBlockSeparatorLine(state, number) || decoratedEmptyLines.has(line.from)) continue
      decoratedEmptyLines.add(line.from)
      ranges.push(Decoration.line({ class: 'xmd-cm-block-separator' }).range(line.from))
    }

    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        // Fenced blocks are owned by the dedicated code-block preview extension.
        // Avoid overlapping replacement decorations when both extensions are used.
        if (node.name === 'FencedCode' || node.name === 'Table' || node.name === 'Image')
          return false
        if (node.name === 'LinkReference') return false

        if (node.name === 'Paragraph' && node.node.parent?.name === 'Document') {
          const firstLine = state.doc.lineAt(node.from)
          const lastLine = state.doc.lineAt(node.to)
          for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
            const joinsEditableAfter =
              paragraphBeforeEditable?.from === node.from && paragraphBeforeEditable.to === node.to
            const joinsEditableBefore =
              paragraphAfterEditable?.from === node.from && paragraphAfterEditable.to === node.to
            const isFirst = lineNumber === firstLine.number && !joinsEditableBefore
            const isLast = lineNumber === lastLine.number && !joinsEditableAfter
            const edge =
              isFirst && isLast
                ? ' xmd-cm-paragraph-first xmd-cm-paragraph-last'
                : isFirst
                  ? ' xmd-cm-paragraph-first'
                  : isLast
                    ? ' xmd-cm-paragraph-last'
                    : ''
            ranges.push(
              Decoration.line({ class: `xmd-cm-paragraph${edge}` }).range(
                state.doc.line(lineNumber).from,
              ),
            )
          }
        }

        if (node.name === 'HorizontalRule') {
          const line = state.doc.lineAt(node.from)
          ranges.push(Decoration.line({ class: 'xmd-cm-horizontal-rule' }).range(line.from))
          ranges.push(
            Decoration.replace({ widget: new HorizontalRuleWidget() }).range(node.from, node.to),
          )
          return false
        }

        if (node.name === 'ListMark') {
          const prefix = listLinePrefix(state, node.node)
          if (prefix) {
            const indentation = prefix.indentation.replace(/\t/g, '  ').length
            const depth = Math.max(0, Math.floor(indentation / 2))
            const label = prefix.task ? '' : /^\d/.test(prefix.marker) ? prefix.marker : '•'
            ranges.push(
              Decoration.line({ class: 'xmd-cm-list-line' }).range(
                state.doc.lineAt(node.from).from,
              ),
              Decoration.replace({
                widget: new ListMarkerWidget(label, depth, prefix.task),
              }).range(prefix.from, prefix.to),
            )
          }
        }

        const headingLevel = HEADING_NAMES.get(node.name)
        if (headingLevel) {
          const line = state.doc.lineAt(node.from)
          ranges.push(
            Decoration.line({ class: `xmd-cm-heading xmd-cm-heading-${headingLevel}` }).range(
              line.from,
            ),
          )
        }

        const inlineClass = INLINE_CLASSES[node.name]
        if (inlineClass) {
          ranges.push(Decoration.mark({ class: inlineClass }).range(node.from, node.to))
        }

        if (node.name === 'Blockquote') {
          // A quote may span the full document. Clamp line decorations to the
          // viewport so an ancestor node cannot accidentally create O(doc) DOM state.
          const firstLine = state.doc.lineAt(Math.max(node.from, visible.from))
          const lastLine = state.doc.lineAt(Math.min(node.to, visible.to))
          for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
            const lineFrom = state.doc.line(lineNumber).from
            quoteDepthByLine.set(
              lineFrom,
              Math.max(
                quoteDepthByLine.get(lineFrom) ?? 0,
                quoteLinePrefixes(state, lineNumber).length,
              ),
            )
          }
        }

        if (
          node.name === 'Link' ||
          node.name === 'Autolink' ||
          (node.name === 'URL' && !['Link', 'Autolink'].includes(node.node.parent?.name ?? ''))
        ) {
          const link = markdownLinkData(state, node.node)
          if (link) {
            ranges.push(
              Decoration.mark({
                class: 'xmd-cm-link',
                attributes: {
                  'data-xmd-href': link.href,
                  role: 'link',
                  'aria-label': `打开链接 ${link.href}`,
                },
              }).range(link.labelFrom, link.labelTo),
            )
            for (const hidden of link.hidden) {
              if (hidden.to > hidden.from) {
                ranges.push(Decoration.replace({}).range(hidden.from, hidden.to))
              }
            }
          }
        }

        if (node.name === 'TaskMarker') {
          const marker = state.doc.sliceString(node.from, node.to).toLowerCase()
          ranges.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(marker === '[x]', node.from, node.to),
            }).range(node.from, node.to),
          )
        } else if (node.name === 'HardBreak') {
          // Our hard-break command writes `\\\n`; keep the semantic newline but
          // hide its source backslash in live preview.
          ranges.push(Decoration.replace({}).range(node.from, node.from + 1))
        } else if (
          MARKER_NAMES.has(node.name) &&
          !['Link', 'Autolink'].includes(node.node.parent?.name ?? '')
        ) {
          const marker = hiddenMarkerRange(state, node.node)
          ranges.push(Decoration.replace({}).range(marker.from, marker.to))
        }
      },
    })
    // Alerts are a Markdown convention layered on blockquotes, not a core
    // CommonMark node. Decorate them line-by-line so they remain fully
    // editable and work in a viewport-rendered document.
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      const alert = calloutStartAtLine(state, number)
      if (!alert) continue
      const line = state.doc.line(number)
      ranges.push(
        Decoration.line({ class: `xmd-cm-callout xmd-cm-callout-${alert.kind.toLowerCase()}` }).range(
          line.from,
        ),
        Decoration.replace({ widget: new CalloutLabelWidget(alert.kind) }).range(
          alert.markerFrom,
          alert.markerTo,
        ),
      )
    }
    for (const [lineFrom, depth] of quoteDepthByLine) {
      ranges.push(
        Decoration.line({
          class: 'xmd-cm-blockquote',
          attributes: { style: `--xmd-quote-depth:${Math.max(1, depth)}` },
        }).range(lineFrom),
      )
    }
  }

  return Decoration.set(ranges, true)
}

/**
 * Hidden Markdown source must also be atomic. Replacement decorations only
 * affect painting; without atomic ranges the selection can still enter their
 * source positions and Backspace/Delete can remove half of a marker.
 */
export function buildHiddenMarkdownMarkerRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: LivePreviewOptions = {},
): DecorationSet {
  const hidden: Array<ReturnType<Decoration['range']>> = []
  const margin = Math.max(0, options.viewportMargin ?? 256)

  for (const visible of expandedVisibleRanges(state, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name === 'FencedCode' || node.name === 'Table' || node.name === 'Image')
          return false
        if (node.name === 'LinkReference') {
          hidden.push(Decoration.replace({}).range(node.from, node.to))
          return false
        }
        if (node.name === 'Link' || node.name === 'Autolink') {
          const link = markdownLinkData(state, node.node)
          if (link) {
            for (const range of link.hidden) {
              if (range.to > range.from) {
                hidden.push(Decoration.replace({}).range(range.from, range.to))
              }
            }
          }
        }
        if (
          node.name === 'HorizontalRule' ||
          node.name === 'ListMark' ||
          node.name === 'TaskMarker' ||
          (MARKER_NAMES.has(node.name) &&
            !['Link', 'Autolink'].includes(node.node.parent?.name ?? ''))
        ) {
          const listPrefix = node.name === 'ListMark' ? listLinePrefix(state, node.node) : null
          const marker = listPrefix ?? hiddenMarkerRange(state, node.node)
          hidden.push(Decoration.replace({}).range(marker.from, marker.to))
        }
        if (node.name === 'HardBreak') {
          hidden.push(Decoration.replace({}).range(node.from, node.from + 1))
        }
      },
    })
    const firstLine = state.doc.lineAt(visible.from)
    const lastLine = state.doc.lineAt(visible.to)
    for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
      const alert = calloutStartAtLine(state, lineNumber)
      if (alert) hidden.push(Decoration.replace({}).range(alert.markerFrom, alert.markerTo))
    }
  }

  return Decoration.set(hidden, true)
}

/** CM6 live-preview extension. The Markdown language extension is supplied by the caller. */
export function markdownLivePreview(options: LivePreviewOptions = {}): Extension {
  const preview = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      atomicRanges: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view.state, view.visibleRanges, options)
        this.atomicRanges = buildHiddenMarkdownMarkerRanges(view.state, view.visibleRanges, options)
      }

      update(update: ViewUpdate): void {
        const syntaxTreeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.geometryChanged ||
          syntaxTreeChanged
        ) {
          this.decorations = buildLivePreviewDecorations(
            update.state,
            update.view.visibleRanges,
            options,
          )
          this.atomicRanges = buildHiddenMarkdownMarkerRanges(
            update.state,
            update.view.visibleRanges,
            options,
          )
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none),
    },
  )
  const linkAtEvent = (event: Event, view: EditorView): HTMLElement | null => {
    const target = event.target
    if (!(target instanceof Element)) return null
    const link = target.closest<HTMLElement>('[data-xmd-href]')
    return link && view.dom.contains(link) ? link : null
  }
  const dispatchLink = (link: HTMLElement, view: EditorView): void => {
    const href = safeMarkdownLinkHref(link.dataset.xmdHref ?? '')
    if (!href) return
    view.dom.dispatchEvent(
      new CustomEvent('xmd-link-open', {
        bubbles: true,
        detail: { href },
      }),
    )
  }

  const deleteTouchesHiddenMarker = (view: EditorView, forward: boolean): boolean => {
    if (view.state.readOnly) return false
    const headingDeletion = headingBoundaryDeletion(view.state, forward)
    if (headingDeletion) {
      view.dispatch(headingDeletion)
      return true
    }
    const listDeletion = listBoundaryDeletion(view.state, forward)
    if (listDeletion) {
      view.dispatch(listDeletion)
      return true
    }
    const quoteDeletion = quoteBoundaryDeletion(view.state, forward)
    if (quoteDeletion) {
      view.dispatch(quoteDeletion)
      return true
    }
    const selection = view.state.selection.main
    if (!selection.empty) return false
    const previewPlugin = view.plugin(preview)
    if (!previewPlugin) return false
    const position = selection.head
    let touches = false
    let horizontalRule: PreviewRange | null = null
    previewPlugin.atomicRanges.between(
      Math.max(0, position - 1),
      Math.min(view.state.doc.length, position + 1),
      (from, to) => {
        if (
          (forward && from === position) ||
          (!forward && to === position) ||
          (from < position && position < to)
        ) {
          touches = true
          syntaxTree(view.state).iterate({
            from,
            to,
            enter(node) {
              if (node.name === 'HorizontalRule' && node.from === from && node.to === to) {
                horizontalRule = { from, to }
                return false
              }
            },
          })
        }
      },
    )
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

  const isLayoutGap = (event: MouseEvent, view: EditorView): boolean => {
    const target = event.target
    if (!(target instanceof Element) || target !== view.contentDOM) return false

    const y = event.clientY
    const children = Array.from(view.contentDOM.children)
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.height > 0)
    const before = children.filter((rect) => rect.bottom <= y).at(-1)
    const after = children.find((rect) => rect.top >= y)
    // Do not reinterpret ordinary line padding as an insertion request.
    return Boolean(before && after && after.top - before.bottom >= 4)
  }

  const linePositionAtPointer = (
    event: MouseEvent,
    view: EditorView,
    lineElement: HTMLElement,
  ): number => {
    const sourceLine = view.state.doc.lineAt(view.posAtDOM(lineElement, 0))
    const contentOffset = lineElement.classList.contains('xmd-cm-heading')
      ? (/^ {0,3}#{1,6}\s+/.exec(sourceLine.text)?.[0].length ?? 0)
      : 0
    const contentFrom = Math.min(sourceLine.to, sourceLine.from + contentOffset)

    // DOM caret APIs preserve the character under the pointer even when CM6 has
    // replacement decorations before it. posAtCoords alone may otherwise snap
    // to the following block widget boundary.
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const caret = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY)
    const range = caret
      ? null
      : documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY)
    const node = caret?.offsetNode ?? range?.startContainer
    const offset = caret?.offset ?? range?.startOffset
    let position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    if (node && offset !== undefined && lineElement.contains(node)) {
      try {
        position = view.posAtDOM(node, offset)
      } catch {
        // A stale DOM text node can disappear during a decoration refresh; the
        // coordinate fallback below remains safe and is clamped to this heading.
      }
    }
    return Math.max(contentFrom, Math.min(sourceLine.to, position ?? contentFrom))
  }

  return [
    editableBlankParagraph,
    EditorState.transactionFilter.of((transaction) => {
      if (partiallyDeletesFencedCodeFence(transaction)) return []
      const cleanup = cleanupEmptyMarkdownFormatting(transaction)
      const codeBodyRepair = restoreEmptyFencedCodeBody(transaction)
      return cleanup || codeBodyRepair
        ? [transaction, ...(cleanup ? [cleanup] : []), ...(codeBodyRepair ? [codeBodyRepair] : [])]
        : transaction
    }),
    preview,
    Prec.high(
      keymap.of([
        {
          key: 'Backspace',
          run: (view) => {
            if (protectsEmptyFencedCodeBodyDeletion(view.state, false)) return true
            const join = joinContainerMarkdownBlock(view.state, false)
            if (join) {
              view.dispatch(join)
              return true
            }
            const deletion = explicitBlankParagraphDeletion(view.state, false)
            if (deletion) {
              view.dispatch(deletion)
              return true
            }
            return deleteTouchesHiddenMarker(view, false)
          },
        },
        {
          key: 'Delete',
          run: (view) => {
            if (protectsEmptyFencedCodeBodyDeletion(view.state, true)) return true
            const join = joinContainerMarkdownBlock(view.state, true)
            if (join) {
              view.dispatch(join)
              return true
            }
            const deletion = explicitBlankParagraphDeletion(view.state, true)
            if (deletion) {
              view.dispatch(deletion)
              return true
            }
            return deleteTouchesHiddenMarker(view, true)
          },
        },
        {
          key: 'Enter',
          run: (view) => {
            const split = splitContainerMarkdownBlock(view.state) ?? splitTopLevelMarkdownBlock(view.state)
            if (!split) return false
            view.dispatch(split)
            return true
          },
        },
        {
          key: 'Shift-Enter',
          run: (view) => {
            const hardBreak =
              insertContainerMarkdownHardBreak(view.state) ?? insertMarkdownHardBreak(view.state)
            if (!hardBreak) return false
            view.dispatch(hardBreak)
            return true
          },
        },
        ...(['ArrowUp', 'ArrowDown'] as const).map((key) => ({
          key,
          run(view: EditorView) {
            const selection = view.state.selection.main
            if (!selection.empty) return false
            const forward = key === 'ArrowDown'
            let target = view.moveVertically(selection, forward)
            if (!isBlockSeparatorLine(view.state, view.state.doc.lineAt(target.head).number)) {
              // Preserve CM6's native goal-column and visual-line behaviour when
              // no collapsed Markdown separator needs to be skipped.
              return false
            }
            let guard = 0
            while (
              target.head !== selection.head &&
              isBlockSeparatorLine(view.state, view.state.doc.lineAt(target.head).number) &&
              guard < view.state.doc.lines
            ) {
              const next = view.moveVertically(target, forward)
              if (next.head === target.head) break
              target = next
              guard += 1
            }
            if (target.head === selection.head) return false
            view.dispatch({
              selection: EditorSelection.create([target]),
              scrollIntoView: true,
              userEvent: 'select',
            })
            return true
          },
        })),
      ]),
    ),
    EditorView.domEventHandlers({
      blur(_event, view) {
        if (editableBlankAt(view.state) === null) return false
        view.dispatch({ effects: setEditableBlank.of(null) })
        return false
      },
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false
        if (!linkAtEvent(event, view)) return false
        event.preventDefault()
        return true
      },
      pointerdown(event, view) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return false
        const target = event.target
        if (target instanceof Element) {
          const emptyLine = target.closest<HTMLElement>('.cm-line')
          if (
            emptyLine?.parentElement === view.contentDOM &&
            (emptyLine.textContent ?? '').trim() === ''
          ) {
            const anchor = view.posAtDOM(emptyLine, 0)
            event.preventDefault()
            view.dispatch({ selection: { anchor }, scrollIntoView: true })
            view.focus()
            return true
          }
        }
        if (!isLayoutGap(event, view)) return false
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
        if (position === null) return false
        const edit = visualGapEdit(view.state, position)
        if (!edit) return false
        event.preventDefault()
        view.dispatch({ selection: { anchor: edit.anchor }, scrollIntoView: true })
        view.focus()
        return true
      },
      click(event, view) {
        if (event.button !== 0) return false
        if (event.metaKey || event.ctrlKey) {
          const link = linkAtEvent(event, view)
          if (!link) return false
          event.preventDefault()
          dispatchLink(link, view)
          return true
        }
        if (event.shiftKey || event.altKey || !view.state.selection.main.empty) return false
        const target = event.target
        if (!(target instanceof Element)) return false
        if (target.closest('button, input, select, textarea, [role="checkbox"]')) return false
        const line = target.closest<HTMLElement>('.cm-line')
        if (!line || line.parentElement !== view.contentDOM || line.textContent === '') return false
        // Fenced code is ordinary outer-CM6 content now. Native hit testing is
        // exact there; applying the legacy block-widget correction a second
        // time causes the caret to visibly jump before settling.
        if (line.classList.contains('xmd-cm-code-line')) return false
        // Native CM6 hit-testing is more accurate for ordinary paragraphs and
        // inline marks. Only headings need source-marker compensation.
        if (!line.classList.contains('xmd-cm-heading')) return false
        const anchor = linePositionAtPointer(event, view, line)
        if (view.state.selection.main.head === anchor) return false
        event.preventDefault()
        view.dispatch({ selection: { anchor }, scrollIntoView: true })
        view.focus()
        return true
      },
      keydown(event, view) {
        if (event.key !== 'Enter') return false
        const link = linkAtEvent(event, view)
        if (!link) return false
        event.preventDefault()
        dispatchLink(link, view)
        return true
      },
    }),
  ]
}
