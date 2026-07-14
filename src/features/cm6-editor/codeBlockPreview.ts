import { LanguageDescription, syntaxTree } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
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
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { hiddenRangeSource, type HiddenRange } from './core/hiddenRanges'
import type { PreviewRange } from './core/types'
import { viewportDecorationExtension } from './viewportDecorations'
import { checkIcon, copyIcon } from './widgetIcons'

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

interface CodeLanguageOption {
  label: string
  value: string
}

export const codeLanguageOptions: readonly CodeLanguageOption[] = [
  { label: 'Text', value: '' },
  ...languages
    .map((description) => ({ label: description.name, value: description.name.toLowerCase() }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]

function normalizedLanguageValue(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return ''
  return (
    LanguageDescription.matchLanguageName(languages, normalized, true)?.name.toLowerCase() ??
    normalized
  )
}

export function resolveCodeLanguageInput(language: string): string {
  const typed = language.trim().toLowerCase()
  if (!typed || typed === 'text') return ''
  const matched = LanguageDescription.matchLanguageName(languages, typed, true)
  if (matched) return matched.name.toLowerCase()
  const prefix = codeLanguageOptions.find(
    (entry) => entry.value.startsWith(typed) || entry.label.toLowerCase().startsWith(typed),
  )
  return prefix?.value ?? typed
}

export function matchingCodeLanguageOptions(
  language: string,
  limit = 8,
): readonly CodeLanguageOption[] {
  const typed = language.trim().toLowerCase()
  const matches = typed
    ? codeLanguageOptions.filter(
        (entry) =>
          (entry.value || 'text').startsWith(typed) || entry.label.toLowerCase().startsWith(typed),
      )
    : [...codeLanguageOptions]
  const canonical = typed
    ? LanguageDescription.matchLanguageName(languages, typed, true)?.name.toLowerCase()
    : null
  const canonicalOption = canonical
    ? codeLanguageOptions.find((entry) => entry.value === canonical)
    : undefined
  const ranked = canonicalOption
    ? [canonicalOption, ...matches.filter((entry) => entry !== canonicalOption)]
    : matches
  return ranked.slice(0, Math.max(0, limit))
}

let codeLanguageMenuSequence = 0

class CodeBlockControlsWidget extends WidgetType {
  constructor(
    readonly data: FencedCodeData,
    readonly copyLabel: string,
    readonly copiedLabel: string,
    readonly readOnly: boolean,
  ) {
    super()
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof CodeBlockControlsWidget &&
      other.data.from === this.data.from &&
      other.data.to === this.data.to &&
      other.data.language === this.data.language &&
      other.copyLabel === this.copyLabel &&
      other.copiedLabel === this.copiedLabel &&
      other.readOnly === this.readOnly
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const header = document.createElement('span')
    header.className = 'xmd-cm-code-preview-header'

    const language = document.createElement('input')
    language.className = 'xmd-cm-code-preview-language'
    language.type = 'text'
    language.autocomplete = 'off'
    language.spellcheck = false
    language.setAttribute('aria-label', 'Code language')
    language.disabled = this.readOnly
    const initialLanguage = normalizedLanguageValue(this.data.language)
    language.value = initialLanguage || 'text'
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
      const current = findFencedCodeAt(view.state, this.data.from)
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
        language.value = initialLanguage || 'text'
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
    copy.setAttribute('aria-label', this.copyLabel)
    copy.title = this.copyLabel
    copy.append(copyIcon())
    copy.addEventListener('click', () => {
      const current = findFencedCodeAt(view.state, this.data.from)
      if (!current || !globalThis.navigator?.clipboard) return
      const code = view.state.doc.sliceString(current.codeFrom, current.codeTo)
      void navigator.clipboard.writeText(code).then(
        () => {
          copy.replaceChildren(checkIcon())
          copy.title = this.copiedLabel
          copy.setAttribute('aria-label', this.copiedLabel)
          window.setTimeout(() => {
            if (!copy.isConnected) return
            copy.replaceChildren(copyIcon())
            copy.title = this.copyLabel
            copy.setAttribute('aria-label', this.copyLabel)
          }, 1200)
        },
        () => {
          copy.replaceChildren(copyIcon())
          copy.title = this.copyLabel
          copy.setAttribute('aria-label', this.copyLabel)
        },
      )
    })

    header.append(language, menu, copy)
    return header
  }

  ignoreEvent(): boolean {
    return true
  }
}

class CodeBlockScrollbarWidget extends WidgetType {
  constructor(readonly blockFrom: number) {
    super()
  }

  eq(other: WidgetType): boolean {
    return other instanceof CodeBlockScrollbarWidget && other.blockFrom === this.blockFrom
  }

  toDOM(): HTMLElement {
    const scrollbar = document.createElement('span')
    scrollbar.className = 'xmd-cm-code-scrollbar'
    scrollbar.dataset.blockFrom = String(this.blockFrom)
    scrollbar.tabIndex = -1
    scrollbar.setAttribute('role', 'scrollbar')
    scrollbar.setAttribute('aria-label', 'Code block horizontal scroll')
    scrollbar.setAttribute('aria-orientation', 'horizontal')
    scrollbar.setAttribute('aria-valuemin', '0')
    return scrollbar
  }

  ignoreEvent(): boolean {
    return true
  }
}

interface MountedCodeBlock {
  lines: HTMLElement[]
  contents: HTMLElement[]
  scrollbar: HTMLElement | null
}

interface CodeScrollMeasure extends Omit<MountedCodeBlock, 'scrollbar'> {
  scrollbar: HTMLElement
  contentWidth: number
  scrollLeft: number
  overflow: boolean
  active: boolean
  controlsWidth: number
}

function mountedCodeBlockAt(line: HTMLElement): MountedCodeBlock {
  let first = line
  while (
    first.previousElementSibling instanceof HTMLElement &&
    first.previousElementSibling.classList.contains('xmd-cm-code-line')
  ) {
    first = first.previousElementSibling
  }

  const lines: HTMLElement[] = []
  let current: Element | null = first
  while (current instanceof HTMLElement && current.classList.contains('xmd-cm-code-line')) {
    lines.push(current)
    current = current.nextElementSibling
  }

  return {
    lines,
    contents: lines.flatMap((item) =>
      Array.from(item.querySelectorAll<HTMLElement>('.xmd-cm-code-line-content')),
    ),
    scrollbar: lines.at(-1)?.querySelector<HTMLElement>('.xmd-cm-code-scrollbar') ?? null,
  }
}

/** Keeps every source row full-width while synchronizing their hidden
 * horizontal scrollers with one visible scrollbar at the bottom of the card. */
class CodeBlockScrollPlugin {
  private syncing = false
  private frame = 0
  private drag: { scrollbar: HTMLElement; pointerId: number; offset: number } | null = null

  constructor(readonly view: EditorView) {
    view.contentDOM.addEventListener('scroll', this.onScroll, true)
    view.contentDOM.addEventListener('pointerdown', this.onPointerDown)
    view.contentDOM.addEventListener('keydown', this.onKeyDown)
    this.updateSelectionPresentation(view.state)
    this.schedule()
    this.frame = requestAnimationFrame(() => this.schedule())
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) this.updateSelectionPresentation(update.state)
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.schedule()
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.frame)
    this.view.contentDOM.removeEventListener('scroll', this.onScroll, true)
    this.view.contentDOM.removeEventListener('pointerdown', this.onPointerDown)
    this.view.contentDOM.removeEventListener('keydown', this.onKeyDown)
    this.view.dom.classList.remove('xmd-cm-native-code-selection')
    this.stopDragging()
  }

  private readonly onScroll = (event: Event): void => {
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
    if (block.scrollbar) this.updateThumb(block.scrollbar, source.scrollLeft)
    this.syncing = false
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
    const line = scrollbar.closest<HTMLElement>('.cm-line.xmd-cm-code-line')
    if (!line) return
    const scrollLeft = Math.min(this.maxScroll(scrollbar), Math.max(0, next))
    const block = mountedCodeBlockAt(line)
    this.syncing = true
    for (const content of block.contents) content.scrollLeft = scrollLeft
    this.syncing = false
    this.updateThumb(scrollbar, scrollLeft)
  }

  private updateThumb(scrollbar: HTMLElement, scrollLeft: number): void {
    const viewportWidth = scrollbar.clientWidth
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
    this.view.requestMeasure({
      read: (view): CodeScrollMeasure[] => {
        const measures: CodeScrollMeasure[] = []
        const activeBlockFrom = fencedCodeAtSelection(view.state)?.from ?? null
        for (const scrollbar of view.contentDOM.querySelectorAll<HTMLElement>(
          '.xmd-cm-code-scrollbar',
        )) {
          const line = scrollbar.closest<HTMLElement>('.cm-line.xmd-cm-code-line')
          if (!line) continue
          const block = mountedCodeBlockAt(line)
          const controls = block.lines[0]?.querySelector<HTMLElement>('.xmd-cm-code-preview-header')
          const contentWidth = Math.max(
            scrollbar.clientWidth,
            ...block.contents.map(
              (content) =>
                content.scrollWidth + Math.max(0, scrollbar.clientWidth - content.clientWidth),
            ),
          )
          measures.push({
            ...block,
            scrollbar,
            contentWidth,
            scrollLeft: block.contents[0]?.scrollLeft ?? 0,
            overflow: contentWidth > scrollbar.clientWidth + 1,
            active: Number(scrollbar.dataset.blockFrom) === activeBlockFrom,
            controlsWidth: Math.ceil((controls?.getBoundingClientRect().width ?? 98) + 14),
          })
        }
        return measures
      },
      write: (measures) => {
        let activeLayoutChanged = false
        for (const measure of measures) {
          const visible = measure.overflow && measure.active
          const maxScroll = Math.max(0, measure.contentWidth - measure.scrollbar.clientWidth)
          const firstLine = measure.lines[0]
          if (firstLine) {
            const wasActive = firstLine.classList.contains('xmd-cm-code-block-active')
            firstLine.classList.toggle('xmd-cm-code-block-active', measure.active)
            firstLine.style.setProperty('--xmd-code-controls-width', `${measure.controlsWidth}px`)
            activeLayoutChanged ||= wasActive !== measure.active
          }
          measure.scrollbar.dataset.maxScroll = String(maxScroll)
          measure.scrollbar.classList.toggle('is-overflowing', measure.overflow)
          measure.scrollbar.classList.toggle('is-active', measure.active)
          measure.scrollbar.tabIndex = visible ? 0 : -1
          measure.scrollbar.setAttribute('aria-hidden', visible ? 'false' : 'true')
          measure.scrollbar.setAttribute('aria-valuemax', String(Math.round(maxScroll)))
          this.updateThumb(measure.scrollbar, measure.scrollLeft)
        }
        if (activeLayoutChanged) {
          cancelAnimationFrame(this.frame)
          this.frame = requestAnimationFrame(() => this.schedule())
        }
      },
    })
  }
}

