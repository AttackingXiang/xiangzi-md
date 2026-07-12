import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type UIEvent,
} from 'react'
import Editor, { type EditorProps } from './Editor'
import { splitMarkdownIntoChunks } from '../lib/markdownChunker'
import { parseOutline } from '../lib/outline'
import { virtualSearchBridge } from '../lib/virtualSearchBridge'
import { searchMountedEditor } from '../lib/searchBridge'
import { virtualMarkdownWindow } from '../lib/virtualMarkdownWindow'
import {
  applyTextOperation,
  createLargeDocumentSnapshot,
  diffTextOperation,
  findLiteralMatches,
  invertTextOperation,
  rangeText,
  replaceAllLiterals,
  replaceLiteralAt,
  reorderMarkdownHeadingSections,
  type TextOperation,
} from '../features/large-document/model'
import { largeDocumentBridge } from '../features/large-document/bridge'
import { desktop } from '../platform'

const MIN_ESTIMATED_HEIGHT = 900
const PX_PER_CHAR_ESTIMATE = 1.15
const NAVIGATION_PREVIEW_CHARS = 5_000

type Props = Omit<EditorProps, 'content' | 'tagBar' | 'initialScrollTop' | 'onScrollTopChange'> & {
  content: string
  tagBar?: EditorProps['tagBar']
  initialScrollTop?: number
  onScrollTopChange?: (scrollTop: number) => void
}

interface VirtualOutlineNavigation {
  headingIndex: number
  markdownOffset: number
  searchQuery?: string
  skipHeadingAlignment?: boolean
}

interface NavigationPreview {
  chunkIndex: number
  content: string
  top: number
}

function estimateHeight(markdown: string): number {
  return Math.max(MIN_ESTIMATED_HEIGHT, markdown.length * PX_PER_CHAR_ESTIMATE)
}

