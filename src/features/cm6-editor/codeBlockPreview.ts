import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { defaultHighlightStyle, LanguageDescription, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { Compartment, EditorState, type ChangeSet, type Extension } from '@codemirror/state'
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import type { PreviewRange } from './livePreview'
import { viewportDecorationExtension } from './viewportDecorations'
import { checkIcon, copyIcon } from './widgetIcons'

export interface CodeBlockPreviewOptions {
  /** Extra characters inspected around the CM6 viewport. */
  viewportMargin?: number
  /** Maximum estimated/rendered preview height, in pixels. */
  maxHeight?: number
  copyLabel?: string
  copiedLabel?: string
}

interface FencedCodeData {
  from: number
  to: number
  language: string
  code: string
  languageFrom: number
  languageTo: number
  codeFrom: number
  codeTo: number
}

interface CodeLanguageOption {
  label: string
  value: string
}

/**
 * Keep the picker backed by CM6's language registry so the displayed choices and
 * the syntax support loaded below cannot drift apart.  The empty option represents
 * a plain-text fence.
 */
export const codeLanguageOptions: readonly CodeLanguageOption[] = [
  { label: 'Text', value: '' },
  ...languages
    .map((description) => ({ label: description.name, value: description.name.toLowerCase() }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]

export function mapCodeBlockChanges(
  codeFrom: number,
  changes: ChangeSet,
): Array<{ from: number; to: number; insert: string }> {
  const mapped: Array<{ from: number; to: number; insert: string }> = []
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    mapped.push({ from: codeFrom + fromA, to: codeFrom + toA, insert: inserted.toString() })
  })
  return mapped
}

class FencedCodeWidget extends WidgetType {
  constructor(
    public data: FencedCodeData,
    readonly options: Required<
      Pick<CodeBlockPreviewOptions, 'maxHeight' | 'copyLabel' | 'copiedLabel'>
    >,
  ) {
    super()
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof FencedCodeWidget)) return false
    return (
      other.data.from === this.data.from &&
      other.options.maxHeight === this.options.maxHeight &&
      other.options.copyLabel === this.options.copyLabel &&
      other.options.copiedLabel === this.options.copiedLabel
    )
  }

  updateDOM(dom: HTMLElement): boolean {
    const controller = codeControllers.get(dom)
    if (!controller) return false
    controller.data = this.data
    const currentCode = controller.editor.state.doc.toString()
    if (currentCode !== this.data.code) {
      controller.syncing = true
      controller.editor.dispatch({
        changes: { from: 0, to: currentCode.length, insert: this.data.code },
      })
      controller.syncing = false
    }
    const language = dom.querySelector<HTMLSelectElement>('.xmd-cm-code-preview-language')
    if (language && document.activeElement !== language) {
      language.hidden = this.data.language.trim() === ''
      ensureLanguageOption(language, this.data.language)
      language.value = normalizedLanguageValue(this.data.language)
    }
    loadCodeLanguage(controller, this.data.language)
    return true
  }

  get estimatedHeight(): number {
    const lines = this.data.code.split('\n').length
    return Math.min(this.options.maxHeight, 43 + lines * 22)
  }

  toDOM(outerView: EditorView): HTMLElement {
    const container = document.createElement('section')
    container.className = 'xmd-cm-code-preview'
    container.style.setProperty('--xmd-code-max-height', `${this.options.maxHeight}px`)

    const header = document.createElement('div')
    header.className = 'xmd-cm-code-preview-header'

    const language = document.createElement('select')
    language.className = 'xmd-cm-code-preview-language'
    language.setAttribute('aria-label', 'Code language')
    language.hidden = this.data.language.trim() === ''
    for (const entry of codeLanguageOptions) {
      const option = document.createElement('option')
      option.value = entry.value
      option.textContent = entry.label
      language.append(option)
    }
    ensureLanguageOption(language, this.data.language)
    language.value = normalizedLanguageValue(this.data.language)
    language.addEventListener('change', () => {
      const controller = codeControllers.get(container)
      if (!controller) return
      outerView.dispatch({
        changes: {
          from: controller.data.languageFrom,
          to: controller.data.languageTo,
          insert: language.value,
        },
      })
    })

    const copy = document.createElement('button')
    copy.className = 'xmd-cm-code-preview-copy'
    copy.type = 'button'
    copy.setAttribute('aria-label', this.options.copyLabel)
    copy.title = this.options.copyLabel
    copy.append(copyIcon())
    copy.addEventListener('click', () => {
      const clipboard = globalThis.navigator?.clipboard
      if (!clipboard) return
      const currentCode = codeControllers.get(container)?.editor.state.doc.toString() ?? this.data.code
      void clipboard.writeText(currentCode).then(
        () => {
          copy.replaceChildren(checkIcon())
          copy.title = this.options.copiedLabel
          window.setTimeout(() => {
            if (copy.isConnected) {
              copy.replaceChildren(copyIcon())
              copy.title = this.options.copyLabel
            }
          }, 1200)
        },
        () => {
          copy.replaceChildren(copyIcon())
          copy.title = this.options.copyLabel
        },
      )
    })

    const editorHost = document.createElement('div')
    editorHost.className = 'xmd-cm-code-preview-editor'
    header.append(language, copy)
    container.append(header, editorHost)

    const languageCompartment = new Compartment()
    const controller: CodeWidgetController = {
      data: this.data,
      editor: null as unknown as EditorView,
      languageCompartment,
      loadedLanguage: '',
      syncing: false,
    }
    controller.editor = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: this.data.code,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          languageCompartment.of([]),
          EditorView.lineWrapping,
          // The outer editor draws its own cursor via drawSelection(); without it here,
          // this nested contenteditable falls back to the native caret, which WKWebView
          // (Tauri's macOS webview) sometimes fails to render at all.
          drawSelection(),
          EditorView.theme({
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
            '.cm-content': { caretColor: 'var(--accent)' },
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || controller.syncing) return
            const changes = mapCodeBlockChanges(controller.data.codeFrom, update.changes)
            const previousLength = controller.data.code.length
            controller.data.code = update.state.doc.toString()
            const delta = controller.data.code.length - previousLength
            controller.data.codeTo += delta
            controller.data.to += delta
            outerView.dispatch({
              changes,
            })
          }),
        ],
      }),
    })
    codeControllers.set(container, controller)
    loadCodeLanguage(controller, this.data.language)
    return container
  }

  destroy(dom: HTMLElement): void {
    codeControllers.get(dom)?.editor.destroy()
    codeControllers.delete(dom)
  }

  ignoreEvent(): boolean {
    return true
  }
}

