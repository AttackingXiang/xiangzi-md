import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'
import {
  EditorState,
  Prec,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view'
import { hiddenRangeSource, type HiddenRange } from './core/hiddenRanges'
import type { PreviewRange } from './core/types'
import { viewportDecorationExtension } from './viewportDecorations'
import { checkIcon, copyIcon } from './widgetIcons'
import {
  matchingCodeLanguageOptions,
  normalizedLanguageValue,
  resolveCodeLanguageInput,
} from './codeBlockLanguage'
import type { CodeLanguageOption } from './codeBlockLanguage'
import {
  CODE_CONTROLS_HEIGHT,
  CODE_CONTROLS_INSET,
  CODE_CONTROLS_MARGIN,
  CODE_SCROLLBAR_HEIGHT,
  CODE_SCROLLBAR_INSET,
  CODE_SCROLLBAR_MARGIN,
  codeContentCaretX,
  createCodeScrollbarElement,
  mountedCodeBlockAt,
  pinnedOverlayTop,
  resolveCodeControlsGutter,
} from './codeBlockGeometry'
import type { MountedCodeBlock, OverlayPinGeometry } from './codeBlockGeometry'

export { pinnedOverlayTop } from './codeBlockGeometry'
export type { OverlayPinGeometry } from './codeBlockGeometry'

export {
  codeLanguageOptions,
  matchingCodeLanguageOptions,
  resolveCodeLanguageInput,
} from './codeBlockLanguage'

export interface CodeBlockPreviewOptions {
  viewportMargin?: number
  maxHeight?: number
  copyLabel?: string
  copiedLabel?: string
  /** Wrap long code lines. Disabled by default so source layout is preserved. */
  lineWrapping?: boolean
}

interface FencedCodeData {
  from: number
  to: number
  language: string
  languageFrom: number
  languageTo: number
  codeFrom: number
  codeTo: number
  firstCodeLineFrom: number
  lastCodeLineFrom: number
  closingFrom: number | null
}

let codeLanguageMenuSequence = 0

/**
 * The copy/language controls for the active code block. This is no longer a
 * `WidgetType` mounted on the opening fence line: CM6 only renders lines
 * inside the viewport (plus margin), so a fence-anchored widget disappears
 * from the DOM entirely while the user edits the middle of a code block
 * taller than the screen. Instead, a single overlay instance is appended to
 * `view.scrollDOM` — the same officially sanctioned mount point
 * `@codemirror/view` uses for its own layers, panels and drop cursor — and
 * `CodeBlockScrollPlugin` pins it to the visible part of the active block on
 * every measure pass (see `pinnedOverlayTop`).
 */
class CodeBlockControlsOverlay {
  readonly dom: HTMLElement
  /** Point the overlay at a (possibly different) block. Called from the
   * measure write phase, so it must only write DOM, never read layout. */
  readonly setBlock: (data: FencedCodeData, readOnly: boolean) => void

  constructor(view: EditorView, copyLabel: string, copiedLabel: string) {
    /** `from` of the block the controls currently operate on. */
    let blockFrom = -1
    /** Last language committed to (or read from) the document; what Escape
     * restores. Replaces the per-widget `initialLanguage` capture. */
    let committedLanguage = ''

    const header = document.createElement('span')
    header.className = 'xmd-cm-code-preview-header'
    // Parked off-screen until the first measure pass positions it.
    header.style.top = '-9999px'

    const language = document.createElement('input')
    language.className = 'xmd-cm-code-preview-language'
    language.type = 'text'
    language.autocomplete = 'off'
    language.spellcheck = false
    language.setAttribute('aria-label', 'Code language')
    language.value = 'text'
    const menuId = `xmd-code-languages-${++codeLanguageMenuSequence}`
    const menu = document.createElement('span')
    menu.className = 'xmd-cm-code-language-menu'
    menu.id = menuId
    menu.hidden = true
    menu.setAttribute('role', 'listbox')
    menu.setAttribute('aria-label', 'Code language suggestions')
    language.setAttribute('role', 'combobox')
    language.setAttribute('aria-autocomplete', 'list')
    language.setAttribute('aria-controls', menuId)
    language.setAttribute('aria-expanded', 'false')
    let visibleSuggestions: readonly CodeLanguageOption[] = []
    let activeSuggestion = -1
    const resizeLanguageInput = (editing: boolean): void => {
      const extraCharacters = editing ? 3 : 1
      const characters = Math.min(18, Math.max(5, language.value.length + extraCharacters))
      language.style.width = `${characters}ch`
    }
    const commitLanguage = (restoreEditorFocus: boolean): void => {
      if (view.state.readOnly) return
      const typed = language.value.trim()
      const nextLanguage = resolveCodeLanguageInput(typed)
      const current = findFencedCodeAt(view.state, blockFrom)
      if (!current) return
      if (nextLanguage !== normalizedLanguageValue(current.language)) {
        view.dispatch({
          changes: {
            from: current.languageFrom,
            to: current.languageTo,
            insert: nextLanguage,
          },
        })
      }
      if (restoreEditorFocus) view.focus()
    }
    const closeSuggestions = (): void => {
      menu.hidden = true
      menu.replaceChildren()
      visibleSuggestions = []
      activeSuggestion = -1
      language.setAttribute('aria-expanded', 'false')
      language.removeAttribute('aria-activedescendant')
    }
    const chooseSuggestion = (entry: CodeLanguageOption): void => {
      language.value = entry.value || 'text'
      resizeLanguageInput(true)
      closeSuggestions()
      commitLanguage(true)
    }
    const updateActiveSuggestion = (next: number): void => {
      if (visibleSuggestions.length === 0) return
      activeSuggestion = (next + visibleSuggestions.length) % visibleSuggestions.length
      for (const [index, option] of Array.from(menu.children).entries()) {
        const active = index === activeSuggestion
        option.classList.toggle('is-active', active)
        option.setAttribute('aria-selected', active ? 'true' : 'false')
        if (active) {
          language.setAttribute('aria-activedescendant', option.id)
          option.scrollIntoView({ block: 'nearest' })
        }
      }
    }
    const renderSuggestions = (): void => {
      visibleSuggestions = matchingCodeLanguageOptions(language.value)
      activeSuggestion = -1
      menu.replaceChildren()
      if (visibleSuggestions.length === 0 || view.state.readOnly) {
        closeSuggestions()
        return
      }
      for (const [index, entry] of visibleSuggestions.entries()) {
        const option = document.createElement('span')
        option.className = 'xmd-cm-code-language-option'
        option.id = `${menuId}-${index}`
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', 'false')
        option.textContent = entry.value || 'text'
        option.addEventListener('pointerdown', (event) => {
          event.preventDefault()
          event.stopPropagation()
          chooseSuggestion(entry)
        })
        menu.append(option)
      }
      menu.hidden = false
      language.setAttribute('aria-expanded', 'true')
    }
    language.addEventListener('focus', () => {
      resizeLanguageInput(true)
      if (!view.state.selection.main.empty) {
        view.dispatch({ selection: { anchor: view.state.selection.main.head } })
      }
      language.select()
      renderSuggestions()
    })
    language.addEventListener('input', () => {
      resizeLanguageInput(true)
      renderSuggestions()
    })
    language.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' && visibleSuggestions.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        updateActiveSuggestion(activeSuggestion + 1)
      } else if (event.key === 'ArrowUp' && visibleSuggestions.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        updateActiveSuggestion(
          activeSuggestion <= 0 ? visibleSuggestions.length - 1 : activeSuggestion - 1,
        )
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        const suggestion = visibleSuggestions[activeSuggestion]
        if (suggestion) chooseSuggestion(suggestion)
        else {
          closeSuggestions()
          commitLanguage(true)
        }
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeSuggestions()
        language.value = committedLanguage || 'text'
        view.focus()
      }
    })
    language.addEventListener('change', () => commitLanguage(true))
    language.addEventListener('blur', () => {
      commitLanguage(false)
      closeSuggestions()
      resizeLanguageInput(false)
    })
    resizeLanguageInput(false)

    const copy = document.createElement('button')
    copy.className = 'xmd-cm-code-preview-copy'
    copy.type = 'button'
    copy.setAttribute('aria-label', copyLabel)
    copy.title = copyLabel
    copy.append(copyIcon())
    copy.addEventListener('click', () => {
      const current = findFencedCodeAt(view.state, blockFrom)
      if (!current || !globalThis.navigator?.clipboard) return
      const code = view.state.doc.sliceString(current.codeFrom, current.codeTo)
      void navigator.clipboard.writeText(code).then(
        () => {
          copy.replaceChildren(checkIcon())
          copy.title = copiedLabel
          copy.setAttribute('aria-label', copiedLabel)
          window.setTimeout(() => {
            if (!copy.isConnected) return
            copy.replaceChildren(copyIcon())
            copy.title = copyLabel
            copy.setAttribute('aria-label', copyLabel)
          }, 1200)
        },
        () => {
          copy.replaceChildren(copyIcon())
          copy.title = copyLabel
          copy.setAttribute('aria-label', copyLabel)
        },
      )
    })

    header.append(language, menu, copy)
    this.dom = header
    this.setBlock = (data, readOnly) => {
      blockFrom = data.from
      const normalized = normalizedLanguageValue(data.language)
      committedLanguage = normalized
      language.disabled = readOnly
      // Never fight an in-progress edit: only mirror document state into the
      // input while focus is outside the overlay.
      if (!header.contains(document.activeElement)) {
        const nextValue = normalized || 'text'
        if (language.value !== nextValue) {
          language.value = nextValue
          resizeLanguageInput(false)
        }
      }
    }
  }

  destroy(): void {
    this.dom.remove()
  }
}

