import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state'
import { redo as cm6Redo, undo as cm6Undo } from '@codemirror/commands'
import type { Command, EditorView } from '@codemirror/view'
import { cm6ActiveViewBridge } from './activeViewBridge'

export interface MarkdownEditPlan {
  changes: ChangeSpec | readonly ChangeSpec[]
  selection: EditorSelection
}

type InlineMark = '**' | '*' | '~~' | '`'
type LineKind = 'blockquote' | 'bullet' | 'ordered' | 'task'

function selection(anchor: number, head = anchor): EditorSelection {
  return EditorSelection.create([EditorSelection.range(anchor, head)])
}

function applyPlan(command: (state: EditorState) => MarkdownEditPlan | null): Command {
  return (target) => {
    const plan = command(target.state)
    if (!plan) return false
    target.dispatch(
      target.state.update({
        changes: plan.changes,
        selection: plan.selection,
        scrollIntoView: true,
      }),
    )
    return true
  }
}

function inlineMarkPlan(state: EditorState, mark: InlineMark): MarkdownEditPlan {
  const range = state.selection.main
  const selected = state.sliceDoc(range.from, range.to)
  const before = state.sliceDoc(Math.max(0, range.from - mark.length), range.from)
  const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + mark.length))

  if (!range.empty && before === mark && after === mark) {
    return {
      changes: [
        { from: range.from - mark.length, to: range.from, insert: '' },
        { from: range.to, to: range.to + mark.length, insert: '' },
      ],
      selection: selection(range.from - mark.length, range.to - mark.length),
    }
  }

  if (range.empty) {
    return {
      changes: { from: range.from, insert: mark + mark },
      selection: selection(range.from + mark.length),
    }
  }

  return {
    changes: { from: range.from, to: range.to, insert: `${mark}${selected}${mark}` },
    selection: selection(range.from + mark.length, range.to + mark.length),
  }
}

function selectedLines(state: EditorState): Array<{ from: number; text: string }> {
  const range = state.selection.main
  const first = state.doc.lineAt(range.from).number
  // A selection ending at the start of a line conventionally excludes that line.
  const lastPos =
    range.to > range.from && state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to
  const last = state.doc.lineAt(lastPos).number
  const lines: Array<{ from: number; text: string }> = []
  for (let number = first; number <= last; number += 1) {
    const line = state.doc.line(number)
    lines.push({ from: line.from, text: line.text })
  }
  return lines
}

function mappedSelection(state: EditorState, changes: readonly ChangeSpec[]): EditorSelection {
  const mapping = state.changes(changes)
  const range = state.selection.main
  if (range.empty) return selection(mapping.mapPos(range.head, 1))
  return selection(mapping.mapPos(range.anchor, 1), mapping.mapPos(range.head, -1))
}

function linePrefixPlan(
  state: EditorState,
  prefixFor: (line: string, index: number, remove: boolean) => { remove: number; insert: string },
  isApplied: (line: string) => boolean,
): MarkdownEditPlan {
  const lines = selectedLines(state)
  const meaningful = lines.filter(({ text }) => text.trim().length > 0)
  const remove = meaningful.length > 0 && meaningful.every(({ text }) => isApplied(text))
  const changes = lines.flatMap(({ from, text }, index) => {
    if (!text && remove) return []
    const edit = prefixFor(text, index, remove)
    if (edit.remove === 0 && edit.insert === '') return []
    return [{ from, to: from + edit.remove, insert: edit.insert }]
  })
  return { changes, selection: mappedSelection(state, changes) }
}

const quotePattern = /^( {0,3})> ?/
const listPattern = /^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/

function lineKindPlan(state: EditorState, kind: LineKind): MarkdownEditPlan {
  const matcher =
    kind === 'blockquote'
      ? (line: string) => quotePattern.test(line)
      : kind === 'task'
        ? (line: string) => /^\s*[-+*]\s+\[[ xX]\]\s+/.test(line)
        : kind === 'ordered'
          ? (line: string) => /^\s*\d+[.)]\s+/.test(line)
          : (line: string) => /^\s*[-+*]\s+(?!\[[ xX]\]\s+)/.test(line)

  return linePrefixPlan(
    state,
    (line, index, remove) => {
      if (kind === 'blockquote') {
        const match = quotePattern.exec(line)
        if (remove) return { remove: match?.[0].length ?? 0, insert: match?.[1] ?? '' }
        return { remove: 0, insert: '> ' }
      }
      const match = listPattern.exec(line)
      const indentation = match?.[1] ?? /^\s*/.exec(line)?.[0] ?? ''
      const removeLength = match?.[0].length ?? indentation.length
      if (remove) return { remove: removeLength, insert: indentation }
      const marker = kind === 'task' ? '- [ ] ' : kind === 'ordered' ? `${index + 1}. ` : '- '
      return { remove: removeLength, insert: indentation + marker }
    },
    matcher,
  )
}

