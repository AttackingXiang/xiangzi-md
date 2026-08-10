import {
  ChangeSet,
  type EditorState,
  EditorSelection,
  type ChangeSpec,
  type Extension,
  type SelectionRange,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdownFromClipboardHtml } from '../../lib/markdownPaste'
import { emitCodeLanguageFeedback } from '../../lib/codeLanguageFeedback'
import { detectCodeLanguage, type DetectedCodeLanguage } from './codeLanguageDetection'
import { detectClipboardCodeLanguage } from './clipboardCodeLanguage'
import { fencedCodeAtSelection, isCodeBlockPresentation } from './codeBlockDetection'

export interface MarkdownPastePlan {
  changes: ChangeSpec | readonly ChangeSpec[]
  selection?: SelectionRange
  detectedLanguage: string | null
}

/**
 * Build the ordinary paste change and, when applicable, the code-language change.
 * `clipboardLanguage` is what the source application declared about the snippet; it
 * outranks anything inferred from the characters.
 */
export function prepareMarkdownPaste(
  state: EditorState,
  pasted: string,
  clipboardLanguage: DetectedCodeLanguage | null = null,
): MarkdownPastePlan {
  const selection = state.selection.main
  const data = state.selection.ranges.length === 1 ? fencedCodeAtSelection(state) : null
  const rawLanguage = data?.language.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? ''
  const canAutoDetect =
    data !== null &&
    data.closingFrom !== null &&
    isCodeBlockPresentation(state, data) &&
    selection.from >= data.codeFrom &&
    selection.to <= data.codeTo &&
    state.doc.sliceString(data.codeFrom, data.codeTo).trim() === '' &&
    (!rawLanguage || rawLanguage === 'text')
  const detected = canAutoDetect ? (clipboardLanguage ?? detectCodeLanguage(pasted)) : null

  const pasteChange: ChangeSpec = { from: selection.from, to: selection.to, insert: pasted }
  if (!detected || !data) {
    return {
      changes: pasteChange,
      selection: EditorSelection.cursor(selection.from + pasted.length),
      detectedLanguage: null,
    }
  }

  const languageChange: ChangeSpec = {
    from: data.languageFrom,
    to: data.languageTo,
    insert: detected.value,
  }
  const changes = [languageChange, pasteChange]
  const changeSet = ChangeSet.of(changes, state.doc.length)
  const pasteFrom = changeSet.mapPos(selection.from, -1)
  return {
    changes,
    selection: EditorSelection.cursor(pasteFrom + pasted.length),
    detectedLanguage: detected.label,
  }
}

/** Preserve rich clipboard structure by inserting Markdown instead of rendered plain text. */
export function richMarkdownPaste(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (view.state.readOnly) return false
      const clipboard = event.clipboardData
      if (!clipboard || clipboard.files.length > 0) return false
      const html = clipboard.getData('text/html')
      const markdown = html ? markdownFromClipboardHtml(html) : null
      const pasted = markdown ?? clipboard.getData('text/plain')
      if (!pasted) return false

      event.preventDefault()
      const clipboardLanguage = detectClipboardCodeLanguage({
        html,
        editorData: clipboard.getData('vscode-editor-data'),
      })
      const plan = prepareMarkdownPaste(view.state, pasted, clipboardLanguage)
      view.dispatch({
        changes: plan.changes,
        selection: plan.selection,
        userEvent: 'input.paste',
        scrollIntoView: true,
      })
      if (plan.detectedLanguage) emitCodeLanguageFeedback(plan.detectedLanguage)
      return true
    },
  })
}