interface FenceClassMeasure {
  fence: HTMLElement
  active: boolean
}

interface ActiveBlockMeasure {
  data: FencedCodeData
  readOnly: boolean
  /** Rendered content scrollers of the active block, with their scroll
   * offsets captured during the read phase (reading `scrollLeft` in the
   * write phase would force layout). */
  contents: HTMLElement[]
  contentScrollLefts: number[]
  contentWidth: number
  /** Width of the scrollbar track (row width minus its horizontal insets). */
  trackWidth: number
  scrollLeft: number
  revealScrollLeft: number | null
  overflow: boolean
  /** Pinned overlay positions in scroller content space; `null` while the
   * block does not intersect the viewport (overlay hidden). */
  controlsTop: number | null
  /** Right-edge anchor for the controls (they render right-aligned on this
   * `left` via `translateX(-100%)`, so input-width changes between measure
   * passes keep the right edge fixed). */
  controlsAnchorLeft: number
  scrollbarTop: number | null
  scrollbarLeft: number
}

interface CodeScrollMeasure {
  fences: FenceClassMeasure[]
  active: ActiveBlockMeasure | null
}

/** The fenced code block owning the primary selection head, when it is an
 * editable (non-Mermaid) block — the block the singleton overlays serve. */
function activeEditableFencedCode(state: EditorState): FencedCodeData | null {
  const data = fencedCodeAtSelection(state)
  return data !== null && data.language.toLowerCase() !== 'mermaid' ? data : null
}

/** Keeps every source row full-width while synchronizing their hidden
 * horizontal scrollers with one visible scrollbar pinned near the bottom of
 * the card's visible part, and pins the copy/language controls near its top.
 * Both overlays are plugin-owned `view.scrollDOM` children (see
 * `CodeBlockControlsOverlay`), so they remain reachable while CM6's
 * virtualized viewport has dropped the fence lines of a block taller than
 * the screen — the situation that used to make both widgets vanish. */
class CodeBlockScrollPlugin {
  private syncing = false
  private frame = 0
  private repaintFrame = 0
  private revealPending = true
  private drag: { scrollbar: HTMLElement; pointerId: number; offset: number } | null = null
  private readonly controls: CodeBlockControlsOverlay
  private readonly scrollbar: HTMLElement | null
  // A single stable request object: `view.requestMeasure` deduplicates by
  // object identity (see `measureRequests.indexOf` in @codemirror/view's
  // EditorView.requestMeasure), so repeated `schedule()` calls within one
  // frame coalesce into a single read/write pass.
  private readonly measureRequest = {
    read: (view: EditorView): CodeScrollMeasure => this.readMeasure(view),
    write: (measure: CodeScrollMeasure): void => this.writeMeasure(measure),
  }

