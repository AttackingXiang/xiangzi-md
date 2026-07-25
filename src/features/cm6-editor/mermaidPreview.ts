import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, WidgetType, type DecorationSet, type EditorView } from '@codemirror/view'
import { hiddenRangeSource, type HiddenRange } from './core/hiddenRanges'
import type { PreviewRange } from './livePreview'
import { viewportDecorationExtension } from './viewportDecorations'
import { copySvgMarkupAsImage } from '../../lib/richClipboard'
import { checkIcon, codeIcon, copyIcon } from './widgetIcons'
import { isExternalDocumentSync } from './sync'
import { compensateScrollForHeightDelta, resizeWithScrollCompensation } from './scrollCompensation'

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
  /**
   * Overrides the module-level default cache `markdownMermaidPreview` reuses
   * across editor remounts. Mainly for test isolation (multiple `it()` blocks
   * in one file otherwise share that default's rendered SVGs/heights).
   */
  cache?: MermaidRenderCache
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

export const setMermaidSourceRange = StateEffect.define<MermaidSourceRange | null>({
  map(value, mapping) {
    return value && { from: mapping.mapPos(value.from), to: mapping.mapPos(value.to) }
  },
})

export const mermaidSourceRange = StateField.define<MermaidSourceRange | null>({
  create: () => null,
  update(value, transaction) {
    if (isExternalDocumentSync(transaction)) return null
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

const mermaidModeVersion = StateField.define<number>({
  create: () => 0,
  update(value, transaction) {
    return transaction.effects.some((effect) => effect.is(setMermaidSourceRange))
      ? value + 1
      : value
  },
})

function mermaidCacheKey(source: string, version: string | number): string {
  return `${String(version)}\u0000${source}`
}

export class MermaidRenderCache {
  private readonly entries = new Map<string, Promise<string>>()
  // Last rendered SVG height per key, so a widget re-mounted for the same
  // source/version (scrolling back into view, tab switch) can report its
  // real size instead of the generic loading-shell estimate.
  private readonly heights = new Map<string, number>()
  // The resolved SVG markup itself, readable synchronously. `entries` only
  // ever hands back a Promise — even one already settled still defers its
  // `.then()` to a microtask — so a widget built by `toDOM()` for a diagram
  // this cache already rendered would otherwise always paint the loading
  // shell for at least one tick before swapping in the real content, on
  // every remount (scrolling it in and out of CM6's render margin, tab
  // switches, ...). Checking this map lets `toDOM()` skip that placeholder
  // step entirely when the diagram is already known.
  private readonly resolvedSvg = new Map<string, string>()

  constructor(readonly maxEntries = 24) {}

  render(source: string, version: string | number, renderer: MermaidRenderer): Promise<string> {
    const key = mermaidCacheKey(source, version)
    const cached = this.entries.get(key)
    if (cached) return cached

    const pending = renderer(source)
      .then((svg) => {
        this.resolvedSvg.set(key, svg)
        return svg
      })
      .catch((error: unknown) => {
        // A temporary renderer failure should be retryable after the widget remounts.
        this.entries.delete(key)
        throw error
      })
    this.entries.set(key, pending)
    while (this.entries.size > Math.max(1, this.maxEntries)) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
      this.heights.delete(oldest)
      this.resolvedSvg.delete(oldest)
    }
    return pending
  }

  getResolvedSvg(source: string, version: string | number): string | undefined {
    return this.resolvedSvg.get(mermaidCacheKey(source, version))
  }

  getHeight(source: string, version: string | number): number | undefined {
    return this.heights.get(mermaidCacheKey(source, version))
  }

  rememberHeight(source: string, version: string | number, height: number): void {
    if (!Number.isFinite(height) || height <= 0) return
    this.heights.set(mermaidCacheKey(source, version), height)
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
        const sourceParts: string[] = []
        node.node.cursor().iterate((child) => {
          if (child.name === 'CodeInfo') language = state.doc.sliceString(child.from, child.to)
          // Blockquotes and list-indented fences split their body into multiple CodeText
          // nodes around QuoteMark/indentation tokens. Overwriting here silently kept only
          // the final line, producing a valid-looking but incomplete diagram.
          if (child.name === 'CodeText') {
            sourceParts.push(state.doc.sliceString(child.from, child.to))
          }
        })
        const languageName = language.trim().split(/\s+/, 1)[0]?.toLowerCase()
        if (languageName !== 'mermaid') return false
        const key = `${node.from}:${node.to}`
        if (!seen.has(key)) {
          seen.add(key)
          blocks.push({ from: node.from, to: node.to, source: sourceParts.join('') })
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

function applyRenderedMermaidSvg(
  container: HTMLElement,
  content: HTMLElement,
  copy: HTMLButtonElement,
  svg: string,
): void {
  container.classList.remove('is-loading', 'is-error')
  appendSanitizedSvg(content, svg)
  const svgElement = content.querySelector('svg')
  if (svgElement) {
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svgElement.removeAttribute('height')
    svgElement.style.removeProperty('height')
  }
  copy.disabled = false
  copy.title = '复制图片'
}

export class MermaidWidget extends WidgetType {
  private renderVersion = 0
  private copyVersion = 0
  private copyResetTimer: number | undefined
  private resizeObserver: ResizeObserver | undefined

  constructor(
    readonly block: MermaidBlock,
    readonly renderer: MermaidRenderer,
    readonly cache: MermaidRenderCache,
    readonly version: string | number,
    readonly errorLabel: string,
    readonly renderForCopy: MermaidRenderer,
    readonly modeVersion = 0,
  ) {
    super()
  }

  eq(other: MermaidWidget): boolean {
    return (
      other.block.source === this.block.source &&
      other.renderer === this.renderer &&
      other.cache === this.cache &&
      other.version === this.version &&
      other.errorLabel === this.errorLabel &&
      other.renderForCopy === this.renderForCopy &&
      other.modeVersion === this.modeVersion
    )
  }

  get estimatedHeight(): number {
    // Falls back to the loading-shell height until the SVG is measured once;
    // afterwards this reflects the real rendered size instead of a guess,
    // so a widget re-mounted off-screen (scrolling, tab switch) doesn't shove
    // the rest of the document around when it comes into view.
    return this.cache.getHeight(this.block.source, this.version) ?? 112
  }

  toDOM(view: EditorView): HTMLElement {
    const block = document.createElement('div')
    block.className = 'xmd-cm-mermaid-block'
    const container = document.createElement('div')
    container.className = 'xmd-cm-mermaid-preview is-loading'
    const content = document.createElement('div')
    content.className = 'xmd-cm-mermaid-content'
    content.setAttribute('role', 'img')
    content.setAttribute('aria-label', 'Mermaid 图表')
    content.textContent = '…'
    container.append(content)

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
    copy.title = '图表渲染完成后可复制'
    copy.setAttribute('aria-label', '复制 Mermaid 图片')
    copy.disabled = true
    copy.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (copy.disabled) return

      const copyRequest = ++this.copyVersion
      copy.disabled = true
      copy.title = '正在复制'
      const background =
        getComputedStyle(document.documentElement).getPropertyValue('--code-card-bg').trim() ||
        '#f7f7f7'
      void this.renderForCopy(this.block.source)
        .then((markup) => copySvgMarkupAsImage(markup, background))
        .catch(() => false)
        .then((copied) => {
          if (copyRequest !== this.copyVersion || !copy.isConnected) return
          copy.dataset.copyState = copied ? 'success' : 'error'
          copy.replaceChildren(copied ? checkIcon() : copyIcon())
          copy.title = copied ? '已复制' : '复制失败'
          copy.disabled = false
          if (this.copyResetTimer !== undefined) window.clearTimeout(this.copyResetTimer)
          this.copyResetTimer = window.setTimeout(() => {
            if (copyRequest !== this.copyVersion || !copy.isConnected) return
            copy.dataset.copyState = ''
            copy.replaceChildren(copyIcon())
            copy.title = '复制图片'
            this.copyResetTimer = undefined
          }, 1_500)
        })
    })
    actions.append(source, copy)
    container.append(actions)
    block.append(container)

    // A widget rebuilt for a diagram this cache already rendered (scrolled
    // out of CM6's render margin and back in, tab switch, ...) would
    // otherwise always paint the loading shell for one tick before the async
    // path below swaps in the real content — the visible flash this whole
    // cache exists to avoid. Apply it synchronously here instead.
    const cachedSvg = this.cache.getResolvedSvg(this.block.source, this.version)
    if (cachedSvg) applyRenderedMermaidSvg(container, content, copy, cachedSvg)

    const requestVersion = ++this.renderVersion
    void this.cache.render(this.block.source, this.version, this.renderer).then(
      (svg) => {
        if (requestVersion !== this.renderVersion) return
        resizeWithScrollCompensation(view, block, () => {
          applyRenderedMermaidSvg(container, content, copy, svg)
        })
        this.cache.rememberHeight(this.block.source, this.version, block.getBoundingClientRect().height)
        if (typeof ResizeObserver === 'function') {
          this.resizeObserver?.disconnect()
          let previousWidth = -1
          let previousHeight = -1
          this.resizeObserver = new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect
            if (!rect || (rect.width === previousWidth && rect.height === previousHeight)) return
            const heightDelta = previousHeight >= 0 ? rect.height - previousHeight : 0
            previousWidth = rect.width
            previousHeight = rect.height
            compensateScrollForHeightDelta(view, block.getBoundingClientRect().top, heightDelta)
            this.cache.rememberHeight(this.block.source, this.version, block.getBoundingClientRect().height)
            view.requestMeasure()
          })
          this.resizeObserver.observe(content)
        }
      },
      (error: unknown) => {
        if (requestVersion !== this.renderVersion) return
        resizeWithScrollCompensation(view, block, () => {
          container.classList.remove('is-loading')
          container.classList.add('is-error')
          copy.title = '图表语法有误，无法复制'
          const message = error instanceof Error ? error.message : String(error)
          content.textContent = `${this.errorLabel}: ${message}\n\n${this.block.source}`
        })
      },
    )
    return block
  }

  destroy(): void {
    this.renderVersion += 1
    this.copyVersion += 1
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    if (this.copyResetTimer !== undefined) window.clearTimeout(this.copyResetTimer)
    this.copyResetTimer = undefined
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
    if (isSourceBlock(state, block)) continue
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
          state.field(mermaidModeVersion, false) ?? 0,
        ),
      }).range(block.from, block.to),
    )
  }
  return Decoration.set(decorations, true)
}

