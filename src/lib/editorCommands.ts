import { EditorSelection } from '@codemirror/state'
import { activeCm6Commands } from '../features/cm6-editor/commands'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'
import { computeCm6ToolbarState } from '../features/cm6-editor/toolbarState'
import { linkPromptBridge } from './linkPromptBridge'

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export function shiftedHeadingLevel(level: number, direction: 'promote' | 'demote'): HeadingLevel {
  const delta = direction === 'promote' ? -1 : 1
  return Math.min(6, Math.max(1, level + delta)) as HeadingLevel
}

export function getSelectedHeadingLevel(): number | null {
  const view = cm6ActiveViewBridge.get()
  return view ? computeCm6ToolbarState(view.state).headingLevel : null
}

export function hasWysiwyg(): boolean {
  return cm6ActiveViewBridge.get() !== null
}

/** Normalize manually entered links and reject executable protocols. */
export function normalizeLinkHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)?.[1]?.toLowerCase()
  if (!scheme) return `https://${trimmed}`
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? trimmed : null
}

function shiftSelectedHeading(direction: 'promote' | 'demote'): void {
  const level = getSelectedHeadingLevel()
  if (level === null) return
  const next = shiftedHeadingLevel(level, direction)
  if (next !== level) activeCm6Commands.heading(next)
}

function requestLink(): void {
  const originalView = cm6ActiveViewBridge.get()
  if (!originalView) return
  const { anchor, head } = originalView.state.selection.main
  const originalLength = originalView.state.doc.length
  linkPromptBridge.request('', (raw) => {
    const url = normalizeLinkHref(raw)
    const view = cm6ActiveViewBridge.get()
    if (!url || view !== originalView || view.state.doc.length !== originalLength) return
    view.dispatch({ selection: EditorSelection.single(anchor, head) })
    activeCm6Commands.insertLink(url)
  })
}

export const editorCmd = {
  bold: (): void => void activeCm6Commands.bold(),
  italic: (): void => void activeCm6Commands.italic(),
  strike: (): void => void activeCm6Commands.strike(),
  inlineCode: (): void => void activeCm6Commands.inlineCode(),
  heading: (level: number): void => {
    if (level >= 1 && level <= 6) activeCm6Commands.heading(level as HeadingLevel)
  },
  promoteHeading: (): void => shiftSelectedHeading('promote'),
  demoteHeading: (): void => shiftSelectedHeading('demote'),
  paragraph: (): void => void activeCm6Commands.paragraph(),
  codeBlock: (): void => void activeCm6Commands.codeBlock(),
  bulletList: (): void => void activeCm6Commands.bulletList(),
  orderedList: (): void => void activeCm6Commands.orderedList(),
  taskList: (): void => void activeCm6Commands.taskList(),
  quote: (): void => void activeCm6Commands.blockquote(),
  insertTable: (rows = 3, columns = 3): void => void activeCm6Commands.insertTable(rows, columns),
  insertLink: requestLink,
  undo: (): void => void activeCm6Commands.undo(),
  redo: (): void => void activeCm6Commands.redo(),
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
    const view = cm6ActiveViewBridge.get()
    if (!view) return
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    view.focus()
  },
}
