import { Annotation, type EditorState, type Extension } from '@codemirror/state'
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'
import {
  activeEditableFencedCode,
  findFencedCodeAt,
  isEditableMermaidSource,
  needsCodeCaretRepaint,
  selectionIntersectsFencedCode,
  type FencedCodeData,
} from './codeBlockDetection'
import {
  matchingCodeLanguageOptions,
  normalizedLanguageValue,
  resolveCodeLanguageInput,
  type CodeLanguageOption,
} from './codeBlockLanguage'
import {
  CODE_SCROLLBAR_HEIGHT,
  CODE_SCROLLBAR_MARGIN,
  codeControlsFitInside,
  codeControlsTop,
  codeBlockOverlayHorizontalGeometry,
  codeContentCaretX,
  createCodeScrollbarElement,
  mountedCodeBlockAt,
  pinnedOverlayTop,
  type MountedCodeBlock,
  type OverlayPinGeometry,
} from './codeBlockGeometry'
import { mermaidSourceRange, setMermaidSourceRange } from './mermaidPreview'
import { checkIcon, copyIcon, eyeIcon } from './widgetIcons'

export interface CodeBlockPreviewOptions {
  viewportMargin?: number
  maxHeight?: number
  copyLabel?: string
  copiedLabel?: string
  /** Wrap long code lines. Disabled by default so source layout is preserved. */
  lineWrapping?: boolean
}

/** Marks a selection re-dispatch whose only purpose is to make CM6 measure
 * its cursor layer after a nested code-row scroller moved. */