export function planHeading(
  state: EditorState,
  level: 1 | 2 | 3 | 4 | 5 | 6 | null,
): MarkdownEditPlan {
  const headingPattern = /^( {0,3})#{1,6}[ \t]+/
  const lines = selectedLines(state)
  const changes = lines.map(({ from, text }) => {
    const match = headingPattern.exec(text)
    const indentation = match?.[1] ?? ''
    return {
      from,
      to: from + (match?.[0].length ?? 0),
      insert: level === null ? indentation : `${indentation}${'#'.repeat(level)} `,
    }
  })
  return { changes, selection: mappedSelection(state, changes) }
}

export function planCodeFence(state: EditorState, language = ''): MarkdownEditPlan {
  const range = state.selection.main
  const selected = state.sliceDoc(range.from, range.to)
  const opening = `\`\`\`${language}`
  if (range.empty) {
    const inserted = `${opening}\n\n\`\`\``
    return {
      changes: { from: range.from, insert: inserted },
      selection: selection(range.from + opening.length + 1),
    }
  }
  const inserted = `${opening}\n${selected}\n\`\`\``
  return {
    changes: { from: range.from, to: range.to, insert: inserted },
    selection: selection(
      range.from + opening.length + 1,
      range.from + opening.length + 1 + selected.length,
    ),
  }
}

export function planInsertLink(state: EditorState, url = 'https://'): MarkdownEditPlan {
  const range = state.selection.main
  const label = range.empty ? '链接文字' : state.sliceDoc(range.from, range.to)
  const inserted = `[${label}](${url})`
  return {
    changes: { from: range.from, to: range.to, insert: inserted },
    selection: selection(range.from + 1, range.from + 1 + label.length),
  }
}

export function planInsertTable(
  state: EditorState,
  rows = 3,
  columns = 3,
): MarkdownEditPlan | null {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 2 || columns < 1) return null
  const range = state.selection.main
  const header = `| ${Array.from({ length: columns }, (_, i) => `列 ${i + 1}`).join(' | ')} |`
  const separator = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
  const body = Array.from(
    { length: rows - 1 },
    () => `| ${Array.from({ length: columns }, () => '   ').join(' | ')} |`,
  )
  const inserted = [header, separator, ...body].join('\n')
  return {
    changes: { from: range.from, to: range.to, insert: inserted },
    selection: selection(range.from + 2, range.from + 5),
  }
}

export const toggleBold = applyPlan((state) => inlineMarkPlan(state, '**'))
export const toggleItalic = applyPlan((state) => inlineMarkPlan(state, '*'))
export const toggleStrike = applyPlan((state) => inlineMarkPlan(state, '~~'))
export const toggleInlineCode = applyPlan((state) => inlineMarkPlan(state, '`'))
export const setHeading = (level: 1 | 2 | 3 | 4 | 5 | 6): Command =>
  applyPlan((state) => planHeading(state, level))
export const setParagraph = applyPlan((state) => planHeading(state, null))
export const toggleBlockquote = applyPlan((state) => lineKindPlan(state, 'blockquote'))
export const toggleBulletList = applyPlan((state) => lineKindPlan(state, 'bullet'))
export const toggleOrderedList = applyPlan((state) => lineKindPlan(state, 'ordered'))
export const toggleTaskList = applyPlan((state) => lineKindPlan(state, 'task'))
export const insertCodeFence = (language = ''): Command =>
  applyPlan((state) => planCodeFence(state, language))
export const insertLink = (url = 'https://'): Command =>
  applyPlan((state) => planInsertLink(state, url))
export const insertTable = (rows = 3, columns = 3): Command =>
  applyPlan((state) => planInsertTable(state, rows, columns))

export interface Cm6Commands {
  bold: () => boolean
  italic: () => boolean
  strike: () => boolean
  inlineCode: () => boolean
  heading: (level: 1 | 2 | 3 | 4 | 5 | 6) => boolean
  paragraph: () => boolean
  blockquote: () => boolean
  codeBlock: (language?: string) => boolean
  bulletList: () => boolean
  orderedList: () => boolean
  taskList: () => boolean
  insertLink: (url?: string) => boolean
  insertTable: (rows?: number, columns?: number) => boolean
  undo: () => boolean
  redo: () => boolean
}

/** Bind toolbar-safe commands to a view lookup so tab switches never retain a stale view. */
export function createCm6Commands(
  getView: () => EditorView | null = () => cm6ActiveViewBridge.get(),
): Cm6Commands {
  const run = (command: Command): boolean => {
    const view = getView()
    if (!view) return false
    const handled = command(view)
    if (handled) view.focus()
    return handled
  }
  return {
    bold: () => run(toggleBold),
    italic: () => run(toggleItalic),
    strike: () => run(toggleStrike),
    inlineCode: () => run(toggleInlineCode),
    heading: (level) => run(setHeading(level)),
    paragraph: () => run(setParagraph),
    blockquote: () => run(toggleBlockquote),
    codeBlock: (language = '') => run(insertCodeFence(language)),
    bulletList: () => run(toggleBulletList),
    orderedList: () => run(toggleOrderedList),
    taskList: () => run(toggleTaskList),
    insertLink: (url = 'https://') => run(insertLink(url)),
    insertTable: (rows = 3, columns = 3) => run(insertTable(rows, columns)),
    undo: () => run(cm6Undo),
    redo: () => run(cm6Redo),
  }
}

export const activeCm6Commands = createCm6Commands()