  constructor(
    readonly view: EditorView,
    options: CodeBlockPreviewOptions = {},
  ) {
    this.controls = new CodeBlockControlsOverlay(
      view,
      options.copyLabel ?? 'Copy',
      options.copiedLabel ?? 'Copied',
    )
    view.scrollDOM.appendChild(this.controls.dom)
    this.scrollbar = options.lineWrapping ? null : createCodeScrollbarElement()
    if (this.scrollbar) {
      this.scrollbar.addEventListener('pointerdown', this.onPointerDown)
      this.scrollbar.addEventListener('keydown', this.onKeyDown)
      view.scrollDOM.appendChild(this.scrollbar)
    }
    // Nested code-line scrollers emit non-bubbling `scroll` events, so listen
    // in the capture phase. Listening on scrollDOM (not contentDOM) also
    // catches the editor's own scrolling, which must re-pin the overlays even
    // when the viewport (plus margin) is unchanged and CM6 therefore
    // dispatches no view update.
    view.scrollDOM.addEventListener('scroll', this.onScroll, true)
    this.updateSelectionPresentation(view.state)
    this.schedule()
    this.frame = requestAnimationFrame(() => this.schedule())
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) this.updateSelectionPresentation(update.state)
    // Reveal-scrolling (keeping the caret visible inside the nested
    // scrollers) only follows caret/content/geometry changes — never plain
    // scrolling, which would yank a deliberately scrolled-away row back to
    // the caret on the next measure pass.
    if (update.docChanged || update.selectionSet || update.geometryChanged) {
      this.revealPending = true
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.geometryChanged ||
      update.startState.readOnly !== update.state.readOnly
    ) {
      this.schedule()
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.repaintFrame)
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll, true)
    this.view.dom.classList.remove('xmd-cm-native-code-selection')
    this.view.dom.classList.remove('xmd-cm-native-code-caret')
    this.stopDragging()
    this.controls.destroy()
    this.scrollbar?.remove()
  }

  private readonly onScroll = (event: Event): void => {
    if (event.target === this.view.scrollDOM) {
      // Outer scrolling moves the viewport the overlays are pinned against.
      this.schedule()
      return
    }
    if (this.syncing || !(event.target instanceof HTMLElement)) return
    const source = event.target
    if (!source.classList.contains('xmd-cm-code-line-content')) return
    this.syncFrom(source)
  }

  private updateSelectionPresentation(state: EditorState): void {
    this.view.dom.classList.toggle(
      'xmd-cm-native-code-selection',
      selectionIntersectsFencedCode(state),
    )
    this.view.dom.classList.toggle('xmd-cm-native-code-caret', caretInsideFencedCode(state))
  }

  private syncFrom(source: HTMLElement): void {
    const line = source.closest<HTMLElement>('.cm-line.xmd-cm-code-line')
    if (!line) return
    const block = mountedCodeBlockAt(line)
    this.syncing = true
    for (const target of block.contents) {
      if (target !== source && target.scrollLeft !== source.scrollLeft)
        target.scrollLeft = source.scrollLeft
    }
    this.syncing = false
    const first = block.lines[0]
    if (this.scrollbar && first && this.lineInActiveBlock(first))
      this.updateThumb(this.scrollbar, source.scrollLeft)
    // A nested scrollLeft changed outside a view update; see
    // `queueSecondaryCaretRepaint` (this also covers scrolled rows of a
    // *non-active* block that a secondary multi-cursor caret may sit in).
    this.queueSecondaryCaretRepaint()
  }

  private lineInActiveBlock(line: HTMLElement): boolean {
    const data = activeEditableFencedCode(this.view.state)
    if (!data) return false
    const pos = this.view.posAtDOM(line, 0)
    return pos >= data.from && pos <= data.to
  }

  /** The rendered lines of the active block. Looked up per call — CM6
   * recycles line DOM, so long-lived element references would go stale. */
  private activeMountedBlock(data: FencedCodeData): MountedCodeBlock | null {
    for (const line of this.view.contentDOM.querySelectorAll<HTMLElement>(
      '.cm-line.xmd-cm-code-line',
    )) {
      // Only probe the first line of each contiguous run of code rows.
      if (
        line.previousElementSibling instanceof HTMLElement &&
        line.previousElementSibling.classList.contains('xmd-cm-code-line')
      )
        continue
      const pos = this.view.posAtDOM(line, 0)
      if (pos >= data.from && pos <= data.to) return mountedCodeBlockAt(line)
    }
    return null
  }

  /**
   * Task-scoped mitigation for stale secondary carets: CM6's `drawSelection`
   * cursor layer re-measures its markers only during a view update —
   * `LayerView.update` schedules a measure when `cursorLayer.update()`
   * returns true, i.e. on `update.docChanged || update.selectionSet` (or a
   * config change), plus `update.geometryChanged` (see `cursorLayer` and
   * `LayerView.update` in node_modules/@codemirror/view/dist/index.js). A
   * nested code-row `scrollLeft` moving *outside* an update — scrollbar
   * drag/keyboard, `syncFrom`, a reveal-scroll write — therefore leaves
   * secondary multi-cursor carets (`.cm-cursor-secondary`) painted at stale
   * coordinates. The primary caret is unaffected: it is the browser-native
   * one while inside a code body (`caretInsideFencedCode`), and with
   * multiple ranges CM6 keeps drawing but the same repaint fixes it too.
   * Re-dispatching the current selection unchanged is the lightest public
   * trigger that sets `update.selectionSet`; an empty `view.dispatch({})`
   * sets neither flag and repaints nothing. Strictly gated by
   * `needsSecondaryCaretRepaint` so the ordinary single-caret path pays
   * nothing, and rAF-deduplicated so a burst of scroll writes coalesces
   * into one repaint.
   */
  private queueSecondaryCaretRepaint(): void {
    if (this.repaintFrame !== 0 || !needsSecondaryCaretRepaint(this.view.state)) return
    this.repaintFrame = requestAnimationFrame(() => {
      this.repaintFrame = 0
      if (!needsSecondaryCaretRepaint(this.view.state)) return
      this.view.dispatch({ selection: this.view.state.selection })
    })
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const scrollbar = event.target.closest<HTMLElement>(
      '.xmd-cm-code-scrollbar.is-overflowing.is-active',
    )
    if (!scrollbar) return
    const rect = scrollbar.getBoundingClientRect()
    const thumbWidth = Number.parseFloat(scrollbar.style.getPropertyValue('--xmd-code-thumb-width'))
    const thumbLeft = Number.parseFloat(scrollbar.style.getPropertyValue('--xmd-code-thumb-left'))
    const pointerLeft = event.clientX - rect.left
    const pressedThumb = pointerLeft >= thumbLeft && pointerLeft <= thumbLeft + thumbWidth
    this.drag = {
      scrollbar,
      pointerId: event.pointerId,
      offset: pressedThumb ? pointerLeft - thumbLeft : thumbWidth / 2,
    }
    scrollbar.classList.add('is-dragging')
    scrollbar.focus({ preventScroll: true })
    scrollbar.setPointerCapture(event.pointerId)
    scrollbar.addEventListener('pointermove', this.onPointerMove)
    scrollbar.addEventListener('pointerup', this.onPointerUp)
    scrollbar.addEventListener('pointercancel', this.onPointerUp)
    if (!pressedThumb) this.scrollDragTo(event.clientX)
    event.preventDefault()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.target instanceof HTMLElement)) return
    const scrollbar = event.target.closest<HTMLElement>(
      '.xmd-cm-code-scrollbar.is-overflowing.is-active',
    )
    if (!scrollbar) return
    const page = scrollbar.clientWidth * 0.8
    const current = this.scrollPosition(scrollbar)
    const maxScroll = this.maxScroll(scrollbar)
    const next =
      event.key === 'ArrowLeft'
        ? current - 40
        : event.key === 'ArrowRight'
          ? current + 40
          : event.key === 'PageUp'
            ? current - page
            : event.key === 'PageDown'
              ? current + page
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? maxScroll
                  : null
    if (next === null) return
    this.setBlockScroll(scrollbar, next)
    event.preventDefault()
    event.stopPropagation()
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    this.scrollDragTo(event.clientX)
    event.preventDefault()
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    this.stopDragging()
    event.preventDefault()
  }

  private scrollDragTo(clientX: number): void {
    if (!this.drag) return
    const { scrollbar, offset } = this.drag
    const rect = scrollbar.getBoundingClientRect()
    const thumbWidth = Number.parseFloat(scrollbar.style.getPropertyValue('--xmd-code-thumb-width'))
    const thumbTravel = Math.max(1, scrollbar.clientWidth - thumbWidth)
    const thumbLeft = Math.min(thumbTravel, Math.max(0, clientX - rect.left - offset))
    this.setBlockScroll(scrollbar, (thumbLeft / thumbTravel) * this.maxScroll(scrollbar))
  }

  private stopDragging(): void {
    if (!this.drag) return
    const { scrollbar, pointerId } = this.drag
    if (scrollbar.hasPointerCapture(pointerId)) scrollbar.releasePointerCapture(pointerId)
    scrollbar.removeEventListener('pointermove', this.onPointerMove)
    scrollbar.removeEventListener('pointerup', this.onPointerUp)
    scrollbar.removeEventListener('pointercancel', this.onPointerUp)
    scrollbar.classList.remove('is-dragging')
    this.drag = null
  }

  private scrollPosition(scrollbar: HTMLElement): number {
    return Number.parseFloat(scrollbar.dataset.scrollLeft ?? '0') || 0
  }

  private maxScroll(scrollbar: HTMLElement): number {
    return Number.parseFloat(scrollbar.dataset.maxScroll ?? '0') || 0
  }

  private setBlockScroll(scrollbar: HTMLElement, next: number): void {
    const scrollLeft = Math.min(this.maxScroll(scrollbar), Math.max(0, next))
    // The scrollbar no longer lives inside the block's DOM; it always serves
    // the active block, whose rendered rows are looked up from the document.
    const data = activeEditableFencedCode(this.view.state)
    const block = data ? this.activeMountedBlock(data) : null
    if (!block || block.lines.length === 0) return
    this.syncing = true
    for (const content of block.contents) content.scrollLeft = scrollLeft
    this.syncing = false
    this.updateThumb(scrollbar, scrollLeft)
    this.queueSecondaryCaretRepaint()
  }

  /** `viewportWidth` must be passed from the measure write phase (reading
   * `clientWidth` there would force layout); event handlers may omit it. */
  private updateThumb(
    scrollbar: HTMLElement,
    scrollLeft: number,
    viewportWidth = scrollbar.clientWidth,
  ): void {
    const maxScroll = this.maxScroll(scrollbar)
    const contentWidth = viewportWidth + maxScroll
    const thumbWidth = Math.max(36, (viewportWidth * viewportWidth) / contentWidth)
    const thumbTravel = Math.max(0, viewportWidth - thumbWidth)
    const clampedScrollLeft = Math.min(maxScroll, Math.max(0, scrollLeft))
    const thumbLeft = maxScroll > 0 ? (clampedScrollLeft / maxScroll) * thumbTravel : 0
    scrollbar.style.setProperty('--xmd-code-thumb-width', `${thumbWidth}px`)
    scrollbar.style.setProperty('--xmd-code-thumb-left', `${thumbLeft}px`)
    scrollbar.dataset.scrollLeft = String(clampedScrollLeft)
    scrollbar.setAttribute('aria-valuenow', String(Math.round(clampedScrollLeft)))
  }

  private schedule(): void {
    this.view.requestMeasure(this.measureRequest)
  }

  private readMeasure(view: EditorView): CodeScrollMeasure {
    const reveal = this.revealPending
    this.revealPending = false
    const data = activeEditableFencedCode(view.state)
    // Fence lines still get their active class toggled while they are in the
    // DOM (their only remaining overlay-independent responsibility); a fence
    // outside the rendered viewport simply keeps its stale class until it is
    // re-rendered, which CM6 does from the decoration spec anyway.
    const fences: FenceClassMeasure[] = []
    for (const fence of view.contentDOM.querySelectorAll<HTMLElement>(
      '.cm-line.xmd-cm-code-fence-line',
    )) {
      const pos = view.posAtDOM(fence, 0)
      fences.push({ fence, active: data !== null && pos >= data.from && pos <= data.to })
    }
    if (!data) return { fences, active: null }

    // Vertical block geometry comes from the height map (`view.lineBlockAt`)
    // rather than `view.coordsAtPos`: positions outside the rendered viewport
    // fall into CM6's internal BlockGapWidget replacements, for which
    // `DocView.coordsAt` returns null (see `coordsAt` and the `isBlockGap`
    // gap decorations in node_modules/@codemirror/view/dist/index.js), while
    // `lineBlockAt` reads the height map, which covers the entire document —
    // measured heights inside the viewport, estimated ones outside. That is
    // exactly the precision the viewport-clamped pinning below needs: an
    // off-screen block edge is clamped to the viewport edge anyway.
    const firstBlock = view.lineBlockAt(data.firstCodeLineFrom)
    const lastBlock = view.lineBlockAt(Math.max(data.codeFrom, data.codeTo))
    const scrollRect = view.scrollDOM.getBoundingClientRect()
    const contentRect = view.contentDOM.getBoundingClientRect()
    const viewportTop = view.scrollDOM.scrollTop
    const viewportBottom = viewportTop + view.scrollDOM.clientHeight
    // `lineBlockAt` tops are relative to `view.documentTop` (a screen
    // coordinate). Convert into scrollDOM content space — the coordinate
    // system absolutely positioned scrollDOM children are styled in — the
    // same way @codemirror/view's own dropCursor does: screen delta plus the
    // current scroll offset, de-scaled by the editor's CSS transform.
    const documentTop = (view.documentTop - scrollRect.top) / view.scaleY + viewportTop
    const geometry: OverlayPinGeometry = {
      blockTop: documentTop + firstBlock.top,
      blockBottom: documentTop + lastBlock.bottom,
      viewportTop,
      viewportBottom,
    }
    const contentLeft =
      (contentRect.left - scrollRect.left) / view.scaleX + view.scrollDOM.scrollLeft
    const contentWidth = contentRect.width / view.scaleX
    const trackWidth = Math.max(0, contentWidth - 2 * CODE_SCROLLBAR_INSET)
    const controlsTop = pinnedOverlayTop(
      'block-start',
      geometry,
      CODE_CONTROLS_HEIGHT,
      CODE_CONTROLS_MARGIN,
    )

    const block = this.activeMountedBlock(data)
    const contents = block?.contents ?? []
    const contentScrollLefts = contents.map((content) => content.scrollLeft)
    const rowContentWidth = Math.max(
      trackWidth,
      ...contents.map(
        (content) => content.scrollWidth + Math.max(0, trackWidth - content.clientWidth),
      ),
    )

    let revealScrollLeft: number | null = null
    if (reveal && block) {
      const activeLine = block.lines.find((item) => item.classList.contains('cm-activeLine'))
      const activeContent = activeLine?.querySelector<HTMLElement>('.xmd-cm-code-line-content')
      const head = view.state.selection.main.head
      const lineOffset = head - view.state.doc.lineAt(head).from
      const caretX = activeContent ? codeContentCaretX(activeContent, lineOffset) : null
      if (activeLine && activeContent && caretX !== null) {
        const activeRect = activeContent.getBoundingClientRect()
        const leftEdge = activeRect.left + 8
        // Keep the insertion point clear of the pinned controls while they
        // overlap the caret's row. With the fence on screen this is the
        // first body row, exactly as before; with the controls stuck to the
        // viewport top it is whichever row has scrolled underneath them.
        const lineTop = (activeRect.top - scrollRect.top) / view.scaleY + viewportTop
        const lineBottom = (activeRect.bottom - scrollRect.top) / view.scaleY + viewportTop
        const underControls =
          controlsTop !== null &&
          lineBottom > controlsTop &&
          lineTop < controlsTop + CODE_CONTROLS_HEIGHT
        const controlsGutter = underControls ? resolveCodeControlsGutter(this.controls.dom) : 0
        const rightEdge = activeRect.right - controlsGutter - 8
        let next = activeContent.scrollLeft
        if (caretX < leftEdge) next -= leftEdge - caretX
        else if (caretX > rightEdge) next += caretX - rightEdge
        revealScrollLeft = next
      }
    }

    return {
      fences,
      active: {
        data,
        readOnly: view.state.readOnly,
        contents,
        contentScrollLefts,
        contentWidth: rowContentWidth,
        trackWidth,
        scrollLeft: contentScrollLefts[0] ?? 0,
        revealScrollLeft,
        overflow: rowContentWidth > trackWidth + 1,
        controlsTop,
        controlsAnchorLeft: contentLeft + contentWidth - CODE_CONTROLS_INSET,
        scrollbarTop: pinnedOverlayTop(
          'block-end',
          geometry,
          CODE_SCROLLBAR_HEIGHT,
          CODE_SCROLLBAR_MARGIN,
        ),
        scrollbarLeft: contentLeft + CODE_SCROLLBAR_INSET,
      },
    }
  }

  private writeMeasure(measure: CodeScrollMeasure): void {
    for (const { fence, active } of measure.fences) {
      fence.classList.toggle('xmd-cm-code-block-active', active)
    }

    const active = measure.active
    const controlsDom = this.controls.dom
    if (!active || active.controlsTop === null) {
      controlsDom.classList.remove('is-active')
      // Keep the overlay in place while the user is interacting with it (the
      // CSS :focus-within rules keep it visible during e.g. a language edit
      // whose commit will move the selection); park it off-screen otherwise.
      if (!controlsDom.contains(document.activeElement)) {
        controlsDom.style.top = '-9999px'
      }
    } else {
      this.controls.setBlock(active.data, active.readOnly)
      controlsDom.classList.add('is-active')
      controlsDom.style.top = `${active.controlsTop}px`
      controlsDom.style.left = `${active.controlsAnchorLeft}px`
    }

    const scrollbar = this.scrollbar
    if (!scrollbar) return
    if (!active || active.scrollbarTop === null) {
      scrollbar.classList.remove('is-overflowing')
      scrollbar.classList.remove('is-active')
      scrollbar.tabIndex = -1
      scrollbar.setAttribute('aria-hidden', 'true')
      if (document.activeElement !== scrollbar) scrollbar.style.top = '-9999px'
      return
    }
    const maxScroll = Math.max(0, active.contentWidth - active.trackWidth)
    const scrollLeft = Math.min(
      maxScroll,
      Math.max(0, active.revealScrollLeft ?? active.scrollLeft),
    )
    const visible = active.overflow
    scrollbar.style.top = `${active.scrollbarTop}px`
    scrollbar.style.left = `${active.scrollbarLeft}px`
    scrollbar.style.width = `${active.trackWidth}px`
    scrollbar.dataset.maxScroll = String(maxScroll)
    scrollbar.classList.toggle('is-overflowing', active.overflow)
    scrollbar.classList.add('is-active')
    scrollbar.tabIndex = visible ? 0 : -1
    scrollbar.setAttribute('aria-hidden', visible ? 'false' : 'true')
    scrollbar.setAttribute('aria-valuemax', String(Math.round(maxScroll)))
    let wroteScrollLeft = false
    this.syncing = true
    for (const [index, content] of active.contents.entries()) {
      // Sync per row against the offsets captured in the read phase: a row
      // CM6 (re-)rendered since the last pass starts at scrollLeft 0 and must
      // be caught up even when the reference row already matches the target.
      if (active.contentScrollLefts[index] !== scrollLeft) {
        content.scrollLeft = scrollLeft
        wroteScrollLeft = true
      }
    }
    this.syncing = false
    // No follow-up rAF re-measure here (there used to be one, gated on a
    // `geometryChanged` flag). It existed only to chase the deleted
    // cursor-transform hack. `updateThumb` derives the thumb geometry from
    // the same synchronous `scrollLeft`/`maxScroll`/`trackWidth` values
    // written this pass, not from a DOM read that could still be stale.
    this.updateThumb(scrollbar, scrollLeft, active.trackWidth)
    // Programmatic scrollLeft writes (reveal-scroll, row catch-up) move the
    // nested scrollers outside CM6's update cycle; see
    // `queueSecondaryCaretRepaint`.
    if (wroteScrollLeft) this.queueSecondaryCaretRepaint()
  }
}

