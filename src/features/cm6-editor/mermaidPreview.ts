import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import type { PreviewRange } from './livePreview'
import { viewportDecorationExtension } from './viewportDecorations'

export type MermaidRenderer = (source: string) => Promise<string>

export interface MermaidPreviewOptions {
  render: MermaidRenderer
  /** Changes the cache key when theme/configuration changes. */
  version?: string | number
  viewportMargin?: number
  errorLabel?: string
  cacheSize?: number
}

interface MermaidBlock {
  from: number
  to: number
  source: string
}

export class MermaidRenderCache {
  private readonly entries = new Map<string, Promise<string>>()

  constructor(readonly maxEntries = 24) {}

  render(source: string, version: string | number, renderer: MermaidRenderer): Promise<string> {
    const key = `${String(version)}\u0000${source}`
    const cached = this.entries.get(key)
    if (cached) return cached

    const pending = renderer(source).catch((error: unknown) => {
      // A temporary renderer failure should be retryable after the widget remounts.
      this.entries.delete(key)
      throw error
    })
    this.entries.set(key, pending)
    while (this.entries.size > Math.max(1, this.maxEntries)) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return pending
  }
}

function selectionTouches(state: EditorState, block: MermaidBlock): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) return range.head >= block.from && range.head <= block.to
    return range.from <= block.to && range.to >= block.from
  })
}

function findMermaidBlocks(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  margin: number,
): MermaidBlock[] {
  const blocks: MermaidBlock[] = []
  const seen = new Set<string>()
  for (const visible of visibleRanges) {
    const from = Math.max(0, visible.from - margin)
    const to = Math.min(state.doc.length, visible.to + margin)
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'FencedCode') return
        let language = ''
        let source = ''
        node.node.cursor().iterate((child) => {
          if (child.name === 'CodeInfo') language = state.doc.sliceString(child.from, child.to)
          if (child.name === 'CodeText') source = state.doc.sliceString(child.from, child.to)
        })
        if (language.trim().toLowerCase() !== 'mermaid') return false
        const key = `${node.from}:${node.to}`
        if (!seen.has(key)) {
          seen.add(key)
          blocks.push({ from: node.from, to: node.to, source })
        }
        return false
      },
    })
  }
  return blocks
}

function appendSanitizedSvg(container: HTMLElement, svg: string): void {
  const template = document.createElement('template')
  template.innerHTML = svg
  template.content.querySelectorAll('script,iframe,object,embed').forEach((node) => node.remove())
  template.content.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name)
    }
  })
  container.replaceChildren(template.content.cloneNode(true))
}

class MermaidWidget extends WidgetType {
  private renderVersion = 0

  constructor(
    readonly block: MermaidBlock,
    readonly renderer: MermaidRenderer,
    readonly cache: MermaidRenderCache,
    readonly version: string | number,
    readonly errorLabel: string,
  ) {
    super()
  }

  eq(other: MermaidWidget): boolean {
    return (
      other.block.source === this.block.source &&
      other.renderer === this.renderer &&
      other.cache === this.cache &&
      other.version === this.version &&
      other.errorLabel === this.errorLabel
    )
  }

  get estimatedHeight(): number {
    return 220
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'xmd-cm-mermaid-preview is-loading'
    container.textContent = '…'
    const requestVersion = ++this.renderVersion
    void this.cache.render(this.block.source, this.version, this.renderer).then(
      (svg) => {
        if (requestVersion !== this.renderVersion) return
        container.classList.remove('is-loading', 'is-error')
        appendSanitizedSvg(container, svg)
      },
      (error: unknown) => {
        if (requestVersion !== this.renderVersion) return
        container.classList.remove('is-loading')
        container.classList.add('is-error')
        const message = error instanceof Error ? error.message : String(error)
        container.textContent = `${this.errorLabel}: ${message}\n\n${this.block.source}`
      },
    )
    return container
  }

  destroy(): void {
    this.renderVersion += 1
  }
}

export function buildMermaidPreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: MermaidPreviewOptions,
  cache = new MermaidRenderCache(options.cacheSize),
): DecorationSet {
  const decorations: Array<ReturnType<Decoration['range']>> = []
  for (const block of findMermaidBlocks(
    state,
    visibleRanges,
    Math.max(0, options.viewportMargin ?? 256),
  )) {
    if (selectionTouches(state, block)) continue
    decorations.push(
      Decoration.replace({
        block: true,
        widget: new MermaidWidget(
          block,
          options.render,
          cache,
          options.version ?? 'default',
          options.errorLabel ?? 'Diagram error',
        ),
      }).range(block.from, block.to),
    )
  }
  return Decoration.set(decorations, true)
}

export function markdownMermaidPreview(options: MermaidPreviewOptions): Extension {
  const cache = new MermaidRenderCache(options.cacheSize)
  return viewportDecorationExtension((view) =>
    buildMermaidPreviewDecorations(view.state, view.visibleRanges, options, cache),
  )
}