const codeBlockScrolling = ViewPlugin.fromClass(CodeBlockScrollPlugin)

export function readFencedCode(state: EditorState, from: number, to: number): FencedCodeData {
  const opening = state.doc.lineAt(from)
  const openingMatch = /^( {0,3})(`{3,}|~{3,})/.exec(opening.text)
  const marker = openingMatch?.[2] ?? '```'
  const possibleClosing = state.doc.lineAt(Math.max(from, to - 1))
  const closingPattern = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`)
  const closing =
    possibleClosing.from !== opening.from && closingPattern.test(possibleClosing.text)
      ? possibleClosing
      : null
  let language = ''
  let languageFrom = Math.min(opening.to, opening.from + (openingMatch?.[0].length ?? 3))
  let languageTo = languageFrom
  // The body range is structural: everything between the two fence lines.
  // CodeText nodes deliberately omit some blank lines and may be split by the
  // language parser, so they must not be used as the editable/copy range.
  const codeFrom = Math.min(state.doc.length, opening.to + 1)
  const codeTo = Math.max(codeFrom, closing ? closing.from - 1 : to)
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'CodeInfo') {
        language = state.doc.sliceString(node.from, node.to).trim().split(/\s+/, 1)[0] ?? ''
        languageFrom = node.from
        languageTo = node.to
      }
    },
  })
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
    languageFrom,
    languageTo,
    codeFrom,
    codeTo,
    firstCodeLineFrom,
    lastCodeLineFrom,
    closingFrom: closing?.from ?? null,
  }
}

/** Find the `FencedCode` node (if any) whose span contains `position`. */
function fencedCodeAt(state: EditorState, position: number): FencedCodeData | null {
  let result: FencedCodeData | null = null
  syntaxTree(state).iterate({
    from: Math.max(0, position - 1),
    to: Math.min(state.doc.length, position + 1),
    enter(node) {
      if (node.name !== 'FencedCode' || position < node.from || position > node.to) return
      result = readFencedCode(state, node.from, node.to)
      return false
    },
  })
  return result
}

function fencedCodeAtSelection(state: EditorState): FencedCodeData | null {
  return fencedCodeAt(state, state.selection.main.head)
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
 * CM6's default select-all.
 */
export function fencedCodeSelectAll(state: EditorState): TransactionSpec | null {
  const data = fencedCodeAtSelection(state)
  if (!data) return null
  return { selection: { anchor: data.codeFrom, head: data.codeTo } }
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
 */
export function buildCodeBlockPreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: CodeBlockPreviewOptions = {},
): DecorationSet {
  const decorations: Array<ReturnType<Decoration['range']>> = []
  const seen = new Set<number>()
  const margin = Math.max(0, options.viewportMargin ?? 256)
  const copyLabel = options.copyLabel ?? 'Copy'
  const copiedLabel = options.copiedLabel ?? 'Copied'
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
              Decoration.mark({ class: 'xmd-cm-code-line-content' }).range(line.from, line.to),
            )
          }
          if (line.number >= state.doc.lines) break
          line = state.doc.line(line.number + 1)
        }
        decorations.push(
          Decoration.widget({
            widget: new CodeBlockControlsWidget(data, copyLabel, copiedLabel, state.readOnly),
            side: 1,
          }).range(data.firstCodeLineFrom),
        )
        if (!options.lineWrapping) {
          decorations.push(
            Decoration.widget({
              widget: new CodeBlockScrollbarWidget(data.from),
              side: 1,
            }).range(data.codeTo),
          )
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
    codeBlockScrolling,
    viewportDecorationExtension(
      (view) => buildCodeBlockPreviewDecorations(view.state, view.visibleRanges, options),
      // None of these decorations depends on the selection. Rebuilding the
      // StateField after every caret move makes CM6 invalidate line geometry
      // in a microtask, which produces a visible two-stage caret jump.
      {
        rebuildOnSelection: false,
        rebuildOnSyntaxTree: true,
        rebuildOnUpdate: (update) => update.startState.readOnly !== update.state.readOnly,
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
            const spec = fencedCodeSelectAll(view.state)
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        },
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
