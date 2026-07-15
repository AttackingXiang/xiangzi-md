import { EditorSelection, type EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { activeCm6Commands } from '../features/cm6-editor/commands'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'
import { fencedCodeContentRange } from '../features/cm6-editor/codeBlockPreview'
import { computeCm6ToolbarState } from '../features/cm6-editor/toolbarState'
import { linkPromptBridge } from './linkPromptBridge'
import { tableCellCommandBridge, type TableCellInlineFormat } from './tableCellCommandBridge'

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export function shiftedHeadingLevel(level: number, direction: 'promote' | 'demote'): HeadingLevel {
  const delta = direction === 'promote' ? -1 : 1
  return Math.min(6, Math.max(1, level + delta)) as HeadingLevel
}

export function getSelectedHeadingLevel(): number | null {
  if (tableCellCommandBridge.isFocused()) return null
  const view = cm6ActiveViewBridge.get()
  return view ? computeCm6ToolbarState(view.state).headingLevel : null
}

export function hasWysiwyg(): boolean {
  const view = cm6ActiveViewBridge.get()
  return view !== null && !view.state.readOnly
}

/** Normalize manually entered links and reject executable protocols. */
export function normalizeLinkHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('#') || /^(?:\.\.?\/|\/)/.test(trimmed)) return trimmed
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)?.[1]?.toLowerCase()
  if (!scheme) return `https://${trimmed}`
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? trimmed : null
}

function shiftSelectedHeading(direction: 'promote' | 'demote'): void {
  if (tableCellCommandBridge.isFocused()) return
  const level = getSelectedHeadingLevel()
  if (level === null) return
  const next = shiftedHeadingLevel(level, direction)
  if (next !== level) activeCm6Commands.heading(next)
}

function requestLink(): void {
  if (tableCellCommandBridge.isFocused()) return
  const originalView = cm6ActiveViewBridge.get()
  if (!originalView || originalView.state.readOnly) return
  if (computeCm6ToolbarState(originalView.state).link) {
    activeCm6Commands.removeLink()
    return
  }
  const { anchor, head } = originalView.state.selection.main
  const originalDoc = originalView.state.doc
  linkPromptBridge.request('', (raw) => {
    const url = normalizeLinkHref(raw)
    const view = cm6ActiveViewBridge.get()
    if (!url || view !== originalView || view.state.doc !== originalDoc) return
    view.dispatch({ selection: EditorSelection.single(anchor, head) })
    activeCm6Commands.insertLink(url)
  })
}

function runInlineCommand(format: TableCellInlineFormat, fallback: () => boolean): void {
  if (tableCellCommandBridge.isFocused()) {
    tableCellCommandBridge.runInline(format)
    return
  }
  fallback()
}

function runBlockCommand(command: () => boolean): void {
  if (!tableCellCommandBridge.isFocused()) command()
}

export const editorCmd = {
  bold: (): void => runInlineCommand('bold', activeCm6Commands.bold),
  italic: (): void => runInlineCommand('italic', activeCm6Commands.italic),
  strike: (): void => runInlineCommand('strike', activeCm6Commands.strike),
  inlineCode: (): void => runInlineCommand('inlineCode', activeCm6Commands.inlineCode),
  heading: (level: number): void => {
    if (level >= 1 && level <= 6) {
      runBlockCommand(() => activeCm6Commands.heading(level as HeadingLevel))
    }
  },
  promoteHeading: (): void => shiftSelectedHeading('promote'),
  demoteHeading: (): void => shiftSelectedHeading('demote'),
  paragraph: (): void => runBlockCommand(activeCm6Commands.paragraph),
  codeBlock: (): void => runBlockCommand(activeCm6Commands.codeBlock),
  bulletList: (): void => runBlockCommand(activeCm6Commands.bulletList),
  orderedList: (): void => runBlockCommand(activeCm6Commands.orderedList),
  taskList: (): void => runBlockCommand(activeCm6Commands.taskList),
  quote: (): void => runBlockCommand(activeCm6Commands.blockquote),
  insertTable: (rows = 3, columns = 3): void =>
    runBlockCommand(() => activeCm6Commands.insertTable(rows, columns)),
  insertLink: requestLink,
  undo: (): void => runBlockCommand(activeCm6Commands.undo),
  redo: (): void => runBlockCommand(activeCm6Commands.redo),
}

export const clipboardCmd = {
  copy: (): void => {
    document.execCommand('copy')
  },
  cut: (): void => {
    document.execCommand('cut')
  },
  paste: (): void => {
    document.execCommand('paste')
  },
  selectAll: (): void => {
    if (tableCellCommandBridge.selectAll()) return
    const view = cm6ActiveViewBridge.get()
    if (!view) return
    const scope = selectAllScope(view.state)
    view.dispatch({ selection: { anchor: scope.from, head: scope.to } })
    view.focus()
  },
}

export function selectAllScope(state: EditorState): {
  from: number
  to: number
} {
  if (state.readOnly) return { from: 0, to: state.doc.length }
  const range = state.selection.main
  // Markdown parsing is scheduled in the background. Under a busy editor (and
  // in the parallel test suite) syntaxTree() can still be the initial partial
  // tree, which made Cmd/Ctrl+A intermittently select the whole document while
  // the caret was inside a fenced block. Ensure parsing has reached the caret
  // before resolving its ancestors; keep the existing tree as a safe fallback
  // (`fencedCodeContentRange` defaults to `syntaxTree(state)` when omitted).
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, range.head + 1), 100) ?? undefined
  // Delegate to the same tree-driven fence detection the CM6 `Mod-a` keymap
  // uses (`fencedCodeContentRange` in `codeBlockPreview.ts`) instead of a
  // second hand-rolled tree walk + closing-fence regex, which could disagree
  // with it for a fence indented ≥4 spaces under a list item.
  const scope = fencedCodeContentRange(state, range.head, tree)
  return scope ?? { from: 0, to: state.doc.length }
}
