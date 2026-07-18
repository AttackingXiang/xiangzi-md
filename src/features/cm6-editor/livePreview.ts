import { syntaxTree } from '@codemirror/language'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import { Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import {
  cleanupEmptyMarkdownFormatting,
  deleteAtHiddenBoundary,
  hiddenMarkerRange,
  insertContainerMarkdownHardBreak,
  insertMarkdownHardBreak,
  joinContainerMarkdownBlock,
  listLinePrefix,
  quoteLinePrefixes,
  splitContainerMarkdownBlock,
  splitTopLevelMarkdownBlock,
} from './core/boundaryCommands'
import { hiddenRangeSource, hiddenRangesEngine, type HiddenRange } from './core/hiddenRanges'
import { HEADING_NODE_NAMES } from './core/nodePolicy'
import {
  computeRevealedRanges,
  isRevealed,
  pointerSelectionActiveState,
  type RevealedRanges,
} from './core/revealState'
import { expandedVisibleRanges, rangesTouch, type PreviewRange } from './core/types'
import { markdownLinkData } from './markdownLinks'
import {
  CalloutLabelWidget,
  HorizontalRuleWidget,
  ListMarkerWidget,
  TaskCheckboxWidget,
  calloutStartAtLine,
} from './livePreviewWidgets'
import { livePreviewEventHandlers } from './livePreviewEvents'

export type { PreviewRange } from './core/types'
export { safeMarkdownLinkHref } from './markdownLinks'

export interface LivePreviewOptions {
  /** Extra source characters parsed around each viewport boundary. */
  viewportMargin?: number
}

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

interface InlineHtmlOpeningTag {
  from: number
  to: number
  name: 'font' | 'b' | 'strong'
  color?: string
}

interface InlineHtmlSpan extends InlineHtmlOpeningTag {
  closeFrom: number
  closeTo: number
}

/** Only values that cannot escape a single CSS color declaration are accepted. */
function safeInlineHtmlColor(value: string): string | null {
  const color = value.trim()
  if (/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(color)) return color
  if (/^[a-z]+$/i.test(color)) return color
  return null
}

function parseInlineHtmlTag(
  source: string,
): { closing: boolean; name: InlineHtmlOpeningTag['name']; color?: string } | null {
  const closing = /^<\s*\/\s*(font|b|strong)\s*>$/i.exec(source)
  if (closing) {
    return {
      closing: true,
      name: closing[1].toLowerCase() as InlineHtmlOpeningTag['name'],
    }
  }

  const opening = /^<\s*(font|b|strong)\b([^>]*)>$/i.exec(source)
  if (!opening || /\/\s*>$/.test(source)) return null
  const name = opening[1].toLowerCase() as InlineHtmlOpeningTag['name']
  if (name !== 'font') return { closing: false, name }

  const colorAttribute = /\bcolor\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(opening[2])
  const color = safeInlineHtmlColor(
    colorAttribute?.[1] ?? colorAttribute?.[2] ?? colorAttribute?.[3] ?? '',
  )
  return color ? { closing: false, name, color } : null
}

// `buildLivePreviewDecorations` and `collectHiddenRanges` both need the same
// inline-HTML span analysis for the same viewport range on every repaint —
// without memoization each does its own full `syntaxTree.iterate` pass.
// `inlineHtmlSpans` depends on nothing but `state.doc` and `syntaxTree(state)`,
// and a CM6 `EditorState` is immutable: a given instance's doc and syntax
// tree never change after construction, a new state is created for every
// edit. That makes memoizing by `state` object identity always safe — a
// cache hit can never observe a doc/tree that differs from the one the
// cached spans were computed against. The inner key is the requested
// `[from, to)` window so distinct probes (e.g. viewport paint vs. a
// single-character hidden-boundary probe) don't collide.
const inlineHtmlSpansCache = new WeakMap<EditorState, Map<string, InlineHtmlSpan[]>>()

function inlineHtmlSpans(state: EditorState, visible: PreviewRange): InlineHtmlSpan[] {
  let cacheForState = inlineHtmlSpansCache.get(state)
  const cacheKey = `${visible.from}:${visible.to}`
  const cached = cacheForState?.get(cacheKey)
  if (cached) return cached

  const spans: InlineHtmlSpan[] = []
  const stack: InlineHtmlOpeningTag[] = []
  // Hidden-boundary key commands query only one character around the caret.
  // Expand that probe to complete physical lines so an opening/closing tag
  // pair remains discoverable by the same parser used for viewport painting.
  const scanFrom = state.doc.lineAt(visible.from).from
  const scanTo = state.doc.lineAt(visible.to).to

  syntaxTree(state).iterate({
    from: scanFrom,
    to: scanTo,
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'Table' || node.name === 'Image') return false
      if (node.name !== 'HTMLTag') return

      const raw = state.doc.sliceString(node.from, node.to)
      // A hidden range may never cross a newline (core/README.md invariant 2).
      // A multi-line tag can't participate in a hidden span; skip it.
      if (raw.includes('\n')) return
      const tag = parseInlineHtmlTag(raw)
      if (!tag) return
      if (!tag.closing) {
        stack.push({ from: node.from, to: node.to, name: tag.name, color: tag.color })
        return
      }

      let openingIndex = stack.length - 1
      while (openingIndex >= 0 && stack[openingIndex]?.name !== tag.name) openingIndex -= 1
      if (openingIndex < 0) return
      const [opening] = stack.splice(openingIndex)
      if (!opening) return
      spans.push({ ...opening, closeFrom: node.from, closeTo: node.to })
    },
  })

  if (!cacheForState) {
    cacheForState = new Map()
    inlineHtmlSpansCache.set(state, cacheForState)
  }
  cacheForState.set(cacheKey, spans)
  return spans
}

