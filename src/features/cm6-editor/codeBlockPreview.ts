import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import type { PreviewRange } from './livePreview'
import { viewportDecorationExtension } from './viewportDecorations'

export interface CodeBlockPreviewOptions {
  /** Extra characters inspected around the CM6 viewport. */
  viewportMargin?: number
  /** Maximum estimated/rendered preview height, in pixels. */
  maxHeight?: number
  copyLabel?: string
  copiedLabel?: string
}

interface FencedCodeData {
  from: number
  to: number
  language: string
  code: string
}

class FencedCodeWidget extends WidgetType {
  constructor(
    readonly data: FencedCodeData,
    readonly options: Required<
      Pick<CodeBlockPreviewOptions, 'maxHeight' | 'copyLabel' | 'copiedLabel'>
    >,
  ) {
    super()
  }

  eq(other: FencedCodeWidget): boolean {
    return (
      other.data.language === this.data.language &&
      other.data.code === this.data.code &&
      other.options.maxHeight === this.options.maxHeight &&
      other.options.copyLabel === this.options.copyLabel &&
      other.options.copiedLabel === this.options.copiedLabel
    )
  }

  get estimatedHeight(): number {
    const lines = this.data.code.split('\n').length
    return Math.min(this.options.maxHeight, 43 + lines * 22)
  }

  toDOM(): HTMLElement {
    const container = document.createElement('section')
    container.className = 'xmd-cm-code-preview'
    container.style.setProperty('--xmd-code-max-height', `${this.options.maxHeight}px`)

    const header = document.createElement('div')
    header.className = 'xmd-cm-code-preview-header'

    const language = document.createElement('span')
    language.className = 'xmd-cm-code-preview-language'
    language.textContent = this.data.language || 'text'

    const copy = document.createElement('button')
    copy.className = 'xmd-cm-code-preview-copy'
    copy.type = 'button'
    copy.textContent = this.options.copyLabel
    copy.setAttribute('aria-label', this.options.copyLabel)
    copy.addEventListener('click', () => {
      const clipboard = globalThis.navigator?.clipboard
      if (!clipboard) return
      void clipboard.writeText(this.data.code).then(
        () => {
          copy.textContent = this.options.copiedLabel
          window.setTimeout(() => {
            if (copy.isConnected) copy.textContent = this.options.copyLabel
          }, 1200)
        },
        () => {
          copy.textContent = this.options.copyLabel
        },
      )
    })

    const pre = document.createElement('pre')
    pre.className = 'xmd-cm-code-preview-pre'
    const code = document.createElement('code')
    if (this.data.language) code.dataset.language = this.data.language
    // Deliberately use textContent: fenced source must never become executable HTML.
    code.textContent = this.data.code
    pre.append(code)
    header.append(language, copy)
    container.append(header, pre)
    return container
  }

  ignoreEvent(): boolean {
    return true
  }
}

function touchesSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) return range.head >= from && range.head <= to
    return range.from <= to && range.to >= from
  })
}

function mergeVisibleRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  margin: number,
): PreviewRange[] {
  const ranges = visibleRanges
    .map((range) => ({
      from: Math.max(0, range.from - margin),
      to: Math.min(state.doc.length, range.to + margin),
    }))
    .sort((a, b) => a.from - b.from)
  const merged: PreviewRange[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else merged.push(range)
  }
  return merged
}

function readFencedCode(state: EditorState, from: number, to: number): FencedCodeData {
  let language = ''
  let code = ''
  const tree = syntaxTree(state)
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'CodeInfo') language = state.doc.sliceString(node.from, node.to).trim()
      if (node.name === 'CodeText') code = state.doc.sliceString(node.from, node.to)
    },
  })
  return { from, to, language, code }
}

/** Builds fenced-code widgets only for blocks intersecting the supplied viewport. */
export function buildCodeBlockPreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: CodeBlockPreviewOptions = {},
): DecorationSet {
  const decorations: Array<ReturnType<Decoration['range']>> = []
  const margin = Math.max(0, options.viewportMargin ?? 256)
  const widgetOptions = {
    maxHeight: Math.max(120, options.maxHeight ?? 480),
    copyLabel: options.copyLabel ?? 'Copy',
    copiedLabel: options.copiedLabel ?? 'Copied',
  }
  const seen = new Set<string>()

  for (const visible of mergeVisibleRanges(state, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'FencedCode') return
        const key = `${node.from}:${node.to}`
        if (seen.has(key)) return false
        seen.add(key)
        if (touchesSelection(state, node.from, node.to)) return false

        const data = readFencedCode(state, node.from, node.to)
        // Mermaid is owned by the asynchronous diagram extension. If that
        // extension is absent, keeping source visible is safer than overlapping widgets.
        if (data.language.toLowerCase() === 'mermaid') return false
        decorations.push(
          Decoration.replace({
            widget: new FencedCodeWidget(data, widgetOptions),
            block: true,
          }).range(node.from, node.to),
        )
        return false
      },
    })
  }

  return Decoration.set(decorations, true)
}

/** CM6 fenced-code live preview. Must be used alongside the Markdown language extension. */
export function markdownCodeBlockPreview(options: CodeBlockPreviewOptions = {}): Extension {
  return viewportDecorationExtension((view) =>
    buildCodeBlockPreviewDecorations(view.state, view.visibleRanges, options),
  )
}