function codeBlockScrolling(options: CodeBlockPreviewOptions): Extension {
  return ViewPlugin.define((view) => new CodeBlockScrollPlugin(view, options))
}

export function readFencedCode(
  state: EditorState,
  from: number,
  to: number,
  tree: Tree = syntaxTree(state),
): FencedCodeData {
  let targetFenceFrom: number | null = null
  let openingMarkFrom: number | null = null
  let openingMarkTo: number | null = null
  let closingMarkFrom: number | null = null
  let language = ''
  let languageFrom: number | null = null
  let languageTo: number | null = null

  // The Markdown parser has already applied container indentation rules.
  // Read its direct FencedCode children instead of re-parsing physical lines
  // with a 0–3-space regex: a fence nested under a list legitimately has four
  // or more leading spaces in the source document.
  tree.iterate({
    from,
    to,
    enter(node) {
      const parent = node.node.parent
      if (node.name === 'CodeMark' && parent?.name === 'FencedCode') {
        targetFenceFrom ??= parent.from
        if (parent.from !== targetFenceFrom) return
        if (openingMarkFrom === null) {
          openingMarkFrom = node.from
          openingMarkTo = node.to
        } else if (closingMarkFrom === null) {
          closingMarkFrom = node.from
        }
        return
      }
      if (node.name === 'CodeInfo') {
        if (targetFenceFrom !== null && parent?.from !== targetFenceFrom) return
        language = state.doc.sliceString(node.from, node.to).trim().split(/\s+/, 1)[0] ?? ''
        languageFrom = node.from
        languageTo = node.to
      }
    },
  })

  const opening = state.doc.lineAt(openingMarkFrom ?? from)
  const closing = closingMarkFrom === null ? null : state.doc.lineAt(closingMarkFrom)
  const fallbackLanguageFrom = Math.min(opening.to, openingMarkTo ?? opening.from + 3)
  // The body range is structural: everything between the two fence lines.
  // CodeText nodes deliberately omit some blank lines and may be split by the
  // language parser, so they must not be used as the editable/copy range.
  const codeFrom = Math.min(state.doc.length, opening.to + 1)
  const codeTo = Math.max(codeFrom, closing ? closing.from - 1 : to)
  const firstCodeLineFrom = state.doc.lineAt(codeFrom).from
  // `codeTo` is the structural end boundary of the body, not the position of
  // its final character.  This distinction matters when the body ends in a
  // blank line: after pressing Enter at the end of the last code line, codeTo
  // points at that new blank line. Looking at codeTo - 1 would keep the
  // previous non-empty line marked as the visual last line and render the new
  // blank line as a second, detached code card.
  const lastCodeLineFrom = state.doc.lineAt(Math.max(codeFrom, codeTo)).from
  return {
    from,
    to,
    language,
    languageFrom: languageFrom ?? fallbackLanguageFrom,
    languageTo: languageTo ?? fallbackLanguageFrom,
    codeFrom,
    codeTo,
    firstCodeLineFrom,
    lastCodeLineFrom,
    closingFrom: closing?.from ?? null,
  }
}