function normalizedLanguageValue(language: string): string {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return ''
  const description = LanguageDescription.matchLanguageName(languages, normalized, true)
  return description?.name.toLowerCase() ?? normalized
}

/** Preserve uncommon/custom info strings instead of silently changing them to text. */
function ensureLanguageOption(select: HTMLSelectElement, language: string): void {
  const value = normalizedLanguageValue(language)
  if (!value || Array.from(select.options).some((option) => option.value === value)) return
  const option = document.createElement('option')
  option.value = value
  option.textContent = language.trim()
  select.append(option)
}

interface CodeWidgetController {
  data: FencedCodeData
  editor: EditorView
  languageCompartment: Compartment
  loadedLanguage: string
  syncing: boolean
}

const codeControllers = new WeakMap<HTMLElement, CodeWidgetController>()

function loadCodeLanguage(controller: CodeWidgetController, language: string): void {
  const normalized = language.trim().toLowerCase()
  if (controller.loadedLanguage === normalized) return
  controller.loadedLanguage = normalized
  const description = LanguageDescription.matchLanguageName(languages, normalized, true)
  void (description?.load() ?? Promise.resolve([])).then((support) => {
    if (controller.loadedLanguage !== normalized || !controller.editor.dom.isConnected) return
    controller.editor.dispatch({ effects: controller.languageCompartment.reconfigure(support) })
  })
}

function touchesSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) return range.head >= from && range.head <= to
    return range.from <= to && range.to >= from
  })
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

function readFencedCode(state: EditorState, from: number, to: number): FencedCodeData {
  let language = ''
  let code = ''
  let languageFrom = from + 3
  let languageTo = languageFrom
  let codeFrom = state.doc.lineAt(from).to + 1
  let codeTo = Math.max(codeFrom, state.doc.lineAt(Math.max(from, to - 1)).from - 1)
  const tree = syntaxTree(state)
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === 'CodeInfo') {
        language = state.doc.sliceString(node.from, node.to).trim()
        languageFrom = node.from
        languageTo = node.to
      }
      if (node.name === 'CodeText') {
        code = state.doc.sliceString(node.from, node.to)
        codeFrom = node.from
        codeTo = node.to
      }
    },
  })
  return { from, to, language, code, languageFrom, languageTo, codeFrom, codeTo }
}

/** Builds fenced-code widgets only for blocks intersecting the supplied viewport. */
export function buildCodeBlockPreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: CodeBlockPreviewOptions = {},
): DecorationSet {
  const decorations: Array<ReturnType<Decoration['range']>> = []
  const margin = Math.max(0, options.viewportMargin ?? 256)
  const widgetOptions = {
    maxHeight: Math.max(120, options.maxHeight ?? 480),
    copyLabel: options.copyLabel ?? 'Copy',
    copiedLabel: options.copiedLabel ?? 'Copied',
  }
  const seen = new Set<string>()

  for (const visible of mergeVisibleRanges(state, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'FencedCode') return
        const key = `${node.from}:${node.to}`
        if (seen.has(key)) return false
        seen.add(key)
        if (touchesSelection(state, node.from, node.to)) return false

        const data = readFencedCode(state, node.from, node.to)
        // Mermaid is owned by the asynchronous diagram extension. If that
        // extension is absent, keeping source visible is safer than overlapping widgets.
        if (data.language.toLowerCase() === 'mermaid') return false
        decorations.push(
          Decoration.replace({
            widget: new FencedCodeWidget(data, widgetOptions),
            block: true,
          }).range(node.from, node.to),
        )
        return false
      },
    })
  }

  return Decoration.set(decorations, true)
}

/** CM6 fenced-code live preview. Must be used alongside the Markdown language extension. */
export function markdownCodeBlockPreview(options: CodeBlockPreviewOptions = {}): Extension {
  return viewportDecorationExtension((view) =>
    buildCodeBlockPreviewDecorations(view.state, view.visibleRanges, options),
  )
}