const codeCaretRepaint = Annotation.define<boolean>()

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
  readonly setMermaidSourceVisible: (visible: boolean) => void

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

    const mermaidPreview = document.createElement('button')
    mermaidPreview.className = 'xmd-cm-mermaid-preview-toggle'
    mermaidPreview.type = 'button'
    mermaidPreview.hidden = true
    mermaidPreview.setAttribute('aria-label', '切换到 Mermaid 预览')
    mermaidPreview.title = '切换到预览'
    mermaidPreview.append(eyeIcon())
    mermaidPreview.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const source = view.state.field(mermaidSourceRange, false)
      if (!source) return
      view.dispatch({
        effects: setMermaidSourceRange.of(null),
        selection: { anchor: source.from },
      })
      view.focus()
    })

    header.append(language, menu, mermaidPreview, copy)
    this.dom = header
    this.setMermaidSourceVisible = (visible) => {
      mermaidPreview.hidden = !visible
    }
    this.setBlock = (data, readOnly) => {
      blockFrom = data.from
      const normalized = normalizedLanguageValue(data.language)
      committedLanguage = normalized
      language.disabled = readOnly
      this.setMermaidSourceVisible(isEditableMermaidSource(view.state, data))
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
  controlsInside: boolean
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
  private controlsInside = false
  private controlsBlockFrom = -1
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
    // A search bridge (FindBar) dispatches match selections while its own
    // input keeps DOM focus, so a focus/blur transition can flip which
    // presentation is correct without any accompanying selection change.
    view.contentDOM.addEventListener('focus', this.onFocusChange)
    view.contentDOM.addEventListener('blur', this.onFocusChange)
    this.updateSelectionPresentation(view.state)
    this.syncMermaidSourceControl(view.state)
    this.schedule()
    this.frame = requestAnimationFrame(() => this.schedule())
  }

  update(update: ViewUpdate): void {
    this.syncMermaidSourceControl(update.state)
    if (update.docChanged || update.selectionSet) this.updateSelectionPresentation(update.state)
    // Reveal-scrolling (keeping the caret visible inside the nested
    // scrollers) follows edits, keyboard/programmatic caret movement and
    // geometry changes — but not a plain pointer selection. The clicked DOM
    // position is already visible by definition; revealing it again with our
    // controls-gutter margin makes a long code row jump horizontally after
    // the browser has placed the caret.
    const pointerSelection =
      update.selectionSet && update.transactions.some((tr) => tr.isUserEvent('select.pointer'))
    const repaintOnly = update.transactions.some((tr) => tr.annotation(codeCaretRepaint))
    if (
      update.docChanged ||
      (update.selectionSet && !pointerSelection && !repaintOnly) ||
      update.geometryChanged
    ) {
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
    this.view.contentDOM.removeEventListener('focus', this.onFocusChange)
    this.view.contentDOM.removeEventListener('blur', this.onFocusChange)
    this.view.dom.classList.remove('xmd-cm-native-code-selection')
    this.stopDragging()
    this.controls.destroy()
    this.scrollbar?.remove()
  }

  private syncMermaidSourceControl(state: EditorState): void {
    const source = state.field(mermaidSourceRange, false)
    const head = state.selection.main.head
    this.controls.setMermaidSourceVisible(
      Boolean(source && head >= source.from && head <= source.to),
    )
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

  private readonly onFocusChange = (): void => this.updateSelectionPresentation(this.view.state)

  private updateSelectionPresentation(state: EditorState): void {
    // The native browser selection highlight this presentation relies on (see
    // the rationale on `selectionIntersectsFencedCode`)
    // only renders while the editor actually holds DOM focus. A search bridge
    // (FindBar) selects matches by dispatching to the view while its own
    // input keeps focus; without this gate that leaves a match inside a code
    // block with no visible presentation at all, since it also hides CM6's
    // own decorative selection layer that would otherwise show it.
    const nativePresentation = this.view.hasFocus
    this.view.dom.classList.toggle(
      'xmd-cm-native-code-selection',
      nativePresentation && selectionIntersectsFencedCode(state),
    )
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
    // `queueCodeCaretRepaint` (this also covers scrolled rows of a
    // *non-active* block that a multi-cursor caret may sit in).
    this.queueCodeCaretRepaint()
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
   * CM6's `drawSelection`
   * cursor layer re-measures its markers only during a view update —
   * `LayerView.update` schedules a measure when `cursorLayer.update()`
   * returns true, i.e. on `update.docChanged || update.selectionSet` (or a
   * config change), plus `update.geometryChanged` (see `cursorLayer` and
   * `LayerView.update` in node_modules/@codemirror/view/dist/index.js). A
   * nested code-row `scrollLeft` moving *outside* an update — scrollbar
   * drag/keyboard, `syncFrom`, a reveal-scroll write — therefore leaves
   * primary or secondary cursor markers painted at stale coordinates.
   * Re-dispatching the current selection unchanged is the lightest public
   * trigger that sets `update.selectionSet`; an empty `view.dispatch({})`
   * sets neither flag and repaints nothing. Strictly gated by
   * `needsCodeCaretRepaint` so unrelated selections pay nothing, and
   * rAF-deduplicated so a burst of scroll writes coalesces into one repaint.
   */
  private queueCodeCaretRepaint(): void {
    if (this.repaintFrame !== 0 || !needsCodeCaretRepaint(this.view.state)) return
    this.repaintFrame = requestAnimationFrame(() => {
      this.repaintFrame = 0
      if (!needsCodeCaretRepaint(this.view.state)) return
      this.view.dispatch({
        selection: this.view.state.selection,
        annotations: codeCaretRepaint.of(true),
      })
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
    // Old WKWebView ignores preventScroll and can scroll scrollDOM on focus.
    const dom = this.view.scrollDOM
    const { scrollLeft, scrollTop } = dom
    scrollbar.focus({ preventScroll: true })
    Object.assign(dom, { scrollLeft, scrollTop })
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
    this.queueCodeCaretRepaint()
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
    const block = this.activeMountedBlock(data)
    const firstMountedLine = block?.lines[0]
    if (!block || !firstMountedLine) return { fences, active: null }
    const horizontal = codeBlockOverlayHorizontalGeometry(
      firstMountedLine.getBoundingClientRect(),
      scrollRect,
      view.scrollDOM.scrollLeft,
      view.scaleX,
    )
    const { trackWidth } = horizontal
    const firstContent = firstMountedLine.querySelector<HTMLElement>('.xmd-cm-code-line-content')
    let firstContentEnd = firstContent?.getBoundingClientRect().left ?? 0
    if (firstContent) {
      const range = document.createRange()
      range.selectNodeContents(firstContent)
      const rangeRect = range.getBoundingClientRect()
      if (rangeRect.width > 0) firstContentEnd = rangeRect.right
      range.detach()
    }
    const firstContentRight = firstContent?.getBoundingClientRect().right ?? firstContentEnd
    const controlsWidth = this.controls.dom.getBoundingClientRect().width / view.scaleX
    const availableFirstRowWidth = Math.max(0, (firstContentRight - firstContentEnd) / view.scaleX)
    const controlsInside = codeControlsFitInside(
      availableFirstRowWidth,
      controlsWidth,
      this.controlsBlockFrom === data.from && this.controlsInside,
    )
    const controlsTop = codeControlsTop(geometry, controlsInside)

    const contents = block.contents
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
        const rightEdge = activeRect.right - 8
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
        // Not contentScrollLefts[0]: CM6 recycles row DOM on scroll and a
        // recycled row resets to 0, so row 0 alone isn't reliable — max keeps
        // whichever row still holds the real (non-recycled) offset.
        scrollLeft: contentScrollLefts.length ? Math.max(...contentScrollLefts) : 0,
        revealScrollLeft,
        overflow: rowContentWidth > trackWidth + 1,
        controlsTop,
        controlsInside,
        controlsAnchorLeft: horizontal.controlsAnchorLeft,
        scrollbarTop: pinnedOverlayTop(
          'block-end',
          geometry,
          CODE_SCROLLBAR_HEIGHT,
          CODE_SCROLLBAR_MARGIN,
        ),
        scrollbarLeft: horizontal.scrollbarLeft,
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
      if (!active) {
        this.controlsBlockFrom = -1
        this.controlsInside = false
      }
      controlsDom.classList.remove('is-active')
      // Keep the overlay in place while the user is interacting with it (the
      // CSS :focus-within rules keep it visible during e.g. a language edit
      // whose commit will move the selection); park it off-screen otherwise.
      if (!controlsDom.contains(document.activeElement)) {
        controlsDom.style.top = '-9999px'
      }
    } else {
      const blockChanged = this.controlsBlockFrom !== active.data.from
      this.controls.setBlock(active.data, active.readOnly)
      this.controlsBlockFrom = active.data.from
      this.controlsInside = active.controlsInside
      controlsDom.classList.add('is-active')
      controlsDom.classList.toggle('is-inside', active.controlsInside)
      controlsDom.style.top = `${active.controlsTop}px`
      controlsDom.style.left = `${active.controlsAnchorLeft}px`
      // setBlock may resize the language input (or reveal the Mermaid action).
      // Re-measure once with the new block's actual controls width.
      if (blockChanged) this.schedule()
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
    // `queueCodeCaretRepaint`.
    if (wroteScrollLeft) this.queueCodeCaretRepaint()
  }
}

export function codeBlockScrolling(options: CodeBlockPreviewOptions): Extension {
  return ViewPlugin.define((view) => new CodeBlockScrollPlugin(view, options))
}