/**
 * Find the `FencedCode` node (if any) whose span contains `position`. Accepts
 * an already-resolved `tree` so callers that raced ahead of the background
 * parser (via `ensureSyntaxTree`) can supply a complete tree instead of the
 * possibly-stale one `syntaxTree(state)` would otherwise recompute. Defaults
 * to `syntaxTree(state)` for every other (hot-path) caller, unchanged from
 * before.
 */
function fencedCodeAt(
  state: EditorState,
  position: number,
  tree: Tree = syntaxTree(state),
): FencedCodeData | null {
  let result: FencedCodeData | null = null
  tree.iterate({
    from: Math.max(0, position - 1),
    to: Math.min(state.doc.length, position + 1),
    enter(node) {
      if (node.name !== 'FencedCode' || position < node.from || position > node.to) return
      result = readFencedCode(state, node.from, node.to, tree)
      return false
    },
  })
  return result
}

function fencedCodeAtSelection(state: EditorState, tree?: Tree): FencedCodeData | null {
  return fencedCodeAt(state, state.selection.main.head, tree)
}

/** Use the browser's native selection painting only for a single range that is
 * fully contained by one editable code body. Unlike CM6's full-line rectangle
 * layer, the native highlight is clipped by each line's horizontal scroller
 * and cannot escape the card. Cross-block selections keep CM6 painting so its
 * virtualized selection remains visible while the editor scrolls. */