/**
 * Builds decorations only for the supplied viewport ranges. This function is
 * exported separately so range/selection behaviour can be unit tested without
 * constructing an EditorView. It only paints *visible* content — line
 * classes, inline style marks and widgets. Hiding/atomicity for the source
 * markers those widgets replace is entirely the job of `collectHiddenRanges`
 * below, aggregated through `core/hiddenRanges.ts` so there is exactly one
 * place in the whole editor that decides what is hidden.
 */
export function buildLivePreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: LivePreviewOptions = {},
): DecorationSet {
  const ranges: Array<ReturnType<Decoration['range']>> = []
  const margin = Math.max(0, options.viewportMargin ?? 256)
  const revealed = computeRevealedRanges(state)

  for (const visible of expandedVisibleRanges(state.doc.length, visibleRanges, margin)) {
    const quoteDepthByLine = new Map<number, number>()
    const firstLine = state.doc.lineAt(visible.from)
    const lastLine = state.doc.lineAt(visible.to)

    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        // Fenced/table/image blocks are owned by their own preview extensions.
        // Avoid overlapping replacement decorations when both are used together.
        if (node.name === 'FencedCode' || node.name === 'Table' || node.name === 'Image')
          return false
        if (node.name === 'LinkReference') return false

        if (node.name === 'Paragraph' && node.node.parent?.name === 'Document') {
          const firstLine = state.doc.lineAt(node.from)
          const lastLine = state.doc.lineAt(node.to)
          // A blank line is now a real, full-height document row (see
          // core/README.md). Stacking the full edge padding on top of it
          // made a single Enter (one blank separator row) look as spaced as
          // a double Enter. When a genuine blank line already supplies the
          // gap, shrink the padding to a small rhythm nudge instead of
          // dropping it — an edge with no adjacent blank line (a paragraph
          // interrupted directly by a heading/list/HR/document boundary)
          // keeps the full padding since nothing else provides breathing
          // room there.
          const gapBefore =
            firstLine.number > 1 && state.doc.line(firstLine.number - 1).length === 0
          const gapAfter =
            lastLine.number < state.doc.lines && state.doc.line(lastLine.number + 1).length === 0
          for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
            const isFirst = lineNumber === firstLine.number
            const isLast = lineNumber === lastLine.number
            const classes = ['xmd-cm-paragraph']
            if (isFirst) classes.push('xmd-cm-paragraph-first')
            if (isLast) classes.push('xmd-cm-paragraph-last')
            if (isFirst && gapBefore) classes.push('xmd-cm-paragraph-gap-before')
            if (isLast && gapAfter) classes.push('xmd-cm-paragraph-gap-after')
            ranges.push(
              Decoration.line({ class: classes.join(' ') }).range(state.doc.line(lineNumber).from),
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
            const hangingIndent = Number((depth * 1.35 + (prefix.task ? 1.36 : 1.75)).toFixed(2))
            ranges.push(
              Decoration.line({
                class: 'xmd-cm-list-line',
                attributes: {
                  // `--xmd-list-depth` is not set here: the only consumer,
                  // `.xmd-cm-list-marker` in livePreview.css, reads the copy
                  // `ListMarkerWidget` sets on its own element (see
                  // livePreviewWidgets.ts), which shadows any value
                  // inherited from this line. Setting it here would be dead.
                  style: `--xmd-list-hang:${hangingIndent}em`,
                },
              }).range(state.doc.lineAt(node.from).from),
              Decoration.replace({
                widget: new ListMarkerWidget(label, depth, prefix.task),
              }).range(prefix.from, prefix.to),
            )
          }
        }

        const headingLevel = HEADING_NODE_NAMES.get(node.name)
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
                  // A rendered link behaves like a normal hyperlink. Once the
                  // caret enters its Markdown source, plain clicks must remain
                  // available for editing instead of unexpectedly navigating.
                  'data-xmd-editing': String(isRevealed(revealed, node.from, node.to)),
                  role: 'link',
                  'aria-label': `打开链接 ${link.href}`,
                },
              }).range(link.labelFrom, link.labelTo),
            )
          }
        }

        if (node.name === 'TaskMarker') {
          const marker = state.doc.sliceString(node.from, node.to).toLowerCase()
          ranges.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(marker === '[x]', node.from, node.to),
            }).range(node.from, node.to),
          )
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
        Decoration.line({
          class: `xmd-cm-callout xmd-cm-callout-${alert.kind.toLowerCase()}`,
        }).range(line.from),
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
    for (const span of inlineHtmlSpans(state, visible)) {
      if (span.closeFrom <= span.to) continue
      ranges.push(
        Decoration.mark(
          span.name === 'font'
            ? {
                class: 'xmd-cm-inline-color',
                attributes: { style: `color:${span.color ?? ''}` },
              }
            : { class: 'xmd-cm-strong' },
        ).range(span.to, span.closeFrom),
      )
    }
  }

  return Decoration.set(ranges, true)
}