export default function VirtualizedEditor({
  content,
  tagBar,
  initialScrollTop = 0,
  onScrollTopChange,
  onChange,
  documentKey,
  ...editorProps
}: Props): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const snapshotRef = useRef(createLargeDocumentSnapshot(content))
  const markdownRef = useRef(content)
  const lastEmittedRef = useRef(content)
  const observersRef = useRef(new Map<number, ResizeObserver>())
  const scrollSettleTimerRef = useRef<number | null>(null)
  const pendingOutlineRef = useRef<(VirtualOutlineNavigation & { chunkIndex: number }) | null>(null)
  const searchRef = useRef({ query: '', matches: [] as number[], index: -1 })
  const fullSelectionRef = useRef(false)
  const historyRef = useRef({ undo: [] as TextOperation[], redo: [] as TextOperation[] })
  // Keep this synchronously updated. React state updates are asynchronous, but
  // an editor being unmounted can emit its final delayed serialization during
  // the same commit that changed the authoritative source.
  const documentVersionRef = useRef(0)
  const [heights, setHeights] = useState(() =>
    snapshotRef.current.ranges.map((range) => estimateHeight(rangeText(content, range))),
  )
  const [contentRevision, setContentRevision] = useState(0)
  const [indexRevision, setIndexRevision] = useState(0)
  const [documentVersion, setDocumentVersion] = useState(0)
  const [viewport, setViewport] = useState({ top: initialScrollTop, height: 800 })
  const [preview, setPreview] = useState<NavigationPreview | null>(null)

  useEffect(() => {
    if (content === lastEmittedRef.current) return
    const next = createLargeDocumentSnapshot(content)
    snapshotRef.current = next
    markdownRef.current = content
    setHeights(next.ranges.map((range) => estimateHeight(rangeText(content, range))))
    setContentRevision((revision) => revision + 1)
    setIndexRevision((revision) => revision + 1)
    lastEmittedRef.current = content
    documentVersionRef.current += 1
    setDocumentVersion(documentVersionRef.current)
  }, [content])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    scroller.scrollTop = initialScrollTop
    setViewport({ top: scroller.scrollTop, height: scroller.clientHeight })
  }, [])

  useEffect(
    () => () => {
      observersRef.current.forEach((observer) => observer.disconnect())
      observersRef.current.clear()
      if (scrollSettleTimerRef.current !== null) clearTimeout(scrollSettleTimerRef.current)
    },
    [],
  )

  const offsets = useMemo(() => {
    const result = new Array<number>(heights.length + 1)
    result[0] = 0
    for (let i = 0; i < heights.length; i += 1) result[i + 1] = result[i] + heights[i]
    return result
  }, [heights])

  const sourceOffsets = useMemo(() => {
    return snapshotRef.current.sourceOffsets
  }, [heights.length, indexRevision])

  const visible = useMemo(() => {
    return virtualMarkdownWindow(offsets, viewport.top, viewport.height)
  }, [offsets, viewport])

  useEffect(() => {
    const navigate = (event: Event): void => {
      const detail = (event as CustomEvent<VirtualOutlineNavigation>).detail
      if (!detail) return
      let chunkIndex = 0
      while (
        chunkIndex + 1 < sourceOffsets.length - 1 &&
        detail.markdownOffset >= sourceOffsets[chunkIndex + 1]
      ) {
        chunkIndex += 1
      }
      pendingOutlineRef.current = { ...detail, chunkIndex }
      const chunkStart = sourceOffsets[chunkIndex]
      const chunkText = rangeText(markdownRef.current, snapshotRef.current.ranges[chunkIndex])
      const chunkLength = Math.max(1, chunkText.length)
      const ratio = Math.max(0, Math.min(1, (detail.markdownOffset - chunkStart) / chunkLength))
      const targetTop = offsets[chunkIndex] + heights[chunkIndex] * ratio
      const scroller = scrollerRef.current
      if (!scroller) return
      scroller.scrollTop = Math.max(0, targetTop - scroller.clientHeight * 0.25)
      setViewport({ top: scroller.scrollTop, height: scroller.clientHeight })
      onScrollTopChange?.(scroller.scrollTop)
      // A 5 KiB safe Markdown window gives navigation an immediate visual result.
      // The normal 10 KiB block replaces it after parsing completes.
      const parts = splitMarkdownIntoChunks(chunkText, NAVIGATION_PREVIEW_CHARS)
      let partStart = 0
      let part = parts[0] ?? ''
      const localOffset = detail.markdownOffset - chunkStart
      for (const candidate of parts) {
        if (localOffset < partStart + candidate.length + 1) {
          part = candidate
          break
        }
        partStart += candidate.length + 1
      }
      const partRatio = Math.max(
        0,
        Math.min(1, (localOffset - partStart) / Math.max(1, part.length)),
      )
      const partHeight = estimateHeight(part)
      const top = Math.max(
        offsets[chunkIndex],
        Math.min(
          offsets[chunkIndex] + heights[chunkIndex] - partHeight,
          targetTop - partHeight * partRatio,
        ),
      )
      setPreview({ chunkIndex, content: part, top })
    }
    window.addEventListener('xmd-virtual-outline-navigate', navigate)
    return () => window.removeEventListener('xmd-virtual-outline-navigate', navigate)
  }, [heights, offsets, onScrollTopChange, sourceOffsets])

  useEffect(() => {
    const navigateMatch = (): void => {
      const state = searchRef.current
      const markdownOffset = state.matches[state.index]
      if (markdownOffset === undefined) return
      window.dispatchEvent(
        new CustomEvent('xmd-virtual-outline-navigate', {
          detail: { headingIndex: 0, markdownOffset, searchQuery: state.query },
        }),
      )
    }
    virtualSearchBridge.set({
      find(query) {
        const matches = findLiteralMatches(markdownRef.current, query)
        searchRef.current = { query, matches, index: matches.length ? 0 : -1 }
        navigateMatch()
      },
      next() {
        const state = searchRef.current
        if (!state.matches.length) return
        state.index = (state.index + 1) % state.matches.length
        navigateMatch()
      },
      prev() {
        const state = searchRef.current
        if (!state.matches.length) return
        state.index = (state.index - 1 + state.matches.length) % state.matches.length
        navigateMatch()
      },
      replace(query, replacement) {
        const state = searchRef.current
        const offset = state.matches[state.index]
        if (offset === undefined) return
        const markdown = replaceLiteralAt(markdownRef.current, offset, query, replacement)
        applyFullMarkdown(markdown)
        const matches = findLiteralMatches(markdown, query)
        searchRef.current = {
          query,
          matches,
          index: matches.length ? Math.min(state.index, matches.length - 1) : -1,
        }
        navigateMatch()
      },
      replaceAll(query, replacement) {
        applyFullMarkdown(replaceAllLiterals(markdownRef.current, query, replacement))
        searchRef.current = { query, matches: [], index: -1 }
      },
      clear() {
        searchRef.current = { query: '', matches: [], index: -1 }
      },
    })
    return () => virtualSearchBridge.set(null)
  }, [])

  useEffect(() => {
    const pending = pendingOutlineRef.current
    if (!pending || !visible.includes(pending.chunkIndex)) return
    if (pending.skipHeadingAlignment) {
      pendingOutlineRef.current = null
      return
    }
    const headingsBeforeChunk = snapshotRef.current.ranges
      .slice(0, pending.chunkIndex)
      .reduce(
        (count, range) => count + parseOutline(rangeText(markdownRef.current, range)).length,
        0,
      )
    const localHeadingIndex = pending.headingIndex - headingsBeforeChunk
    let attempts = 0
    const align = (): void => {
      if (pendingOutlineRef.current !== pending) return
      const wrapper = document.querySelector<HTMLElement>(
        `.virtual-markdown-chunk[data-chunk-index="${pending.chunkIndex}"]`,
      )
      const headings = wrapper?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
      const heading = headings?.[localHeadingIndex]
      const scroller = scrollerRef.current
      if (pending.searchQuery && wrapper && scroller) {
        const chunkStart = sourceOffsets[pending.chunkIndex]
        const beforeMatch = rangeText(
          markdownRef.current,
          snapshotRef.current.ranges[pending.chunkIndex],
        ).slice(0, pending.markdownOffset - chunkStart)
        const localOccurrence =
          beforeMatch.toLocaleLowerCase().split(pending.searchQuery.toLocaleLowerCase()).length - 1
        searchMountedEditor(pending.searchQuery, localOccurrence)
        pendingOutlineRef.current = null
        return
      }
      if (heading && scroller) {
        window.dispatchEvent(new Event('xmd-navigate'))
        const top = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        scroller.scrollTop += top
        onScrollTopChange?.(scroller.scrollTop)
        pendingOutlineRef.current = null
        return
      }
      attempts += 1
      if (attempts < 120) requestAnimationFrame(align)
      else pendingOutlineRef.current = null
    }
    requestAnimationFrame(align)
  }, [onScrollTopChange, visible])

  const observeChunk = useCallback((index: number, element: HTMLDivElement | null): void => {
    observersRef.current.get(index)?.disconnect()
    observersRef.current.delete(index)
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const nextHeight = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
      if (nextHeight <= 0) return
      setHeights((current) => {
        if (Math.abs((current[index] ?? 0) - nextHeight) < 2) return current
        const next = [...current]
        next[index] = nextHeight
        return next
      })
    })
    observer.observe(element)
    observersRef.current.set(index, observer)
  }, [])

  const handleScroll = (event: UIEvent<HTMLDivElement>): void => {
    const scroller = event.currentTarget
    onScrollTopChange?.(scroller.scrollTop)
    // Do not create/destroy a complete Crepe instance for every scrollbar or
    // momentum-scroll event. The current chunk keeps scrolling normally; when a
    // large jump leaves its overscan area, mount only the final settled window.
    if (scrollSettleTimerRef.current !== null) clearTimeout(scrollSettleTimerRef.current)
    scrollSettleTimerRef.current = window.setTimeout(() => {
      scrollSettleTimerRef.current = null
      const nextViewport = { top: scroller.scrollTop, height: scroller.clientHeight }
      const nextWindow = virtualMarkdownWindow(offsets, nextViewport.top, nextViewport.height)
      // A track click or a large thumb drag lands outside the existing window.
      // Route it through the same 5 KiB preview pipeline as outline/search.
      if (!nextWindow.some((index) => visible.includes(index))) {
        const targetIndex = nextWindow[0] ?? 0
        const ratio = Math.max(
          0,
          Math.min(
            1,
            (nextViewport.top - offsets[targetIndex]) / Math.max(1, heights[targetIndex]),
          ),
        )
        window.dispatchEvent(
          new CustomEvent('xmd-virtual-outline-navigate', {
            detail: {
              headingIndex: 0,
              markdownOffset:
                sourceOffsets[targetIndex] +
                rangeText(markdownRef.current, snapshotRef.current.ranges[targetIndex]).length *
                  ratio,
              skipHeadingAlignment: true,
            },
          }),
        )
        return
      }
      setPreview(null)
      setViewport(nextViewport)
    }, 100)
  }

  const updateChunk = (index: number, markdown: string, baseVersion: number): void => {
    if (baseVersion !== documentVersionRef.current) {
      // A neighbouring/full-document operation changed the source after this
      // editor mounted. Do not apply an ambiguous stale serialization on top of
      // it; remount from the authoritative source instead.
      setContentRevision((revision) => revision + 1)
      return
    }
    const range = snapshotRef.current.ranges[index]
    if (!range) return
    const currentChunk = rangeText(markdownRef.current, range)
    const local = diffTextOperation(currentChunk, markdown)
    if (!local) return
    commitOperation(
      {
        from: range.from + local.from,
        to: range.from + local.to,
        inserted: local.inserted,
        deleted: local.deleted,
      },
      true,
      false,
    )
  }

  const clearFullSelection = (): void => {
    if (!fullSelectionRef.current) return
    fullSelectionRef.current = false
    scrollerRef.current?.classList.remove('virtual-select-all-active')
    scrollerRef.current
      ?.querySelectorAll('.wysiwyg-editor.select-all-active')
      .forEach((element) => element.classList.remove('select-all-active'))
  }

  const copyFullSelection = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (!fullSelectionRef.current) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', markdownRef.current)
  }

  const cutFullSelection = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (!fullSelectionRef.current || editorProps.readingMode) return
    copyFullSelection(event)
    clearFullSelection()
    applyFullMarkdown('')
  }

  const commitOperation = (
    operation: TextOperation,
    recordHistory = true,
    refreshMountedEditors = true,
  ): void => {
    const markdown = applyTextOperation(markdownRef.current, operation)
    if (markdown === markdownRef.current) return
    if (recordHistory) {
      historyRef.current.undo.push(operation)
      if (historyRef.current.undo.length > 500) historyRef.current.undo.shift()
      historyRef.current.redo = []
    }
    const snapshot = createLargeDocumentSnapshot(markdown)
    markdownRef.current = markdown
    snapshotRef.current = snapshot
    lastEmittedRef.current = markdown
    setHeights(snapshot.ranges.map((range) => estimateHeight(rangeText(markdown, range))))
    if (refreshMountedEditors) setContentRevision((revision) => revision + 1)
    setIndexRevision((revision) => revision + 1)
    documentVersionRef.current += 1
    setDocumentVersion(documentVersionRef.current)
    onChange(markdown)
  }

  const applyFullMarkdown = (markdown: string, recordHistory = true): void => {
    const operation = diffTextOperation(markdownRef.current, markdown)
    if (operation) commitOperation(operation, recordHistory)
  }

  useEffect(() => {
    largeDocumentBridge.set({
      reorderHeading(fromIndex, toIndex) {
        applyFullMarkdown(reorderMarkdownHeadingSections(markdownRef.current, fromIndex, toIndex))
      },
      selectAll() {
        fullSelectionRef.current = true
        scrollerRef.current
          ?.querySelectorAll('.wysiwyg-editor')
          .forEach((element) => element.classList.add('select-all-active'))
      },
      copy() {
        if (!fullSelectionRef.current) return false
        void desktop.writeClipboardText(markdownRef.current)
        return true
      },
      cut() {
        if (!fullSelectionRef.current || editorProps.readingMode) return false
        void desktop.writeClipboardText(markdownRef.current)
        fullSelectionRef.current = false
        scrollerRef.current?.classList.remove('virtual-select-all-active')
        applyFullMarkdown('')
        return true
      },
      undo() {
        const operation = historyRef.current.undo.pop()
        if (!operation) return false
        historyRef.current.redo.push(operation)
        commitOperation(invertTextOperation(operation), false)
        return true
      },
      redo() {
        const operation = historyRef.current.redo.pop()
        if (!operation) return false
        historyRef.current.undo.push(operation)
        commitOperation(operation, false)
        return true
      },
    })
    return () => largeDocumentBridge.set(null)
  }, [])

  return (
    <div
      className="virtual-wysiwyg-editor"
      ref={scrollerRef}
      onScroll={handleScroll}
      onPointerDown={clearFullSelection}
      onCopy={copyFullSelection}
      onCut={cutFullSelection}
    >
      <div className="virtual-wysiwyg-spacer" style={{ height: offsets.at(-1) ?? 0 }}>
        {(preview ? [preview.chunkIndex] : visible).map((index) => (
          <div
            className="virtual-markdown-chunk"
            data-chunk-index={index}
            key={`${documentKey}:${index}:${contentRevision}:${preview ? 'preview' : 'full'}`}
            ref={(element) => observeChunk(index, element)}
            style={{ transform: `translateY(${preview?.top ?? offsets[index]}px)` }}
          >
            <Editor
              {...editorProps}
              embedded
              sourceManaged
              content={
                preview?.content ??
                rangeText(markdownRef.current, snapshotRef.current.ranges[index])
              }
              documentKey={`${documentKey}#chunk-${index}`}
              tagBar={index === 0 ? tagBar : undefined}
              initialScrollTop={0}
              // Navigation preview is deliberately read-only: replacing it while
              // composing text would lose IME/undo state. The full block follows
              // immediately after its first render.
              readingMode={preview ? true : editorProps.readingMode}
              onReady={() => {
                if (!preview) return
                window.setTimeout(() => setPreview(null), 0)
              }}
              onChange={(markdown) => updateChunk(index, markdown, documentVersion)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
