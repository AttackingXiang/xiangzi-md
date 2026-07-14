import { syntaxTree } from '@codemirror/language'
import { StateEffect, type EditorState, type Extension } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import {
  Decoration,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'
import { copyImageElement } from '../../lib/richClipboard'
import { hiddenRangeSource, type HiddenRange } from './core/hiddenRanges'
import { decodeMarkdownReferenceText, resolveMarkdownReference } from './markdownReferences'

export interface MarkdownImageMatch {
  from: number
  to: number
  alt: string
  src: string
  title?: string
  block: boolean
}

export interface MarkdownImagePreviewOptions {
  resolveSrc: (src: string) => Promise<string | null> | string | null
  maxWidth?: number | string
  allowRemote?: boolean
  bufferChars?: number
  placeholderHeight?: number
  cacheEntries?: number
}

export function imagePreviewMaxWidth(value: number | string | undefined): string {
  if (typeof value !== 'number') return value ?? '100%'
  return value > 0 ? `${value}px` : '100%'
}

type CacheEntry =
  | { status: 'pending'; token: number }
  | { status: 'ready'; token: number; url: string }
  | { status: 'failed'; token: number }

const refreshImagePreviews = StateEffect.define<void>()
const DEFAULT_BUFFER_CHARS = 2_000
const DEFAULT_PLACEHOLDER_HEIGHT = 120
const DEFAULT_CACHE_ENTRIES = 256
const IMAGE_DIMENSION_STORAGE_KEY = 'xmd:image-dimensions:v1'
const MAX_STORED_IMAGE_DIMENSIONS = 256

export interface ImageDimensions {
  width: number
  height: number
}

const imageDimensionCache = new Map<string, ImageDimensions>()
let imageDimensionsHydrated = false

function imageDimensionStorage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function validImageDimensions(value: unknown): value is ImageDimensions {
  if (typeof value !== 'object' || value === null) return false
  const { width, height } = value as Partial<ImageDimensions>
  return (
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
  )
}

function hydrateImageDimensions(): void {
  if (imageDimensionsHydrated) return
  imageDimensionsHydrated = true
  const storage = imageDimensionStorage()
  if (!storage) return
  try {
    const entries = JSON.parse(storage.getItem(IMAGE_DIMENSION_STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(entries)) return
    for (const entry of entries.slice(-MAX_STORED_IMAGE_DIMENSIONS)) {
      if (!Array.isArray(entry)) continue
      const values = entry as unknown[]
      const url = values[0]
      if (typeof url !== 'string') continue
      const dimensions: unknown = { width: values[1], height: values[2] }
      if (validImageDimensions(dimensions)) imageDimensionCache.set(url, dimensions)
    }
  } catch {
    // Corrupt or unavailable view metadata must never prevent image rendering.
  }
}

function persistImageDimensions(): void {
  const storage = imageDimensionStorage()
  if (!storage) return
  try {
    storage.setItem(
      IMAGE_DIMENSION_STORAGE_KEY,
      JSON.stringify(
        [...imageDimensionCache.entries()].map(([url, dimensions]) => [
          url,
          dimensions.width,
          dimensions.height,
        ]),
      ),
    )
  } catch {
    // Persistence is an optimization. Rendering still works without storage.
  }
}

export function cachedImageDimensions(url: string): ImageDimensions | null {
  hydrateImageDimensions()
  const dimensions = imageDimensionCache.get(url)
  if (!dimensions) return null
  // Refresh insertion order so trimming behaves like a small LRU cache.
  imageDimensionCache.delete(url)
  imageDimensionCache.set(url, dimensions)
  return dimensions
}

export function rememberImageDimensions(url: string, dimensions: ImageDimensions): void {
  if (!url || !validImageDimensions(dimensions)) return
  hydrateImageDimensions()
  const normalized = {
    width: Math.round(dimensions.width),
    height: Math.round(dimensions.height),
  }
  const previous = imageDimensionCache.get(url)
  imageDimensionCache.delete(url)
  imageDimensionCache.set(url, normalized)
  while (imageDimensionCache.size > MAX_STORED_IMAGE_DIMENSIONS) {
    const oldest = imageDimensionCache.keys().next().value
    if (typeof oldest !== 'string') break
    imageDimensionCache.delete(oldest)
  }
  if (previous?.width !== normalized.width || previous.height !== normalized.height) {
    persistImageDimensions()
  }
}

function applyBlockImageDimensions(element: HTMLElement, dimensions: ImageDimensions): void {
  element.style.width = `${dimensions.width}px`
  element.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`
  element.classList.remove('is-unmeasured')
}

export function parseMarkdownImage(
  markdown: string,
): Pick<MarkdownImageMatch, 'alt' | 'src' | 'title'> | null {
  const match =
    /^!\[((?:\\.|[^\\\]])*)\]\(\s*(?:<((?:\\.|[^>\n])+)>|((?:\\.|[^\s)'"\\()]|\([^\s)]*\))+))(?:\s+(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|\(((?:\\.|[^)])*)\)))?\s*\)$/.exec(
      markdown,
    )
  const src = match?.[2] ?? match?.[3]
  const title = match?.[4] ?? match?.[5] ?? match?.[6]
  return match && src
    ? {
        alt: decodeMarkdownReferenceText(match[1]),
        src: decodeMarkdownReferenceText(src),
        ...(title === undefined ? {} : { title: decodeMarkdownReferenceText(title) }),
      }
    : null
}

function directChildren(node: SyntaxNode, name: string): SyntaxNode[] {
  const children: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) children.push(child)
  }
  return children
}

/** Resolve full, collapsed and shortcut reference-style image source. */
export function parseMarkdownReferenceImage(
  state: EditorState,
  node: SyntaxNode,
): Pick<MarkdownImageMatch, 'alt' | 'src' | 'title'> | null {
  if (node.name !== 'Image') return null
  const marks = directChildren(node, 'LinkMark')
  if (marks.length < 2) return null
  const alt = decodeMarkdownReferenceText(state.doc.sliceString(marks[0].to, marks[1].from))
  const labelNode = directChildren(node, 'LinkLabel')[0]
  const explicitLabel = labelNode
    ? state.doc.sliceString(labelNode.from + 1, Math.max(labelNode.from + 1, labelNode.to - 1))
    : null
  const definition = resolveMarkdownReference(state, explicitLabel, alt)
  return definition
    ? {
        alt,
        src: definition.destination,
        ...(definition.title === undefined ? {} : { title: definition.title }),
      }
    : null
}

export function isRemoteImageSource(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src)
}

/** Reject active/non-image protocols before either the resolver or the DOM sees them. */
export function isSafeImageSource(src: string): boolean {
  const value = src.trim()
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return false
  if (value.startsWith('//')) return true
  if (/^[a-z]:[\\/]/i.test(value)) return true
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1]?.toLowerCase()
  if (!scheme) return true
  // `resolveAssetURL` maps desktop-local files to the read-only `xmd://`
  // protocol served by Tauri. It is an image transport just like Tauri's
  // built-in `asset://` protocol and must survive the post-resolution check.
  if (['http', 'https', 'blob', 'file', 'asset', 'xmd'].includes(scheme)) return true
  return scheme === 'data' && /^data:image\/(?:avif|gif|jpe?g|png|webp|svg\+xml)[;,]/i.test(value)
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
        const parsed =
          parseMarkdownImage(state.doc.sliceString(node.from, node.to)) ??
          parseMarkdownReferenceImage(state, node.node)
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

/**
 * The single source of atomic/hidden ranges this feature contributes to the
 * core engine (`core/hiddenRanges.ts`), replacing the standalone
 * `EditorView.atomicRanges` provider this module used to maintain directly
 * off its own decoration `ViewPlugin`. An `Image` node's span is registered
 * with `paint: false` since the `ViewPlugin` below already paints the
 * `ImagePreviewWidget` replacement over the same range.
 *
 * Only the *synchronously* determinable fallback-to-source cases —
 * `isSafeImageSource` rejecting the scheme, or a remote source when
 * `allowRemote` is off — are excluded here, matching `buildDecorations`
 * exactly for those. A source that looks safe but whose network/blob
 * resolution later fails asynchronously is intentionally still atomic: that
 * result lives in the `ViewPlugin`'s private per-view cache, not in
 * `EditorState`, so it is not visible to this state-only builder. See
 * core/README.md's Phase 4 checklist for the resulting (narrow) known gap.
 */
export function collectImageHiddenRanges(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  options: Pick<MarkdownImagePreviewOptions, 'allowRemote' | 'bufferChars'> = {},
): HiddenRange[] {
  const bufferChars = options.bufferChars ?? DEFAULT_BUFFER_CHARS
  const hidden: HiddenRange[] = []
  for (const match of findVisibleMarkdownImages(state, visibleRanges, bufferChars)) {
    if (!isSafeImageSource(match.src)) continue
    if (!options.allowRemote && isRemoteImageSource(match.src)) continue
    hidden.push({ from: match.from, to: match.to, paint: false })
  }
  return hidden
}

export class ImagePreviewWidget extends WidgetType {
  constructor(
    readonly match: MarkdownImageMatch,
    readonly url: string | null,
    readonly maxWidth: string,
    readonly placeholderHeight: number,
    readonly onLoadError?: (url: string) => void,
    readonly owner?: object,
  ) {
    super()
  }

  eq(other: ImagePreviewWidget): boolean {
    return (
      this.match.from === other.match.from &&
      this.match.to === other.match.to &&
      this.match.src === other.match.src &&
      this.match.alt === other.match.alt &&
      this.match.title === other.match.title &&
      this.match.block === other.match.block &&
      this.url === other.url &&
      this.maxWidth === other.maxWidth &&
      this.placeholderHeight === other.placeholderHeight &&
      this.owner === other.owner
    )
  }

  get estimatedHeight(): number {
    return this.match.block ? this.placeholderHeight : -1
  }

  toDOM(view?: EditorView): HTMLElement {
    const element = document.createElement(this.match.block ? 'div' : 'span')
    element.className = `xmd-cm-image-preview${this.match.block ? ' is-block' : ' is-inline'}`
    element.dataset.xmdImage = this.match.src
    element.title = this.match.title || this.match.alt || this.match.src
    element.style.setProperty('--xmd-image-max-width', this.maxWidth)
    if (this.match.block) {
      element.style.setProperty('--xmd-image-placeholder-height', `${this.placeholderHeight}px`)
      const dimensions = this.url ? cachedImageDimensions(this.url) : null
      if (dimensions) applyBlockImageDimensions(element, dimensions)
      else element.classList.add('is-unmeasured')
    }
    element.tabIndex = 0
    element.setAttribute('role', 'group')
    element.setAttribute('aria-label', this.match.alt || this.match.title || this.match.src)
    const dispatchOpen = (): void => {
      element.dispatchEvent(
        new CustomEvent('xmd-image-open', {
          bubbles: true,
          detail: { src: this.match.src, resolvedSrc: this.url },
        }),
      )
    }
    element.addEventListener('click', () => element.focus())
    element.addEventListener('dblclick', dispatchOpen)
    element.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        const image = element.querySelector('img')
        if (!image) return
        event.preventDefault()
        void copyImageElement(image)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        if (!view || view.state.readOnly) return
        event.preventDefault()
        view.dispatch({
          changes: { from: this.match.from, to: this.match.to },
          selection: { anchor: this.match.from },
          userEvent: event.key === 'Backspace' ? 'delete.backward' : 'delete.forward',
        })
        view.focus()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        view?.focus()
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        dispatchOpen()
      }
    })

    if (this.url) {
      const image = document.createElement('img')
      image.alt = this.match.alt
      if (this.match.title) image.title = this.match.title
      image.draggable = false
      image.style.maxWidth = '100%'
      image.style.height = 'auto'
      image.style.display = this.match.block ? 'block' : 'inline-block'
      element.classList.add('is-loading')
      const finishLoad = (): void => {
        if (this.match.block && image.naturalWidth > 0 && image.naturalHeight > 0) {
          const dimensions = { width: image.naturalWidth, height: image.naturalHeight }
          rememberImageDimensions(this.url!, dimensions)
          applyBlockImageDimensions(element, dimensions)
        }
        element.classList.remove('is-loading')
        view?.requestMeasure()
      }
      image.addEventListener('load', finishLoad)
      image.addEventListener('error', () => {
        this.onLoadError?.(this.url!)
        view?.requestMeasure()
      })
      image.src = this.url
      element.append(image)
      if (image.complete && image.naturalWidth > 0) finishLoad()
      if (this.match.block) {
        const copy = document.createElement('button')
        copy.type = 'button'
        copy.className = 'xmd-cm-preview-copy'
        copy.textContent = '复制图片'
        copy.setAttribute('aria-label', '复制图片')
        copy.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          void copyImageElement(image).then((copied) => {
            copy.dataset.copyState = copied ? 'success' : 'error'
            copy.textContent = copied ? '已复制' : '复制失败'
            window.setTimeout(() => {
              copy.dataset.copyState = ''
              copy.textContent = '复制图片'
            }, 1_500)
          })
        })
        element.append(copy)
      }
    } else {
      element.classList.add('is-loading')
      element.setAttribute('aria-label', '图片加载中')
    }
    return element
  }

  ignoreEvent(): boolean {
    // The preview is an interactive surface. Letting CM6 handle its mouse events
    // moves the selection into the replaced Markdown range and makes the preview
    // disappear before the user can zoom, copy, or use its native image menu.
    return true
  }
}

