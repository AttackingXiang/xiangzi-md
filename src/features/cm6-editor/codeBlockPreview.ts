import { LanguageDescription, syntaxTree } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { EditorState, Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { PreviewRange } from './livePreview'
import { viewportDecorationExtension } from './viewportDecorations'
import { checkIcon, copyIcon } from './widgetIcons'

export interface CodeBlockPreviewOptions {
  viewportMargin?: number
  maxHeight?: number
  copyLabel?: string
  copiedLabel?: string
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

function ensureLanguageOption(select: HTMLSelectElement, language: string): void {
  const value = normalizedLanguageValue(language)
  if (!value || Array.from(select.options).some((option) => option.value === value)) return
  const option = document.createElement('option')
  option.value = value
  option.textContent = language.trim()
  select.append(option)
}

function currentLanguageOption(language: string): HTMLOptionElement {
  const value = normalizedLanguageValue(language)
  const known = codeLanguageOptions.find((option) => option.value === value)
  const option = document.createElement('option')
  option.value = value
  option.textContent = (known?.label ?? language.trim()) || 'Text'
  return option
}

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

    const language = document.createElement('select')
    language.className = 'xmd-cm-code-preview-language'
    language.setAttribute('aria-label', 'Code language')
    language.disabled = this.readOnly
    language.append(currentLanguageOption(this.data.language))
    const populateLanguages = (): void => {
      if (language.dataset.populated === 'true') return
      const current = normalizedLanguageValue(this.data.language)
      language.replaceChildren()
      for (const entry of codeLanguageOptions) {
        const option = document.createElement('option')
        option.value = entry.value
        option.textContent = entry.label
        language.append(option)
      }
      ensureLanguageOption(language, this.data.language)
      language.value = current
      language.dataset.populated = 'true'
    }
    // A full language picker contains more than a hundred option nodes. Build
    // it only when the user opens/focuses the control, not for every viewport
    // code block during scrolling.
    language.addEventListener('pointerdown', populateLanguages)
    language.addEventListener('focus', populateLanguages)
    language.addEventListener('keydown', populateLanguages)
    language.addEventListener('change', () => {
      if (view.state.readOnly) return
      const current = findFencedCodeAt(view.state, this.data.from)
      if (!current) return
      view.dispatch({
        changes: {
          from: current.languageFrom,
          to: current.languageTo,
          insert: language.value,
        },
      })
      view.focus()
    })

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
          window.setTimeout(() => {
            if (!copy.isConnected) return
            copy.replaceChildren(copyIcon())
            copy.title = this.copyLabel
          }, 1200)
        },
        () => {
          copy.replaceChildren(copyIcon())
          copy.title = this.copyLabel
        },
      )
    })

    header.append(language, copy)
    return header
  }

  ignoreEvent(): boolean {
    return true
  }
}

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
          if (line.from === data.firstCodeLineFrom) classes.push('xmd-cm-code-line-first')
          if (line.from === data.lastCodeLineFrom) classes.push('xmd-cm-code-line-last')
          decorations.push(Decoration.line({ class: classes.join(' ') }).range(line.from))
          if (line.number >= state.doc.lines) break
          line = state.doc.line(line.number + 1)
        }
        decorations.push(
          Decoration.widget({
            widget: new CodeBlockControlsWidget(data, copyLabel, copiedLabel, state.readOnly),
            side: 1,
          }).range(data.firstCodeLineFrom),
        )
        return false
      },
    })
  }
  return Decoration.set(decorations, true)
}

/**
 * Navigation-only ranges for hidden fence lines. They intentionally aren't
 * provided as visual decorations: a cross-line replace at the opening fence
 * shares its end boundary with the first code-line decoration and can prevent
 * CM6 from mounting that line's card classes and controls.
 */
export function buildCodeFenceAtomicRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  viewportMargin = 256,
): DecorationSet {
  const ranges: Array<ReturnType<Decoration['range']>> = []
  const seen = new Set<number>()
  for (const visible of mergeVisibleRanges(state, visibleRanges, Math.max(0, viewportMargin))) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'FencedCode' || seen.has(node.from)) return
        seen.add(node.from)
        const data = readFencedCode(state, node.from, node.to)
        if (data.language.toLowerCase() === 'mermaid') return false
        const opening = state.doc.lineAt(data.from)
        ranges.push(
          Decoration.mark({}).range(opening.from, Math.min(state.doc.length, opening.to + 1)),
        )
        if (data.closingFrom !== null) {
          const closing = state.doc.lineAt(data.closingFrom)
          ranges.push(
            Decoration.mark({}).range(closing.from, Math.min(state.doc.length, closing.to + 1)),
          )
        }
        return false
      },
    })
  }
  return Decoration.set(ranges, true)
}

export function markdownCodeBlockPreview(options: CodeBlockPreviewOptions = {}): Extension {
  return [
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
    EditorView.atomicRanges.of((view) =>
      buildCodeFenceAtomicRanges(view.state, view.visibleRanges, options.viewportMargin),
    ),
  ]
}
