import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, WidgetType, type DecorationSet, type EditorView } from '@codemirror/view'
import type { PreviewRange } from './livePreview'
import { viewportDecorationExtension } from './viewportDecorations'
import { copySvgMarkupAsImage } from '../../lib/richClipboard'
import { checkIcon, codeIcon, copyIcon, eyeIcon } from './widgetIcons'

export type MermaidRenderer = (source: string) => Promise<string>

export interface MermaidPreviewOptions {
  render: MermaidRenderer
  /** Changes the cache key when theme/configuration changes. */
  version?: string | number
  viewportMargin?: number
  errorLabel?: string
  cacheSize?: number
  /** Re-render without foreignObject for reliable PNG clipboard conversion. */
  renderForCopy?: MermaidRenderer
}

interface MermaidBlock {
  from: number
  to: number
  source: string
}

interface MermaidSourceRange {
  from: number
  to: number
}

const setMermaidSourceRange = StateEffect.define<MermaidSourceRange | null>({
  map(value, mapping) {
    return value && { from: mapping.mapPos(value.from), to: mapping.mapPos(value.to) }
  },
})

const mermaidSourceRange = StateField.define<MermaidSourceRange | null>({
  create: () => null,
  update(value, transaction) {
    let next = value && {
      from: transaction.changes.mapPos(value.from),
      to: transaction.changes.mapPos(value.to),
    }
    for (const effect of transaction.effects) {
      if (effect.is(setMermaidSourceRange)) next = effect.value
    }
    return next
  },
})

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

function isSourceBlock(state: EditorState, block: MermaidBlock): boolean {
  const range = state.field(mermaidSourceRange, false)
  return Boolean(range && range.from === block.from && range.to === block.to)
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

export class MermaidWidget extends WidgetType {
  private renderVersion = 0

  constructor(
    readonly block: MermaidBlock,
    readonly renderer: MermaidRenderer,
    readonly cache: MermaidRenderCache,
    readonly version: string | number,
    readonly errorLabel: string,
    readonly renderForCopy: MermaidRenderer,
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

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div')
    container.className = 'xmd-cm-mermaid-preview is-loading'
    const content = document.createElement('div')
    content.className = 'xmd-cm-mermaid-content'
    content.textContent = '…'
    container.append(content)
    const requestVersion = ++this.renderVersion
    void this.cache.render(this.block.source, this.version, this.renderer).then(
      (svg) => {
        if (requestVersion !== this.renderVersion) return
        container.classList.remove('is-loading', 'is-error')
        appendSanitizedSvg(content, svg)
        const actions = document.createElement('div')
        actions.className = 'xmd-cm-mermaid-actions'
        const source = document.createElement('button')
        source.type = 'button'
        source.className = 'xmd-cm-mermaid-source-toggle'
        source.append(codeIcon())
        source.title = '切换到源码'
        source.setAttribute('aria-label', '切换到 Mermaid 源码')
        source.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          view.dispatch({
            effects: setMermaidSourceRange.of(this.block),
            selection: { anchor: Math.min(this.block.to, this.block.from + 3) },
          })
          view.focus()
        })
        const copy = document.createElement('button')
        copy.type = 'button'
        copy.className = 'xmd-cm-preview-copy'
        copy.append(copyIcon())
        copy.title = '复制图片'
        copy.setAttribute('aria-label', '复制 Mermaid 图片')
        copy.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const background =
            getComputedStyle(document.documentElement).getPropertyValue('--code-card-bg').trim() ||
            '#f7f7f7'
          void this.renderForCopy(this.block.source)
            .then((markup) => copySvgMarkupAsImage(markup, background))
            .catch(() => false)
            .then((copied) => {
              copy.dataset.copyState = copied ? 'success' : 'error'
              copy.replaceChildren(copied ? checkIcon() : copyIcon())
              copy.title = copied ? '已复制' : '复制失败'
              window.setTimeout(() => {
                copy.dataset.copyState = ''
                copy.replaceChildren(copyIcon())
                copy.title = '复制图片'
              }, 1_500)
            })
        })
        actions.append(source, copy)
        container.append(actions)
      },
      (error: unknown) => {
        if (requestVersion !== this.renderVersion) return
        container.classList.remove('is-loading')
        container.classList.add('is-error')
        const message = error instanceof Error ? error.message : String(error)
        content.textContent = `${this.errorLabel}: ${message}\n\n${this.block.source}`
      },
    )
    return container
  }

  destroy(): void {
    this.renderVersion += 1
  }

  ignoreEvent(): boolean {
    return true
  }
}

class MermaidPreviewToggleWidget extends WidgetType {
  constructor(readonly block: MermaidBlock) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'xmd-cm-mermaid-preview-toggle'
    button.append(eyeIcon())
    button.title = '切换到预览'
    button.setAttribute('aria-label', '切换到 Mermaid 预览')
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      view.dispatch({
        effects: setMermaidSourceRange.of(null),
        selection: { anchor: this.block.from },
      })
      view.focus()
    })
    return button
  }

  ignoreEvent(): boolean {
    return true
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
    if (isSourceBlock(state, block)) {
      decorations.push(
        Decoration.widget({
          block: true,
          side: -1,
          widget: new MermaidPreviewToggleWidget(block),
        }).range(block.from),
      )
      continue
    }
    decorations.push(
      Decoration.replace({
        block: true,
        widget: new MermaidWidget(
          block,
          options.render,
          cache,
          options.version ?? 'default',
          options.errorLabel ?? 'Diagram error',
          options.renderForCopy ?? options.render,
        ),
      }).range(block.from, block.to),
    )
  }
  return Decoration.set(decorations, true)
}

export function markdownMermaidPreview(options: MermaidPreviewOptions): Extension {
  const cache = new MermaidRenderCache(options.cacheSize)
  return [
    mermaidSourceRange,
    viewportDecorationExtension((view) =>
      buildMermaidPreviewDecorations(view.state, view.visibleRanges, options, cache),
    ),
  ]
}
