import { EditorSelection, type EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { activeCm6Commands } from '../features/cm6-editor/commands'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'
import { fencedCodeContentRange } from '../features/cm6-editor/codeBlockPreview'
import { computeCm6ToolbarState } from '../features/cm6-editor/toolbarState'
import { linkPromptBridge } from './linkPromptBridge'
import { readClipboard } from './clipboardRead'
import { markdownFromClipboardHtml } from './markdownPaste'
import { emitCodeLanguageFeedback } from './codeLanguageFeedback'
import { prepareMarkdownPaste } from '../features/cm6-editor/richPaste'
import { tableCellCommandBridge, type TableCellInlineFormat } from './tableCellCommandBridge'
import { withClipboardFormat } from './copyPreferences'

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
  textColor: (color: string | null): void => {
    if (!tableCellCommandBridge.isFocused()) activeCm6Commands.textColor(color)
  },
  textHighlight: (color: string | null): void => {
    if (!tableCellCommandBridge.isFocused()) activeCm6Commands.textHighlight(color)
  },
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
  // Undo/redo operate on CM6's own history, which already contains table-cell
  // edits as real transactions (bindCellEvents commits every keystroke via
  // view.dispatch) — unlike block formatting, they must work regardless of
  // whether a table cell currently owns DOM focus.
  undo: (): void => void activeCm6Commands.undo(),
  redo: (): void => void activeCm6Commands.redo(),
}

/**
 * 从剪贴板粘贴到当前编辑目标。
 *
 * `document.execCommand('paste')` 在 WebKit 和 Chromium 里都禁止网页内容调用，
 * 所以菜单和右键菜单的「粘贴」以前是彻底无效的（只有 ⌘V/Ctrl+V 能用，因为那条
 * 走的是 WebView 原生路径）。这里改成主动读剪贴板再自己写进文档。
 */
export async function pasteFromClipboard(): Promise<boolean> {
  const clipboard = await readClipboard()
  if (!clipboard) return false

  // 有 HTML 就还原成 Markdown，和 ⌘V 走的 richPaste 是同一个转换器，
  // 这样两条路径粘出来的结果一致。
  const markdown = clipboard.html ? markdownFromClipboardHtml(clipboard.html) : null
  const rich = markdown ?? clipboard.text
  if (!rich) return false

  // 表格单元格是 contenteditable。insertText 与 paste 不同，至今仍受支持，
  // 并且和用户直接输入走同一条 DOM 插入路径（单元格里不该出现块级 Markdown，
  // 所以这里用纯文本）。
  if (tableCellCommandBridge.isFocused()) {
    return clipboard.text ? document.execCommand('insertText', false, clipboard.text) : false
  }

  const view = cm6ActiveViewBridge.get()
  if (!view || view.state.readOnly) return false
  const plan = prepareMarkdownPaste(view.state, rich)
  view.dispatch({
    changes: plan.changes,
    selection: plan.selection,
    userEvent: 'input.paste',
    scrollIntoView: true,
  })
  if (plan.detectedLanguage) emitCodeLanguageFeedback(plan.detectedLanguage)
  view.focus()
  return true
}

export const clipboardCmd = {
  copy: (): void => {
    document.execCommand('copy')
  },
  copyAsPlainText: (): void => {
    withClipboardFormat('plain', () => document.execCommand('copy'))
  },
  copyAsRichText: (): void => {
    withClipboardFormat('rich', () => document.execCommand('copy'))
  },
  cut: (): void => {
    document.execCommand('cut')
  },
  paste: (): void => void pasteFromClipboard(),
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