export function selectionIntersectsFencedCode(state: EditorState): boolean {
  if (state.selection.ranges.length !== 1) return false
  const range = state.selection.main
  if (range.empty) return false
  const data = fencedCodeAt(state, range.from)
  return (
    data !== null &&
    data.language.toLowerCase() !== 'mermaid' &&
    range.from >= data.codeFrom &&
    range.to <= data.codeTo
  )
}

/** Use the browser's native caret when the (sole) selection is a collapsed
 * caret positioned inside an editable fenced code body. Same reasoning as
 * `selectionIntersectsFencedCode` above (see also `xmd-cm-native-code-caret`
 * in codeBlockPreview.css): CM6's `drawSelection` cursor overlay paints a
 * `.cm-cursor` div at un-scrolled inline coordinates, so it has no way to
 * know about the nested horizontal scroller each code line owns and drifts
 * out of place once that scroller has moved. The native caret is painted by
 * the browser at the DOM position and is naturally clipped/positioned by
 * that nested scroller, so it never needs correcting. Multiple ranges keep
 * CM6 drawing — this only concerns the single primary caret; secondary
 * carets in a multi-cursor selection still rely on the overlay. */
export function caretInsideFencedCode(state: EditorState): boolean {
  if (state.selection.ranges.length !== 1) return false
  const range = state.selection.main
  if (!range.empty) return false
  const data = fencedCodeAt(state, range.head)
  return (
    data !== null &&
    data.language.toLowerCase() !== 'mermaid' &&
    range.head >= data.codeFrom &&
    range.head <= data.codeTo
  )
}

/** Whether a stale-secondary-caret repaint is warranted after a nested
 * code-row scroller moved outside a view update (see
 * `queueSecondaryCaretRepaint` for the full mechanism): only a multi-cursor
 * selection with at least one range head inside an editable (non-Mermaid)
 * fenced code body can have a CM6-drawn caret whose painted position depends
 * on a nested `scrollLeft`. Everything else — in particular the ordinary
 * single-caret path — must return `false` so it costs nothing. */
export function needsSecondaryCaretRepaint(state: EditorState): boolean {
  if (state.selection.ranges.length < 2) return false
  return state.selection.ranges.some((range) => {
    const data = fencedCodeAt(state, range.head)
    return (
      data !== null &&
      data.language.toLowerCase() !== 'mermaid' &&
      range.head >= data.codeFrom &&
      range.head <= data.codeTo
    )
  })
}

/** Move to the logical source-line boundary inside fenced code. CM6's default
 * visual-line Home/End commands treat a nested horizontal scroller's visible
 * edge as a line boundary, which can leave the cursor hundreds of columns into
 * a long line. */
export function fencedCodeLineBoundary(
  state: EditorState,
  forward: boolean,
  extend = false,
): TransactionSpec | null {
  if (state.selection.ranges.length !== 1) return null
  const range = state.selection.main
  const data = fencedCodeAt(state, range.head)
  if (
    !data ||
    data.language.toLowerCase() === 'mermaid' ||
    range.head < data.codeFrom ||
    range.head > data.codeTo
  )
    return null
  const line = state.doc.lineAt(range.head)
  const head = forward ? line.to : line.from
  return {
    selection: { anchor: extend ? range.anchor : head, head },
    scrollIntoView: true,
  }
}

function fencedCodeBoundaryKeybinding(
  shortcut: Pick<KeyBinding, 'key' | 'mac'>,
  forward: boolean,
): KeyBinding {
  const dispatch = (view: EditorView, extend: boolean): boolean => {
    const spec = fencedCodeLineBoundary(view.state, forward, extend)
    if (!spec) return false
    view.dispatch(spec)
    return true
  }
  return {
    ...shortcut,
    run: (view) => dispatch(view, false),
    shift: (view) => dispatch(view, true),
  }
}

/**
 * Fenced-code-specific Backspace ("forward: false") / Delete ("forward:
 * true") boundary command, in the same pure-`TransactionSpec` style as
 * `core/boundaryCommands.ts`'s heading/list/quote boundary commands. It only
 * has an opinion near the block's sole blank body row — everywhere else
 * (including ordinary joins between code lines) it returns `null` so CM6's
 * defaults, which are correct now that the fence lines are atomic, run
 * unmodified.
 *
 * - Delete at the start of a blank last body row is swallowed (`{}`, a no-op
 *   transaction) so it cannot eat the boundary immediately before the hidden
 *   closing fence and surface it as an editable position.
 * - Backspace at the start of the *sole* blank body row — i.e. the block's
 *   body is already empty — removes the whole block (both fences) in a
 *   single transaction, so it never passes through an intermediate state
 *   where only the closing fence has been removed (which would let the next
 *   fence in the document parse as this block's new closing marker and
 *   visually merge two blocks).
 */
export function fencedCodeBoundaryDeletion(
  state: EditorState,
  forward: boolean,
): TransactionSpec | null {
  if (state.readOnly || !state.selection.main.empty) return null
  const data = fencedCodeAtSelection(state)
  if (!data || data.closingFrom === null || data.codeFrom > data.closingFrom) return null
  const lastLine = state.doc.lineAt(Math.max(data.codeFrom, data.closingFrom - 1))
  if (lastLine.length !== 0) return null
  const position = state.selection.main.head

  if (forward) {
    return position === lastLine.from ? {} : null
  }

  if (position !== data.codeFrom || lastLine.from !== data.codeFrom) return null
  return {
    changes: { from: data.from, to: data.to },
    selection: { anchor: data.from },
    scrollIntoView: true,
    userEvent: 'delete.backward',
  }
}

