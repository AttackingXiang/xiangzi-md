import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import type { PreviewRange } from './livePreview'
import { viewportDecorationExtension } from './viewportDecorations'

export interface MathExpression {
  from: number
  to: number
  source: string
  displayMode: boolean
}

/** Populate the supplied element with trusted rendered math (for example katex.render). */
export type MathRenderer = (source: string, container: HTMLElement, displayMode: boolean) => void

export interface MathPreviewOptions {
  viewportMargin?: number
  render?: MathRenderer
  errorLabel?: string
}

const EXCLUDED_MATH_NODES = new Set(['FencedCode', 'InlineCode', 'CodeText'])

function isEscaped(text: string, offset: number): boolean {
  let slashes = 0
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1) slashes += 1
  return slashes % 2 === 1
}

function mergeRanges(
  state: EditorState,
  ranges: readonly PreviewRange[],
  margin: number,
): PreviewRange[] {
  const expanded = ranges
    .map((range) => ({
      from: Math.max(0, range.from - margin),
      to: Math.min(state.doc.length, range.to + margin),
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

function excludedRanges(state: EditorState, range: PreviewRange): PreviewRange[] {
  const result: PreviewRange[] = []
  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      if (EXCLUDED_MATH_NODES.has(node.name)) {
        result.push({ from: node.from, to: node.to })
        return false
      }
    },
  })
  return result
}

function intersectsAny(from: number, to: number, ranges: readonly PreviewRange[]): boolean {
  return ranges.some((range) => from < range.to && to > range.from)
}

/** Strictly scans only viewport text, excluding Markdown code nodes. */
export function findVisibleMathExpressions(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  viewportMargin = 256,
): MathExpression[] {
  const result: MathExpression[] = []
  for (const range of mergeRanges(state, visibleRanges, Math.max(0, viewportMargin))) {
    const text = state.doc.sliceString(range.from, range.to)
    const excluded = excludedRanges(state, range)
    let index = 0
    while (index < text.length) {
      if (text[index] !== '$' || isEscaped(text, index)) {
        index += 1
        continue
      }

      const displayMode = text[index + 1] === '$'
      const markerLength = displayMode ? 2 : 1
      const contentStart = index + markerLength
      if (contentStart >= text.length || (!displayMode && /\s/.test(text[contentStart] ?? ''))) {
        index += markerLength
        continue
      }

      let close = contentStart
      while (close < text.length) {
        if (!displayMode && text[close] === '\n') break
        const matches = displayMode
          ? text[close] === '$' && text[close + 1] === '$'
          : text[close] === '$'
        if (matches && !isEscaped(text, close)) break
        close += 1
      }

      const hasClose =
        close < text.length &&
        (displayMode ? text[close] === '$' && text[close + 1] === '$' : text[close] === '$')
      const contentEnd = close
      const next = text[close + markerLength] ?? ''
      const rawSource = text.slice(contentStart, contentEnd)
      const validBoundary =
        hasClose &&
        contentEnd > contentStart &&
        (displayMode
          ? rawSource.trim().length > 0
          : !/\s/.test(text[contentEnd - 1] ?? '') && !/\d/.test(next))

      if (!validBoundary) {
        index += markerLength
        continue
      }

      const from = range.from + index
      const to = range.from + close + markerLength
      if (!intersectsAny(from, to, excluded)) {
        result.push({
          from,
          to,
          source: displayMode ? rawSource.trim() : rawSource,
          displayMode,
        })
      }
      index = close + markerLength
    }
  }
  return result
}

class MathWidget extends WidgetType {
  constructor(
    readonly expression: MathExpression,
    readonly renderer: MathRenderer | undefined,
    readonly errorLabel: string,
  ) {
    super()
  }

  eq(other: MathWidget): boolean {
    return (
      other.expression.source === this.expression.source &&
      other.expression.displayMode === this.expression.displayMode &&
      other.renderer === this.renderer &&
      other.errorLabel === this.errorLabel
    )
  }

  get estimatedHeight(): number {
    return this.expression.displayMode ? 58 : -1
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.expression.displayMode ? 'div' : 'span')
    element.className = this.expression.displayMode
      ? 'xmd-cm-math xmd-cm-math-display'
      : 'xmd-cm-math xmd-cm-math-inline'
    try {
      if (this.renderer) this.renderer(this.expression.source, element, this.expression.displayMode)
      else element.textContent = this.expression.source
    } catch (error) {
      element.classList.add('is-error')
      element.textContent = this.expression.source
      element.title = `${this.errorLabel}: ${error instanceof Error ? error.message : String(error)}`
    }
    return element
  }
}

function selectionTouches(state: EditorState, expression: MathExpression): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) return range.head >= expression.from && range.head <= expression.to
    return range.from <= expression.to && range.to >= expression.from
  })
}

export function buildMathPreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: MathPreviewOptions = {},
): DecorationSet {
  const decorations: Array<ReturnType<Decoration['range']>> = []
  for (const expression of findVisibleMathExpressions(
    state,
    visibleRanges,
    options.viewportMargin,
  )) {
    if (selectionTouches(state, expression)) continue
    decorations.push(
      Decoration.replace({
        widget: new MathWidget(expression, options.render, options.errorLabel ?? 'Invalid formula'),
        block: expression.displayMode,
      }).range(expression.from, expression.to),
    )
  }
  return Decoration.set(decorations, true)
}

export function markdownMathPreview(options: MathPreviewOptions = {}): Extension {
  return viewportDecorationExtension((view) =>
    buildMathPreviewDecorations(view.state, view.visibleRanges, options),
  )
}
