import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { hiddenRangeSource, type HiddenRange } from './core/hiddenRanges'
import type { PreviewRange } from './livePreview'
import { isExternalDocumentSync } from './sync'
import { viewportDecorationExtension } from './viewportDecorations'
import { checkIcon, codeIcon, copyIcon, eyeIcon } from './widgetIcons'

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

type MathSourceRange = MathExpression

export const setMathSourceRange = StateEffect.define<MathSourceRange | null>({
  map(value, mapping) {
    return (
      value && {
        ...value,
        from: mapping.mapPos(value.from, -1),
        to: mapping.mapPos(value.to, 1),
      }
    )
  },
})

export const mathSourceRange = StateField.define<MathSourceRange | null>({
  create: () => null,
  update(value, transaction) {
    if (isExternalDocumentSync(transaction)) return null
    let next = value && {
      ...value,
      from: transaction.changes.mapPos(value.from, -1),
      to: transaction.changes.mapPos(value.to, 1),
    }
    for (const effect of transaction.effects) {
      if (effect.is(setMathSourceRange)) next = effect.value
    }
    return next && next.from < next.to ? next : null
  },
  provide: (source) =>
    EditorView.decorations.from(source, (range) => {
      if (!range) return Decoration.none
      const position = range.displayMode ? range.from : range.to
      return Decoration.set([
        Decoration.widget({
          block: range.displayMode,
          side: range.displayMode ? -1 : 1,
          widget: new MathPreviewToggleWidget(range),
        }).range(position),
      ])
    }),
})

const EXCLUDED_MATH_NODES = new Set([
  'CodeBlock',
  'FencedCode',
  'HTMLBlock',
  'Image',
  'InlineCode',
  'CodeText',
  'URL',
])

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
  const text = state.doc.sliceString(range.from, range.to)
  const htmlCodePattern = /<code\b[^>]*>[\s\S]*?<\/code\s*>/gi
  for (const match of text.matchAll(htmlCodePattern)) {
    const offset = match.index
    result.push({ from: range.from + offset, to: range.from + offset + match[0].length })
  }
  return result
}

function intersectsAny(from: number, to: number, ranges: readonly PreviewRange[]): boolean {
  return ranges.some((range) => from < range.to && to > range.from)
}

function isolatedDisplayRange(state: EditorState, from: number, to: number): PreviewRange | null {
  const firstLine = state.doc.lineAt(from)
  const lastLine = state.doc.lineAt(to)
  if (
    state.doc.sliceString(firstLine.from, from).trim().length > 0 ||
    state.doc.sliceString(to, lastLine.to).trim().length > 0
  ) {
    return null
  }
  return { from: firstLine.from, to: lastLine.to }
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
      const displayRange = displayMode ? isolatedDisplayRange(state, from, to) : null
      if (displayMode && !displayRange) {
        index = close + markerLength
        continue
      }
      const expressionFrom = displayRange?.from ?? from
      const expressionTo = displayRange?.to ?? to
      if (!intersectsAny(expressionFrom, expressionTo, excluded)) {
        result.push({
          from: expressionFrom,
          to: expressionTo,
          source: displayMode ? rawSource.trim() : rawSource,
          displayMode,
        })
      }
      index = close + markerLength
    }
  }
  return result
}

function isSourceExpression(state: EditorState, expression: MathExpression): boolean {
  const source = state.field(mathSourceRange, false)
  return Boolean(
    source &&
    source.displayMode === expression.displayMode &&
    expression.from >= source.from &&
    expression.to <= source.to,
  )
}

function mathEditAnchor(state: EditorState, expression: MathExpression): number {
  const text = state.doc.sliceString(expression.from, expression.to)
  const marker = expression.displayMode ? '$$' : '$'
  const markerOffset = text.indexOf(marker)
  return markerOffset < 0 ? expression.from : expression.from + markerOffset + marker.length
}

