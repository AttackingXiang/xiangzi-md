import { syntaxTree } from '@codemirror/language'
import { StateEffect, type EditorState } from '@codemirror/state'
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'

export interface MarkdownImageMatch {
  from: number
  to: number
  alt: string
  src: string
  block: boolean
}

export interface MarkdownImagePreviewOptions {
  resolveSrc: (src: string) => Promise<string | null> | string | null
  maxWidth?: number | string
  allowRemote?: boolean
  bufferChars?: number
  placeholderHeight?: number
}

type CacheEntry =
  | { status: 'pending'; token: number }
  | { status: 'ready'; token: number; url: string }
  | { status: 'failed'; token: number }

const refreshImagePreviews = StateEffect.define<void>()
const DEFAULT_BUFFER_CHARS = 2_000
const DEFAULT_PLACEHOLDER_HEIGHT = 120

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\()[\]<>])/g, '$1')
}

export function parseMarkdownImage(
  markdown: string,
): Pick<MarkdownImageMatch, 'alt' | 'src'> | null {
  const match =
    /^!\[((?:\\.|[^\\\]])*)\]\(\s*(?:<([^>\n]+)>|((?:\\.|[^\s)'"\\()]|\([^\s)]*\))+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)$/.exec(
      markdown,
    )
  const src = match?.[2] ?? match?.[3]
  return match && src ? { alt: unescapeMarkdown(match[1]), src: unescapeMarkdown(src) } : null
}

export function isRemoteImageSource(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src)
}

function mergedScanRanges(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  bufferChars: number,
): { from: number; to: number }[] {
  const expanded = ranges
    .map(({ from, to }) => ({
      from: state.doc.lineAt(Math.max(0, from - bufferChars)).from,
      to: state.doc.lineAt(Math.min(state.doc.length, to + bufferChars)).to,
    }))
    .sort((a, b) => a.from - b.from)
  const merged: { from: number; to: number }[] = []
  for (const range of expanded) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else merged.push(range)
  }
  return merged
}

export function findVisibleMarkdownImages(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  bufferChars = DEFAULT_BUFFER_CHARS,
): MarkdownImageMatch[] {
  const matches: MarkdownImageMatch[] = []
  const seen = new Set<number>()
  const tree = syntaxTree(state)
  for (const range of mergedScanRanges(state, visibleRanges, bufferChars)) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'Image' || seen.has(node.from)) return
        const parsed = parseMarkdownImage(state.doc.sliceString(node.from, node.to))
        if (!parsed) return
        const line = state.doc.lineAt(node.from)
        matches.push({
          ...parsed,
          from: node.from,
          to: node.to,
          block: line.text.trim() === state.doc.sliceString(node.from, node.to),
        })
        seen.add(node.from)
      },
    })
  }
  return matches.sort((a, b) => a.from - b.from)
}

function selectionTouches(state: EditorState, match: MarkdownImageMatch): boolean {
  return state.selection.ranges.some(({ from, to }) =>
    from === to ? from >= match.from && from <= match.to : from < match.to && to > match.from,
  )
}

class ImagePreviewWidget extends WidgetType {
  constructor(
    readonly match: MarkdownImageMatch,
    readonly url: string | null,
    readonly maxWidth: string,
    readonly placeholderHeight: number,
  ) {
    super()
  }

  eq(other: ImagePreviewWidget): boolean {
    return (
      this.match.src === other.match.src &&
      this.match.alt === other.match.alt &&
      this.match.block === other.match.block &&
      this.url === other.url &&
      this.maxWidth === other.maxWidth
    )
  }

  get estimatedHeight(): number {
    return this.match.block ? this.placeholderHeight : -1
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.match.block ? 'div' : 'span')
    element.className = `xmd-cm-image-preview${this.match.block ? ' is-block' : ' is-inline'}`
    element.dataset.xmdImage = this.match.src
    element.title = this.match.alt || this.match.src
    element.style.maxWidth = this.maxWidth
    if (this.match.block) element.style.minHeight = `${this.placeholderHeight}px`
    element.addEventListener('dblclick', () => {
      element.dispatchEvent(
        new CustomEvent('xmd-image-open', {
          bubbles: true,
          detail: { src: this.match.src, resolvedSrc: this.url },
        }),
      )
    })

    if (this.url) {
      const image = document.createElement('img')
      image.src = this.url
      image.alt = this.match.alt
      image.draggable = false
      image.style.maxWidth = '100%'
      image.style.display = this.match.block ? 'block' : 'inline-block'
      element.append(image)
    } else {
      element.classList.add('is-loading')
      element.setAttribute('aria-label', '图片加载中')
    }
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}

export function markdownImagePreview(options: MarkdownImagePreviewOptions) {
  const maxWidth =
    typeof options.maxWidth === 'number' ? `${options.maxWidth}px` : (options.maxWidth ?? '100%')
  const placeholderHeight = options.placeholderHeight ?? DEFAULT_PLACEHOLDER_HEIGHT
  const bufferChars = options.bufferChars ?? DEFAULT_BUFFER_CHARS

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private readonly cache = new Map<string, CacheEntry>()
      private requestToken = 0
      private documentVersion = 0
      private destroyed = false

      constructor(readonly view: EditorView) {
        this.decorations = this.buildDecorations()
      }

      update(update: ViewUpdate): void {
        if (update.docChanged) this.documentVersion++
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(refreshImagePreviews)),
          )
        ) {
          this.decorations = this.buildDecorations()
        }
      }

      destroy(): void {
        this.destroyed = true
        this.cache.clear()
      }

      private resolve(match: MarkdownImageMatch): CacheEntry {
        const existing = this.cache.get(match.src)
        if (existing) return existing
        if (!options.allowRemote && isRemoteImageSource(match.src)) {
          const failed: CacheEntry = { status: 'failed', token: ++this.requestToken }
          this.cache.set(match.src, failed)
          return failed
        }

        const token = ++this.requestToken
        const version = this.documentVersion
        const pending: CacheEntry = { status: 'pending', token }
        this.cache.set(match.src, pending)
        Promise.resolve()
          .then(() => options.resolveSrc(match.src))
          .then((url) => this.finishResolve(match.src, token, version, url))
          .catch(() => this.finishResolve(match.src, token, version, null))
        return pending
      }

      private finishResolve(src: string, token: number, version: number, url: string | null): void {
        if (this.destroyed || this.cache.get(src)?.token !== token) return
        if (version !== this.documentVersion) {
          this.cache.delete(src)
        } else {
          this.cache.set(src, url ? { status: 'ready', token, url } : { status: 'failed', token })
        }
        this.view.dispatch({ effects: refreshImagePreviews.of() })
      }

      private buildDecorations(): DecorationSet {
        const ranges = []
        for (const match of findVisibleMarkdownImages(
          this.view.state,
          this.view.visibleRanges,
          bufferChars,
        )) {
          if (selectionTouches(this.view.state, match)) continue
          const entry = this.resolve(match)
          // Failed resources fall back to their original Markdown source.
          if (entry.status === 'failed') continue
          const widget = new ImagePreviewWidget(
            match,
            entry.status === 'ready' ? entry.url : null,
            maxWidth,
            placeholderHeight,
          )
          ranges.push(Decoration.replace({ widget }).range(match.from, match.to))
        }
        return Decoration.set(ranges, true)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}