/**
 * Selection deletion can remove the final code line and its newline in one
 * transaction. Restore a single blank body line before the closing fence so
 * the next caret position remains inside the same code card.
 */
export function restoreEmptyFencedCodeBody(transaction: Transaction): TransactionSpec | null {
  if (!transaction.docChanged || !transaction.isUserEvent('delete')) return null
  const changed: PreviewRange[] = []
  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    changed.push({ from: fromB, to: toB })
  })
  if (!changed.length) return null

  const repairs: Array<{ from: number; insert: string }> = []
  let caret: number | null = null
  syntaxTree(transaction.state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return
      const data = readFencedCode(transaction.state, node.from, node.to)
      if (data.closingFrom === null) return false
      const touched = changed.some(({ from, to }) => from <= data.closingFrom! && to >= data.from)
      if (!touched) return false
      const head = transaction.state.selection.main.head
      if (data.codeFrom === data.closingFrom) {
        repairs.push({ from: data.codeFrom, insert: '\n' })
        if (head >= data.from && head <= data.closingFrom) caret = data.codeFrom
        return false
      }
      // After the final visible character is deleted, CM6 can associate the
      // selection with the hidden closing-fence replacement. Pin it to the
      // actual blank code line instead of trusting that DOM mapping.
      if (
        transaction.state.doc.sliceString(data.codeFrom, data.codeTo).length === 0 &&
        head >= data.codeFrom &&
        head <= data.closingFrom
      )
        caret = data.lastCodeLineFrom
      return false
    },
  })
  if (!repairs.length && caret === null) return null
  return {
    changes: repairs.length ? repairs : undefined,
    selection: caret === null ? undefined : { anchor: caret },
  }
}

/**
 * A hidden closing fence must not be removed by a partial delete: without it,
 * the next fence can become this block's closing fence and two cards appear to
 * merge. Selecting the complete fenced source remains a valid block deletion.
 * With fence lines now atomic (see `collectFencedCodeHiddenRanges`), ordinary
 * cursor-driven selections can no longer straddle only part of a fence line —
 * this remains a safety net for transactions built outside cursor motion
 * (paste, undo/redo, external document sync).
 */
export function partiallyDeletesFencedCodeFence(transaction: Transaction): boolean {
  if (!transaction.docChanged || !transaction.isUserEvent('delete')) return false
  const deleted: PreviewRange[] = []
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA) deleted.push({ from: fromA, to: toA })
  })
  if (!deleted.length) return false

  let partial = false
  syntaxTree(transaction.startState).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return
      const data = readFencedCode(transaction.startState, node.from, node.to)
      if (data.closingFrom === null) return false
      const opening = transaction.startState.doc.lineAt(data.from)
      const closing = transaction.startState.doc.lineAt(data.closingFrom)
      const touchesFence = deleted.some(
        ({ from, to }) =>
          (from < opening.to && to > opening.from) || (from < closing.to && to > closing.from),
      )
      const deletesWholeBlock = deleted.some(({ from, to }) => from <= data.from && to >= data.to)
      if (touchesFence && !deletesWholeBlock) {
        partial = true
        return false
      }
    },
  })
  return partial
}

/**
 * Cmd/Ctrl+A inside a fenced code block selects only its body, excluding both
 * fences (mirroring copy/paste semantics — see the copy control above).
 * Returns `null` outside a code block so the caller can fall through to
 * CM6's default select-all. Accepts an optional pre-resolved `tree` (see
 * `fencedCodeAt`'s doc comment) for the same reason as `fencedCodeContentRange`.
 */
export function fencedCodeSelectAll(state: EditorState, tree?: Tree): TransactionSpec | null {
  const data = fencedCodeAtSelection(state, tree)
  if (!data) return null
  return { selection: { anchor: data.codeFrom, head: data.codeTo } }
}

/**
 * Pure query: the fenced code body range (excluding both fence lines) that
 * contains `position`, or `null` outside any fenced code block. This is the
 * single source of truth for "what does Cmd/Ctrl+A select inside a code
 * block" — both this module's own `Mod-a` keymap (via `fencedCodeSelectAll`
 * above) and the app-level `selectAllScope` (`src/lib/editorCommands.ts`)
 * resolve through it, replacing a second hand-rolled tree walk + regex that
 * had drifted out of sync with `readFencedCode`'s tree-driven fence
 * detection (which correctly handles a fence indented ≥4 spaces under a
 * list item; a regex re-derived from physical lines does not). `tree` may be
 * an already-resolved `Tree` from `ensureSyntaxTree` for callers that need
 * to get ahead of the background parser; it is never called with
 * `ensureSyntaxTree` internally so this stays cheap for hot paths that pass
 * only `state`.
 */
export function fencedCodeContentRange(
  state: EditorState,
  position: number,
  tree?: Tree,
): { from: number; to: number } | null {
  const data = fencedCodeAt(state, position, tree)
  return data ? { from: data.codeFrom, to: data.codeTo } : null
}

/**
 * Where a pointer down on a collapsed `.xmd-cm-code-fence-line` should send
 * the caret. `linePosition` is the document position of that line's DOM
 * start (`view.posAtDOM(line, 0)`); native hit-testing on a zero-height line
 * is not meaningful, so the fence area redirects into the block instead of
 * accepting whatever position the browser resolved. Returns `null` for a
 * position that is not actually a fence line (or belongs to a Mermaid fence,
 * which owns its own block-replace preview).
 */
export function fencedCodeFenceRedirectTarget(
  state: EditorState,
  linePosition: number,
): number | null {
  const data = fencedCodeAt(state, linePosition)
  if (!data || data.language.toLowerCase() === 'mermaid') return null
  const line = state.doc.lineAt(linePosition)
  const opening = state.doc.lineAt(data.from)
  if (line.from === opening.from) return data.firstCodeLineFrom
  if (data.closingFrom !== null) {
    const closing = state.doc.lineAt(data.closingFrom)
    if (line.from === closing.from) return Math.max(data.codeFrom, data.codeTo)
  }
  return null
}