export function markdownImagePreview(options: MarkdownImagePreviewOptions): Extension {
  const maxWidth = imagePreviewMaxWidth(options.maxWidth)
  const placeholderHeight = options.placeholderHeight ?? DEFAULT_PLACEHOLDER_HEIGHT
  const bufferChars = options.bufferChars ?? DEFAULT_BUFFER_CHARS

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      private readonly cache = new Map<string, CacheEntry>()
      private requestToken = 0
      private destroyed = false

      constructor(readonly view: EditorView) {
        this.decorations = this.buildDecorations()
      }

      update(update: ViewUpdate): void {
        const syntaxTreeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
        if (
          update.docChanged ||
          update.viewportChanged ||
          syntaxTreeChanged ||
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
        if (
          !isSafeImageSource(match.src) ||
          (!options.allowRemote && isRemoteImageSource(match.src))
        ) {
          const failed: CacheEntry = { status: 'failed', token: ++this.requestToken }
          this.cache.set(match.src, failed)
          return failed
        }

        const token = ++this.requestToken
        const pending: CacheEntry = { status: 'pending', token }
        this.cache.set(match.src, pending)
        Promise.resolve()
          .then(() => options.resolveSrc(match.src))
          .then((url) => this.finishResolve(match.src, token, url))
          .catch(() => this.finishResolve(match.src, token, null))
        return pending
      }

      private finishResolve(src: string, token: number, url: string | null): void {
        if (this.destroyed || this.cache.get(src)?.token !== token) return
        this.cache.set(
          src,
          url && isSafeImageSource(url)
            ? { status: 'ready', token, url }
            : { status: 'failed', token },
        )
        this.view.dispatch({ effects: refreshImagePreviews.of() })
      }

      private failResolvedImage(src: string, url: string): void {
        if (this.destroyed) return
        const entry = this.cache.get(src)
        if (entry?.status !== 'ready' || entry.url !== url) return
        this.cache.set(src, { status: 'failed', token: entry.token })
        this.view.dispatch({ effects: refreshImagePreviews.of() })
      }

      private trimCache(preserve: ReadonlySet<string> = new Set()): void {
        const limit = Math.max(1, options.cacheEntries ?? DEFAULT_CACHE_ENTRIES)
        if (this.cache.size <= limit) return
        for (const key of this.cache.keys()) {
          if (this.cache.size <= limit) break
          if (!preserve.has(key)) this.cache.delete(key)
        }
      }

      private buildDecorations(): DecorationSet {
        const ranges = []
        const matches = findVisibleMarkdownImages(
          this.view.state,
          this.view.visibleRanges,
          bufferChars,
        )
        const visibleSources = new Set(matches.map((match) => match.src))
        for (const match of matches) {
          const entry = this.resolve(match)
          // Failed resources fall back to their original Markdown source.
          if (entry.status === 'failed') continue
          const widget = new ImagePreviewWidget(
            match,
            entry.status === 'ready' ? entry.url : null,
            maxWidth,
            placeholderHeight,
            entry.status === 'ready' ? (url) => this.failResolvedImage(match.src, url) : undefined,
            this,
          )
          ranges.push(Decoration.replace({ widget }).range(match.from, match.to))
        }
        this.trimCache(visibleSources)
        return Decoration.set(ranges, true)
      }
    },
    { decorations: (instance) => instance.decorations },
  )
  return [
    plugin,
    hiddenRangeSource.of(({ state, visibleRanges }) =>
      collectImageHiddenRanges(state, visibleRanges, {
        allowRemote: options.allowRemote,
        bufferChars,
      }),
    ),
  ]
}