function fallbackCopyText(value: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.append(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

async function copyMathSource(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // The WebView may reject async clipboard access. Use the legacy user-gesture path.
  }
  return fallbackCopyText(value)
}

class MathWidget extends WidgetType {
  private copyVersion = 0
  private copyResetTimer: number | undefined

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

  toDOM(view: EditorView): HTMLElement {
    const content = document.createElement(this.expression.displayMode ? 'div' : 'span')
    content.className = this.expression.displayMode
      ? 'xmd-cm-math xmd-cm-math-display'
      : 'xmd-cm-math xmd-cm-math-inline'
    try {
      if (this.renderer) this.renderer(this.expression.source, content, this.expression.displayMode)
      else content.textContent = this.expression.source
    } catch (error) {
      content.classList.add('is-error')
      content.textContent = this.expression.source
      content.title = `${this.errorLabel}: ${error instanceof Error ? error.message : String(error)}`
    }

    const edit = (): void => {
      // Native `title` popovers can remain visible after a double-click swaps the
      // preview for its source range. Remove the trigger before entering edit mode;
      // a newly-rendered preview receives the hint again.
      content.removeAttribute('title')
      view.focus()
      view.dispatch({
        effects: setMathSourceRange.of(this.expression),
        selection: { anchor: mathEditAnchor(view.state, this.expression) },
      })
    }

    if (!this.expression.displayMode) {
      content.tabIndex = 0
      content.setAttribute('role', 'button')
      content.setAttribute('aria-label', '数学公式，双击或按回车编辑')
      content.title ||= '双击或按回车编辑公式'
      content.addEventListener('dblclick', (event) => {
        event.preventDefault()
        event.stopPropagation()
        edit()
      })
      content.addEventListener('keydown', (event) => {
        const keyboardEvent = event as KeyboardEvent
        if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== 'F2') return
        event.preventDefault()
        event.stopPropagation()
        edit()
      })
      return content
    }

    const block = document.createElement('div')
    block.className = 'xmd-cm-math-block'
    block.append(content)
    const actions = document.createElement('div')
    actions.className = 'xmd-cm-math-actions'
    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'xmd-cm-math-edit'
    editButton.append(codeIcon())
    editButton.title = '编辑公式源码'
    editButton.setAttribute('aria-label', '编辑公式源码')
    editButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      editButton.removeAttribute('title')
      edit()
    })
    const copyButton = document.createElement('button')
    copyButton.type = 'button'
    copyButton.className = 'xmd-cm-math-copy'
    copyButton.append(copyIcon())
    copyButton.title = '复制 LaTeX'
    copyButton.setAttribute('aria-label', '复制公式 LaTeX')
    copyButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const request = ++this.copyVersion
      copyButton.disabled = true
      void copyMathSource(this.expression.source).then((copied) => {
        if (request !== this.copyVersion || !copyButton.isConnected) return
        copyButton.disabled = false
        copyButton.dataset.copyState = copied ? 'success' : 'error'
        copyButton.replaceChildren(copied ? checkIcon() : copyIcon())
        copyButton.title = copied ? '已复制' : '复制失败'
        if (this.copyResetTimer !== undefined) window.clearTimeout(this.copyResetTimer)
        this.copyResetTimer = window.setTimeout(() => {
          if (request !== this.copyVersion || !copyButton.isConnected) return
          copyButton.dataset.copyState = ''
          copyButton.replaceChildren(copyIcon())
          copyButton.title = '复制 LaTeX'
          this.copyResetTimer = undefined
        }, 1_500)
      })
    })
    actions.append(editButton, copyButton)
    block.append(actions)
    return block
  }

  destroy(): void {
    this.copyVersion += 1
    if (this.copyResetTimer !== undefined) window.clearTimeout(this.copyResetTimer)
    this.copyResetTimer = undefined
  }

  ignoreEvent(): boolean {
    return true
  }
}

class MathPreviewToggleWidget extends WidgetType {
  constructor(readonly expression: MathSourceRange) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = this.expression.displayMode
      ? 'xmd-cm-math-preview-toggle is-display'
      : 'xmd-cm-math-preview-toggle is-inline'
    button.append(eyeIcon())
    button.title = '切换到公式预览'
    button.setAttribute('aria-label', '切换到公式预览')
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      view.focus()
      view.dispatch({
        effects: setMathSourceRange.of(null),
        selection: { anchor: this.expression.from },
      })
    })
    return button
  }

  ignoreEvent(): boolean {
    return true
  }
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
    if (isSourceExpression(state, expression)) continue
    decorations.push(
      Decoration.replace({
        widget: new MathWidget(expression, options.render, options.errorLabel ?? 'Invalid formula'),
        block: expression.displayMode,
      }).range(expression.from, expression.to),
    )
  }
  return Decoration.set(decorations, true)
}

/**
 * The single source of atomic/hidden ranges this feature contributes to the
 * core engine (`core/hiddenRanges.ts`), replacing the standalone
 * `EditorView.atomicRanges` provider (`atomic: true` on
 * `viewportDecorationExtension`) this module used to maintain on its own.
 * An expression currently open in source-edit mode (`mathSourceRange`,
 * toggled by `MathWidget`'s edit affordances) is excluded so its raw LaTeX
 * stays ordinary, editable text — matching `buildMathPreviewDecorations`,
 * which likewise skips painting a widget over it. Every other expression's
 * span is registered with `presentation: 'external'`: this module's own
 * `viewportDecorationExtension` StateField already paints the `MathWidget`
 * replacement, so core must not paint a second, invisible one on top of it.
 */
export function collectMathHiddenRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: MathPreviewOptions = {},
): HiddenRange[] {
  const hidden: HiddenRange[] = []
  for (const expression of findVisibleMathExpressions(
    state,
    visibleRanges,
    options.viewportMargin,
  )) {
    if (isSourceExpression(state, expression)) continue
    hidden.push({ from: expression.from, to: expression.to, presentation: 'external' })
  }
  return hidden
}

export function markdownMathPreview(options: MathPreviewOptions = {}): Extension {
  return [
    mathSourceRange,
    viewportDecorationExtension(
      (view) => buildMathPreviewDecorations(view.state, view.visibleRanges, options),
      {
        rebuildOnSyntaxTree: true,
        rebuildOnUpdate: (update) =>
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setMathSourceRange)),
          ),
      },
    ),
    hiddenRangeSource.of(({ state, visibleRanges }) =>
      collectMathHiddenRanges(state, visibleRanges, options),
    ),
  ]
}