/**
 * Whether a collapsed caret touches `[from, to)` — reuses `rangesTouch` from
 * `core/types.ts`, including its boundary semantics. Non-empty selections keep
 * inline HTML rendered so showing tags cannot change line geometry mid-drag.
 * Inline HTML spans are discovered by hand rather than by `revealState`, so
 * they need this parallel caret check.
 */
function caretTouchesRange(state: EditorState, range: PreviewRange): boolean {
  if (state.field(pointerSelectionActiveState, false)) return false
  return state.selection.ranges.some(
    (selectionRange) =>
      selectionRange.empty &&
      rangesTouch({ from: selectionRange.from, to: selectionRange.to }, range),
  )
}

/** Split a node's range into per-line pieces so no hidden range crosses a newline. */
function perLineRanges(state: EditorState, from: number, to: number): PreviewRange[] {
  const pieces: PreviewRange[] = []
  const firstLine = state.doc.lineAt(from)
  const lastLine = state.doc.lineAt(to)
  for (let number = firstLine.number; number <= lastLine.number; number += 1) {
    const line = state.doc.line(number)
    const pieceFrom = Math.max(from, line.from)
    const pieceTo = Math.min(to, line.to)
    if (pieceTo > pieceFrom) pieces.push({ from: pieceFrom, to: pieceTo })
  }
  return pieces
}

/**
 * The single source of hidden/atomic ranges this feature contributes to the
 * core engine (`core/hiddenRanges.ts`). Every range here becomes atomic;
 * ranges with `paint !== false` are additionally painted invisible by core.
 * Ranges the feature paints itself (list markers, task checkboxes, HR,
 * callout labels — see `buildLivePreviewDecorations` above) are contributed
 * with `paint: false` so core does not double-paint them.
 */
function collectHiddenRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  revealed: RevealedRanges,
  options: LivePreviewOptions = {},
): HiddenRange[] {
  const hidden: HiddenRange[] = []
  const margin = Math.max(0, options.viewportMargin ?? 256)

  for (const visible of expandedVisibleRanges(state.doc.length, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name === 'FencedCode' || node.name === 'Table' || node.name === 'Image')
          return false

        if (node.name === 'LinkReference') {
          for (const piece of perLineRanges(state, node.from, node.to))
            hidden.push({ ...piece, paint: true })
          return false
        }

        if (node.name === 'Link' || node.name === 'Autolink') {
          const link = markdownLinkData(state, node.node)
          if (link && !isRevealed(revealed, node.from, node.to)) {
            for (const range of link.hidden) {
              if (range.to > range.from) hidden.push({ ...range, paint: true })
            }
          }
          return
        }

        if (node.name === 'HorizontalRule') {
          hidden.push({ from: node.from, to: node.to, paint: false })
          return false
        }

        if (node.name === 'ListMark') {
          const prefix = listLinePrefix(state, node.node)
          if (prefix) hidden.push({ from: prefix.from, to: prefix.to, paint: false })
          return
        }

        if (node.name === 'TaskMarker') {
          hidden.push({ from: node.from, to: node.to, paint: false })
          return
        }

        // Heading `#`/underline markers and blockquote `>` prefixes are never
        // revealed (see core/nodePolicy.ts: 'always-hidden' and 'widget').
        // Inline emphasis/code markers reveal with their parent construct.
        if (node.name === 'HeaderMark' || node.name === 'QuoteMark') {
          hidden.push({ ...hiddenMarkerRange(state, node.node), paint: true })
        } else if (
          MARKER_NAMES.has(node.name) &&
          !['Link', 'Autolink'].includes(node.node.parent?.name ?? '')
        ) {
          const parent = node.node.parent
          if (!parent || !isRevealed(revealed, parent.from, parent.to)) {
            hidden.push({ from: node.from, to: node.to, paint: true })
          }
        }

        if (node.name === 'HardBreak') {
          // Our hard-break command writes `\\\n`; keep the semantic newline
          // but hide its source backslash in live preview.
          hidden.push({ from: node.from, to: node.from + 1, paint: true })
        }
      },
    })
    for (const span of inlineHtmlSpans(state, visible)) {
      // Obsidian semantics, same as `**bold**` via `isRevealed` elsewhere in
      // this function: when a collapsed caret touches the whole span (open tag
      // through close tag), reveal both tags together. A non-empty selection
      // keeps them hidden so dragging never changes line geometry. Boundary
      // carets must still reveal them to avoid an unrecoverable Backspace key.
      if (caretTouchesRange(state, { from: span.from, to: span.closeTo })) continue
      hidden.push(
        { from: span.from, to: span.to, paint: true },
        { from: span.closeFrom, to: span.closeTo, paint: true },
      )
    }
    const firstLine = state.doc.lineAt(visible.from)
    const lastLine = state.doc.lineAt(visible.to)
    for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
      const alert = calloutStartAtLine(state, lineNumber)
      if (alert) hidden.push({ from: alert.markerFrom, to: alert.markerTo, paint: false })
    }
  }

  return hidden
}

/**
 * Standalone, testable view of every hidden/atomic range this feature
 * contributes (used directly by unit tests and as the pure core the
 * `hiddenRangeSource` builder below wraps).
 */
export function buildHiddenMarkdownMarkerRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: LivePreviewOptions = {},
): DecorationSet {
  const revealed = computeRevealedRanges(state)
  const hidden = collectHiddenRanges(state, visibleRanges, revealed, options)
  return Decoration.set(
    hidden.map(({ from, to }) => Decoration.replace({}).range(from, to)),
    true,
  )
}

/** CM6 live-preview extension. The Markdown language extension is supplied by the caller. */
export function markdownLivePreview(options: LivePreviewOptions = {}): Extension {
  const paint = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view.state, view.visibleRanges, options)
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
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )

  const deleteTouchesHiddenMarker = (view: EditorView, forward: boolean): boolean =>
    deleteAtHiddenBoundary(view, forward, (state, from, to) =>
      collectHiddenRanges(state, [{ from, to }], computeRevealedRanges(state), {
        viewportMargin: 0,
      }),
    )

  return [
    hiddenRangesEngine(),
    hiddenRangeSource.of(({ state, visibleRanges, revealed }) =>
      collectHiddenRanges(state, visibleRanges, revealed, options),
    ),
    EditorState.transactionFilter.of((transaction) => {
      const cleanup = cleanupEmptyMarkdownFormatting(transaction)
      return cleanup ? [transaction, cleanup] : transaction
    }),
    paint,
    Prec.high(
      keymap.of([
        {
          key: 'Backspace',
          run: (view) => {
            const join = joinContainerMarkdownBlock(view.state, false)
            if (join) {
              view.dispatch(join)
              return true
            }
            return deleteTouchesHiddenMarker(view, false)
          },
        },
        {
          key: 'Delete',
          run: (view) => {
            const join = joinContainerMarkdownBlock(view.state, true)
            if (join) {
              view.dispatch(join)
              return true
            }
            return deleteTouchesHiddenMarker(view, true)
          },
        },
        {
          key: 'Enter',
          run: (view) => {
            const split =
              splitContainerMarkdownBlock(view.state) ?? splitTopLevelMarkdownBlock(view.state)
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
      ]),
    ),
    livePreviewEventHandlers(),
  ]
}
