import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorState, Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

export interface PreviewRange {
  from: number
  to: number
}

export interface LivePreviewOptions {
  /** Extra source characters parsed around each viewport boundary. */
  viewportMargin?: number
}

const HEADING_NAMES = new Map([
  ['ATXHeading1', 1],
  ['ATXHeading2', 2],
  ['ATXHeading3', 3],
  ['ATXHeading4', 4],
  ['ATXHeading5', 5],
  ['ATXHeading6', 6],
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
  URL: 'xmd-cm-link-target',
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
): { labelFrom: number; labelTo: number; href: string } | null {
  let labelFrom = -1
  let labelTo = -1
  let href = ''
  node.cursor().iterate((child) => {
    const text = state.doc.sliceString(child.from, child.to)
    if (child.name === 'LinkMark' && text === '[' && labelFrom < 0) labelFrom = child.to
    if (child.name === 'LinkMark' && text === ']' && labelTo < 0) labelTo = child.from
    if (child.name === 'URL') href = text
  })
  const safeHref = safeMarkdownLinkHref(href)
  return labelFrom >= 0 && labelTo >= labelFrom && safeHref
    ? { labelFrom, labelTo, href: safeHref }
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

function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) return range.head >= from && range.head <= to
    return range.from <= to && range.to >= from
  })
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

  for (const visible of expandedVisibleRanges(state, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        // Fenced blocks are owned by the dedicated code-block preview extension.
        // Avoid overlapping replacement decorations when both extensions are used.
        if (node.name === 'FencedCode' || node.name === 'Table' || node.name === 'Image')
          return false

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
            ranges.push(
              Decoration.line({ class: 'xmd-cm-blockquote' }).range(
                state.doc.line(lineNumber).from,
              ),
            )
          }
        }

        // Keep the complete syntax visible while the user edits that construct.
        const parent = node.node.parent
        const activeFrom = parent?.from ?? node.from
        const activeTo = parent?.to ?? node.to
        const isActive = selectionTouches(state, activeFrom, activeTo)

        if (node.name === 'Link') {
          const link = markdownLinkData(state, node.node)
          const linkIsActive = selectionTouches(state, node.from, node.to)
          if (link) {
            ranges.push(
              Decoration.mark({
                class: 'xmd-cm-link',
                attributes: linkIsActive
                  ? undefined
                  : {
                      'data-xmd-href': link.href,
                      role: 'link',
                      'aria-label': `打开链接 ${link.href}`,
                    },
              }).range(link.labelFrom, link.labelTo),
            )
          }
        }

        if (node.name === 'TaskMarker' && !isActive) {
          const marker = state.doc.sliceString(node.from, node.to).toLowerCase()
          ranges.push(
            Decoration.replace({
              widget: new TaskCheckboxWidget(marker === '[x]', node.from, node.to),
            }).range(node.from, node.to),
          )
        } else if (
          (MARKER_NAMES.has(node.name) ||
            (node.name === 'URL' && node.node.parent?.name === 'Link')) &&
          !isActive
        ) {
          ranges.push(Decoration.replace({}).range(node.from, node.to))
        }
      },
    })
  }

  return Decoration.set(ranges, true)
}

/** CM6 live-preview extension. The Markdown language extension is supplied by the caller. */
export function markdownLivePreview(options: LivePreviewOptions = {}): Extension {
  const preview = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildLivePreviewDecorations(view.state, view.visibleRanges, options)
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.geometryChanged
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

  return [
    preview,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false
        if (!linkAtEvent(event, view)) return false
        event.preventDefault()
        return true
      },
      click(event, view) {
        if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false
        const link = linkAtEvent(event, view)
        if (!link) return false
        event.preventDefault()
        dispatchLink(link, view)
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