function findFencedCodeAt(state: EditorState, blockFrom: number): FencedCodeData | null {
  let result: FencedCodeData | null = null
  syntaxTree(state).iterate({
    from: blockFrom,
    to: Math.min(state.doc.length, blockFrom + 1),
    enter(node) {
      if (node.name !== 'FencedCode' || node.from !== blockFrom) return
      result = readFencedCode(state, node.from, node.to)
      return false
    },
  })
  return result
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

/**
 * Decorates fenced code without replacing its contents. CodeText remains a set
 * of ordinary outer-editor lines, so CM6 owns one document and one selection.
 * The copy/language controls and the shared scrollbar are deliberately *not*
 * part of this decoration set: as widgets anchored to the opening fence they
 * left the DOM whenever CM6's virtualized viewport dropped that line, taking
 * the controls with them mid-edit. They are scrollDOM overlays owned by
 * `CodeBlockScrollPlugin` instead.
 */
export function buildCodeBlockPreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: CodeBlockPreviewOptions = {},
): DecorationSet {
  const decorations: Array<ReturnType<Decoration['range']>> = []
  const seen = new Set<number>()
  const margin = Math.max(0, options.viewportMargin ?? 256)
  const codeLineClass = options.lineWrapping ? 'xmd-cm-code-line-wrap' : ''

  for (const visible of mergeVisibleRanges(state, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'FencedCode' || seen.has(node.from)) return
        seen.add(node.from)
        const data = readFencedCode(state, node.from, node.to)
        if (data.language.toLowerCase() === 'mermaid') return false

        const opening = state.doc.lineAt(data.from)
        const closing = data.closingFrom === null ? null : state.doc.lineAt(data.closingFrom)
        decorations.push(
          Decoration.line({ class: 'xmd-cm-code-fence-line' }).range(opening.from),
          Decoration.replace({}).range(opening.from, opening.to),
        )
        if (closing) {
          decorations.push(
            Decoration.line({ class: 'xmd-cm-code-fence-line' }).range(closing.from),
            Decoration.replace({}).range(closing.from, closing.to),
          )
        }

        let line = state.doc.lineAt(data.codeFrom)
        while (line.from <= data.codeTo && (!closing || line.from < closing.from)) {
          const classes = ['xmd-cm-code-line']
          if (codeLineClass) classes.push(codeLineClass)
          if (line.from === data.firstCodeLineFrom) classes.push('xmd-cm-code-line-first')
          if (line.from === data.lastCodeLineFrom) classes.push('xmd-cm-code-line-last')
          decorations.push(Decoration.line({ class: classes.join(' ') }).range(line.from))
          if (line.from < line.to) {
            decorations.push(
              Decoration.mark({ class: 'xmd-cm-code-line-content', inclusiveEnd: true }).range(
                line.from,
                line.to,
              ),
            )
          }
          if (line.number >= state.doc.lines) break
          line = state.doc.line(line.number + 1)
        }
        return false
      },
    })
  }
  return Decoration.set(decorations, true)
}

/**
 * The single source of atomic/hidden ranges this feature contributes to the
 * core engine (`core/hiddenRanges.ts`), replacing the standalone
 * `EditorView.atomicRanges` provider this module used to maintain on its
 * own. Fence lines (opening `` ``` `` / closing `` ``` ``, including their
 * trailing newline) are the `atomic-block` case registered in
 * `core/nodePolicy.ts`: unlike Phase 1's inline hidden ranges, an
 * `atomic-block` range is allowed to cross its own line's newline boundary
 * (see core/README.md, invariant 2), which is what keeps a caret from ever
 * resting between the fence text and its line break. `paint: false` on every
 * range here means core never paints them — this module's own
 * `viewportDecorationExtension` StateField already does that (a cross-line
 * replace is only safe from a StateField, not core's ViewPlugin aggregator).
 */
export function collectFencedCodeHiddenRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: CodeBlockPreviewOptions = {},
): HiddenRange[] {
  const hidden: HiddenRange[] = []
  const seen = new Set<number>()
  const margin = Math.max(0, options.viewportMargin ?? 256)

  for (const visible of mergeVisibleRanges(state, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'FencedCode' || seen.has(node.from)) return
        seen.add(node.from)
        const data = readFencedCode(state, node.from, node.to)
        if (data.language.toLowerCase() === 'mermaid') return false

        const opening = state.doc.lineAt(data.from)
        hidden.push({
          from: opening.from,
          to: Math.min(state.doc.length, opening.to + 1),
          paint: false,
        })
        if (data.closingFrom !== null) {
          const closing = state.doc.lineAt(data.closingFrom)
          hidden.push({
            from: closing.from,
            to: Math.min(state.doc.length, closing.to + 1),
            paint: false,
          })
        }
        return false
      },
    })
  }
  return hidden
}

export function markdownCodeBlockPreview(options: CodeBlockPreviewOptions = {}): Extension {
  return [
    codeBlockScrolling(options),
    viewportDecorationExtension(
      (view) => buildCodeBlockPreviewDecorations(view.state, view.visibleRanges, options),
      // None of these decorations depends on the selection. Rebuilding the
      // StateField after every caret move makes CM6 invalidate line geometry
      // in a microtask, which produces a visible two-stage caret jump.
      // (No `rebuildOnUpdate` readOnly trigger anymore: the read-only flag
      // only affected the controls widget, which is no longer a decoration —
      // CodeBlockScrollPlugin re-applies it to the overlay on measure.)
      {
        rebuildOnSelection: false,
        rebuildOnSyntaxTree: true,
      },
    ),
    hiddenRangeSource.of(({ state, visibleRanges }) =>
      collectFencedCodeHiddenRanges(state, visibleRanges, options),
    ),
    EditorState.transactionFilter.of((transaction) => {
      if (partiallyDeletesFencedCodeFence(transaction)) return []
      const repair = restoreEmptyFencedCodeBody(transaction)
      return repair ? [transaction, repair] : transaction
    }),
    Prec.high(
      keymap.of([
        {
          key: 'Backspace',
          run: (view) => {
            const spec = fencedCodeBoundaryDeletion(view.state, false)
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        },
        {
          key: 'Delete',
          run: (view) => {
            const spec = fencedCodeBoundaryDeletion(view.state, true)
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        },
        {
          key: 'Mod-a',
          run: (view) => {
            // Background parsing may not have reached the caret yet (a busy
            // editor, or a document just opened). Force it up to the caret
            // first so a not-yet-parsed fence doesn't make this fall back to
            // selecting the whole document — the same race `selectAllScope`
            // in `src/lib/editorCommands.ts` guards against. `ensureSyntaxTree`
            // returns a tree independent of `syntaxTree(state)`'s cached
            // field, so its result must be threaded through explicitly.
            const tree =
              ensureSyntaxTree(
                view.state,
                Math.min(view.state.doc.length, view.state.selection.main.head + 1),
                100,
              ) ?? undefined
            const spec = fencedCodeSelectAll(view.state, tree)
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        },
        fencedCodeBoundaryKeybinding({ key: 'Home' }, false),
        fencedCodeBoundaryKeybinding({ key: 'End' }, true),
        fencedCodeBoundaryKeybinding({ mac: 'Cmd-ArrowLeft' }, false),
        fencedCodeBoundaryKeybinding({ mac: 'Cmd-ArrowRight' }, true),
      ]),
    ),
    EditorView.domEventHandlers({
      pointerdown(event, view) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return false
        const target = event.target
        if (!(target instanceof Element)) return false
        const line = target.closest<HTMLElement>('.cm-line')
        if (!line || line.parentElement !== view.contentDOM) return false
        if (!line.classList.contains('xmd-cm-code-fence-line')) return false
        const linePosition = view.posAtDOM(line, 0)
        const anchor = fencedCodeFenceRedirectTarget(view.state, linePosition)
        if (anchor === null || view.state.selection.main.head === anchor) return false
        event.preventDefault()
        view.dispatch({ selection: { anchor }, scrollIntoView: true })
        view.focus()
        return true
      },
    }),
  ]
}