/**
 * The single source of atomic/hidden ranges this feature contributes to the
 * core engine (`core/hiddenRanges.ts`). Unlike the other Phase 3 modules,
 * Mermaid previously registered *no* atomic range at all (see
 * core/README.md's Phase 2 known-gap note): a rendered diagram's block-replace
 * widget was purely visual, so a click or drag near it could land the caret
 * or a selection boundary inside the hidden fenced-code source underneath.
 * A block currently open in source-edit mode (`mermaidSourceRange`) is
 * excluded so its raw Mermaid text stays ordinary, editable fenced-code
 * content — matching `buildMermaidPreviewDecorations`, which likewise skips
 * painting a widget over it. Every other block's span is registered with
 * `presentation: 'external'`: this module's own `viewportDecorationExtension` StateField
 * already paints the `MermaidWidget` replacement.
 */
export function collectMermaidHiddenRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: MermaidPreviewOptions,
): HiddenRange[] {
  const hidden: HiddenRange[] = []
  for (const block of findMermaidBlocks(
    state,
    visibleRanges,
    Math.max(0, options.viewportMargin ?? 256),
  )) {
    if (isSourceBlock(state, block)) continue
    hidden.push({ from: block.from, to: block.to, presentation: 'external' })
  }
  return hidden
}

// Module-level so rendered SVGs and measured heights survive the editor
// rebuilding its preview extensions — every settings change (theme, table
// mode, ...) and every tab switch calls `markdownMermaidPreview` fresh (see
// MarkdownEditor.tsx), and a per-call cache would otherwise force every
// visible diagram back through the loading-placeholder-to-real-size jump on
// each of those, not just on first render.
const sharedMermaidRenderCache = new MermaidRenderCache()

export function markdownMermaidPreview(options: MermaidPreviewOptions): Extension {
  const cache = options.cache ?? sharedMermaidRenderCache
  return [
    mermaidSourceRange,
    mermaidModeVersion,
    viewportDecorationExtension(
      (view) => buildMermaidPreviewDecorations(view.state, view.visibleRanges, options, cache),
      {
        rebuildOnSyntaxTree: true,
        rebuildOnUpdate: (update) =>
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setMermaidSourceRange)),
          ),
      },
    ),
    hiddenRangeSource.of(({ state, visibleRanges }) =>
      collectMermaidHiddenRanges(state, visibleRanges, options),
    ),
  ]
}
