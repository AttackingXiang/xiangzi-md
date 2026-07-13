import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state'
import { redo as cm6Redo, undo as cm6Undo } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import type { Command, EditorView } from '@codemirror/view'
import { cm6ActiveViewBridge } from './activeViewBridge'

export interface MarkdownEditPlan {
  changes: ChangeSpec | readonly ChangeSpec[]
  selection: EditorSelection
}

type InlineMark = '**' | '*' | '~~' | '`'
type LineKind = 'blockquote' | 'bullet' | 'ordered' | 'task'
type MarkdownSyntaxNode = ReturnType<typeof syntaxTree>['topNode']

const INLINE_MARK_SYNTAX: Record<InlineMark, { node: string; delimiter: string }> = {
  '**': { node: 'StrongEmphasis', delimiter: 'EmphasisMark' },
  '*': { node: 'Emphasis', delimiter: 'EmphasisMark' },
  '~~': { node: 'Strikethrough', delimiter: 'StrikethroughMark' },
  '`': { node: 'InlineCode', delimiter: 'CodeMark' },
}

function selection(anchor: number, head = anchor): EditorSelection {
  return EditorSelection.create([EditorSelection.range(anchor, head)])
}

function applyPlan(command: (state: EditorState) => MarkdownEditPlan | null): Command {
  return (target) => {
    if (target.state.readOnly) return false
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

function enclosingNode(
  state: EditorState,
  names: ReadonlySet<string>,
  from = state.selection.main.from,
  to = state.selection.main.to,
): MarkdownSyntaxNode | null {
  const tree = syntaxTree(state)
  const positions = new Set([from, Math.max(from, to - 1), Math.max(0, from - 1)])
  let best: MarkdownSyntaxNode | null = null
  for (const position of positions) {
    let node: MarkdownSyntaxNode | null = tree.resolveInner(position, -1)
    while (node) {
      if (
        names.has(node.name) &&
        node.from <= from &&
        node.to >= to &&
        (!best || node.to - node.from < best.to - best.from)
      ) {
        best = node
      }
      node = node.parent
    }
  }
  return best
}

function selectionMappedThrough(
  state: EditorState,
  changes: readonly ChangeSpec[],
): EditorSelection {
  const mapping = state.changes(changes)
  const range = state.selection.main
  if (range.empty) return selection(mapping.mapPos(range.head, 1))
  const from = mapping.mapPos(range.from, 1)
  const to = mapping.mapPos(range.to, -1)
  return range.anchor <= range.head ? selection(from, to) : selection(to, from)
}

function removeEnclosingInlineMarkPlan(
  state: EditorState,
  mark: InlineMark,
): MarkdownEditPlan | null {
  const syntax = INLINE_MARK_SYNTAX[mark]
  const node = enclosingNode(state, new Set([syntax.node]))
  if (!node) return null
  const delimiters = node.getChildren(syntax.delimiter)
  const opening = delimiters[0]
  const closing = delimiters.at(-1)
  if (!opening || !closing || opening === closing) return null

  const range = state.selection.main
  if (range.from < opening.to || range.to > closing.from) return null
  const openingText = state.sliceDoc(opening.from, opening.to)
  const closingText = state.sliceDoc(closing.from, closing.to)
  const changes: ChangeSpec[] = []

  if (range.empty) {
    changes.push(
      { from: opening.from, to: opening.to, insert: '' },
      { from: closing.from, to: closing.to, insert: '' },
    )
  } else {
    // Remove the mark only from the selected portion while retaining it on any
    // unselected prefix/suffix of the same Markdown span.
    if (range.from === opening.to) changes.push({ from: opening.from, to: opening.to, insert: '' })
    else changes.push({ from: range.from, insert: closingText })
    if (range.to === closing.from) changes.push({ from: closing.from, to: closing.to, insert: '' })
    else changes.push({ from: range.to, insert: openingText })
  }
  return { changes, selection: selectionMappedThrough(state, changes) }
}

function mergeIntersectingInlineMarksPlan(
  state: EditorState,
  mark: InlineMark,
): MarkdownEditPlan | null {
  const range = state.selection.main
  if (range.empty) return null
  const syntax = INLINE_MARK_SYNTAX[mark]
  const spans: Array<{
    node: MarkdownSyntaxNode
    opening: MarkdownSyntaxNode
    closing: MarkdownSyntaxNode
  }> = []
  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      if (node.name !== syntax.node || node.to <= range.from || node.from >= range.to) return
      const delimiters = node.node.getChildren(syntax.delimiter)
      const opening = delimiters[0]
      const closing = delimiters.at(-1)
      if (opening && closing && opening !== closing)
        spans.push({ node: node.node, opening, closing })
    },
  })
  if (!spans.length) return null

  const startSpan = spans.find(
    ({ opening, closing }) => opening.to <= range.from && range.from < closing.from,
  )
  const endSpan = spans.find(
    ({ opening, closing }) => opening.to < range.to && range.to <= closing.from,
  )
  const changes: ChangeSpec[] = []
  for (const span of spans) {
    if (span !== startSpan) {
      changes.push({ from: span.opening.from, to: span.opening.to, insert: '' })
    }
    if (span !== endSpan) {
      changes.push({ from: span.closing.from, to: span.closing.to, insert: '' })
    }
  }
  if (!startSpan) {
    const opening = endSpan ? state.sliceDoc(endSpan.opening.from, endSpan.opening.to) : mark
    changes.push({ from: range.from, insert: opening })
  }
  if (!endSpan) {
    const closing = startSpan ? state.sliceDoc(startSpan.closing.from, startSpan.closing.to) : mark
    changes.push({ from: range.to, insert: closing })
  }
  return { changes, selection: selectionMappedThrough(state, changes) }
}

function inlineMarkPlan(state: EditorState, mark: InlineMark): MarkdownEditPlan {
  const removal = removeEnclosingInlineMarkPlan(state, mark)
  if (removal) return removal
  const merged = mergeIntersectingInlineMarksPlan(state, mark)
  if (merged) return merged
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
  return selectionMappedThrough(state, changes)
}

function linePrefixPlan(
  state: EditorState,
  prefixFor: (
    line: string,
    index: number,
    remove: boolean,
  ) => { offset?: number; remove: number; insert: string },
  isApplied: (line: string) => boolean,
): MarkdownEditPlan {
  const lines = selectedLines(state)
  const meaningful = lines.filter(({ text }) => text.trim().length > 0)
  const remove = meaningful.length > 0 && meaningful.every(({ text }) => isApplied(text))
  const changes = lines.flatMap(({ from, text }, index) => {
    if (!text && remove) return []
    const edit = prefixFor(text, index, remove)
    if (edit.remove === 0 && edit.insert === '') return []
    const offset = edit.offset ?? 0
    return [{ from: from + offset, to: from + offset + edit.remove, insert: edit.insert }]
  })
  return { changes, selection: mappedSelection(state, changes) }
}

const quotePattern = /^( {0,3})> ?/
const listPattern = /^(\s*)(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/

function quotePrefixLength(line: string): number {
  let offset = 0
  for (;;) {
    const match = /^( {0,3})>[ \t]?/.exec(line.slice(offset))
    if (!match) return offset
    offset += match[0].length
  }
}

function blockContainerPrefixLength(line: string): number {
  let offset = 0
  let consumedList = false
  for (;;) {
    const rest = line.slice(offset)
    const quote = /^( {0,3})>[ \t]?/.exec(rest)
    if (quote) {
      offset += quote[0].length
      continue
    }
    if (!consumedList) {
      const list = listPattern.exec(rest)
      if (list) {
        consumedList = true
        offset += list[0].length
        continue
      }
    }
    return offset
  }
}

function lineKindPlan(state: EditorState, kind: LineKind): MarkdownEditPlan {
  const matcher =
    kind === 'blockquote'
      ? (line: string) => quotePattern.test(line)
      : kind === 'task'
        ? (line: string) => /^\s*[-+*]\s+\[[ xX]\]\s+/.test(line.slice(quotePrefixLength(line)))
        : kind === 'ordered'
          ? (line: string) => /^\s*\d+[.)]\s+/.test(line.slice(quotePrefixLength(line)))
          : (line: string) =>
              /^\s*[-+*]\s+(?!\[[ xX]\]\s+)/.test(line.slice(quotePrefixLength(line)))

  return linePrefixPlan(
    state,
    (line, index, remove) => {
      if (kind === 'blockquote') {
        const match = quotePattern.exec(line)
        if (remove) return { remove: match?.[0].length ?? 0, insert: match?.[1] ?? '' }
        return { remove: 0, insert: '> ' }
      }
      const offset = quotePrefixLength(line)
      const rest = line.slice(offset)
      const match = listPattern.exec(rest)
      const indentation = match?.[1] ?? /^\s*/.exec(rest)?.[0] ?? ''
      const removeLength = match?.[0].length ?? indentation.length
      if (remove) return { offset, remove: removeLength, insert: indentation }
      const marker = kind === 'task' ? '- [ ] ' : kind === 'ordered' ? `${index + 1}. ` : '- '
      return { offset, remove: removeLength, insert: indentation + marker }
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
    const containerLength = blockContainerPrefixLength(text)
    const match = headingPattern.exec(text.slice(containerLength))
    const indentation = match?.[1] ?? ''
    return {
      from: from + containerLength,
      to: from + containerLength + (match?.[0].length ?? 0),
      insert: level === null ? indentation : `${indentation}${'#'.repeat(level)} `,
    }
  })
  return { changes, selection: mappedSelection(state, changes) }
}

function planPlainParagraph(state: EditorState): MarkdownEditPlan {
  const lines = selectedLines(state)
  const changes = lines.flatMap(({ from, text }) => {
    const containerLength = blockContainerPrefixLength(text)
    const heading = /^( {0,3})#{1,6}[ \t]+/.exec(text.slice(containerLength))
    const remove = containerLength + (heading?.[0].length ?? 0)
    if (!remove) return []
    return [
      {
        from,
        to: from + remove,
        insert: containerLength === 0 ? (heading?.[1] ?? '') : '',
      },
    ]
  })
  return { changes, selection: selectionMappedThrough(state, changes) }
}

export function planCodeFence(state: EditorState, language = ''): MarkdownEditPlan {
  const original = state.selection.main
  const line = state.doc.lineAt(original.head)
  const range = original.empty && line.length > 0 ? { from: line.from, to: line.to } : original
  const selected = state.sliceDoc(range.from, range.to)
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(selected.matchAll(/`+/g), (run) => run[0].length),
  )
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1))
  const safeLanguage = language.replace(/[\r\n`~]/g, '').trim()
  const opening = `${fence}${safeLanguage}`
  if (range.from === range.to) {
    const inserted = `${opening}\n\n\`\`\``
    return {
      changes: { from: range.from, insert: inserted },
      selection: selection(range.from + opening.length + 1),
    }
  }
  const leading =
    range.from > 0 && state.sliceDoc(range.from - 1, range.from) !== '\n' ? '\n\n' : ''
  const trailing =
    range.to < state.doc.length && state.sliceDoc(range.to, range.to + 1) !== '\n' ? '\n\n' : ''
  const inserted = `${leading}${opening}\n${selected}\n${fence}${trailing}`
  const contentFrom = range.from + leading.length + opening.length + 1
  return {
    changes: { from: range.from, to: range.to, insert: inserted },
    selection: selection(contentFrom, contentFrom + selected.length),
  }
}

export function planParagraph(state: EditorState): MarkdownEditPlan {
  const fenced = enclosingNode(state, new Set(['FencedCode']))
  if (fenced) {
    const opening = state.doc.lineAt(fenced.from)
    const possibleClosing = state.doc.lineAt(Math.max(fenced.from, fenced.to - 1))
    const hasClosing = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.test(possibleClosing.text)
    const changes: ChangeSpec[] = [
      {
        from: opening.from,
        to: Math.min(state.doc.length, opening.to + 1),
        insert: '',
      },
    ]
    if (hasClosing && possibleClosing.from !== opening.from) {
      changes.push({
        from: possibleClosing.from,
        to: Math.min(state.doc.length, possibleClosing.to + 1),
        insert: '',
      })
    }
    return { changes, selection: selectionMappedThrough(state, changes) }
  }

  const indented = enclosingNode(state, new Set(['CodeBlock', 'IndentedCode']))
  if (!indented) return planPlainParagraph(state)
  const changes: ChangeSpec[] = []
  let line = state.doc.lineAt(indented.from)
  while (line.from <= indented.to) {
    const indentation = /^(?: {4}|\t)/.exec(line.text)?.[0]
    if (indentation)
      changes.push({ from: line.from, to: line.from + indentation.length, insert: '' })
    if (line.number >= state.doc.lines || line.to >= indented.to) break
    line = state.doc.line(line.number + 1)
  }
  return { changes, selection: selectionMappedThrough(state, changes) }
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

export function planRemoveLink(state: EditorState): MarkdownEditPlan | null {
  const node = enclosingNode(state, new Set(['Link', 'Autolink']))
  if (!node) return null
  if (node.name === 'Autolink') {
    const text = state.sliceDoc(node.from + 1, node.to - 1)
    const offset = Math.max(0, Math.min(text.length, state.selection.main.head - node.from - 1))
    return {
      changes: { from: node.from, to: node.to, insert: text },
      selection: selection(node.from + offset),
    }
  }
  const marks = node.getChildren('LinkMark')
  const closingLabel = marks.find((mark) => state.sliceDoc(mark.from, mark.to) === ']')
  if (!closingLabel) return null
  const labelFrom = node.from + 1
  const label = state.sliceDoc(labelFrom, closingLabel.from)
  const range = state.selection.main
  const relativeFrom = Math.max(0, Math.min(label.length, range.from - labelFrom))
  const relativeTo = Math.max(0, Math.min(label.length, range.to - labelFrom))
  return {
    changes: { from: node.from, to: node.to, insert: label },
    selection: selection(node.from + relativeFrom, node.from + relativeTo),
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
  const leading =
    range.from > 0 && state.sliceDoc(range.from - 1, range.from) !== '\n' ? '\n\n' : ''
  const trailing =
    range.to < state.doc.length && state.sliceDoc(range.to, range.to + 1) !== '\n' ? '\n\n' : ''
  return {
    changes: { from: range.from, to: range.to, insert: `${leading}${inserted}${trailing}` },
    selection: selection(range.from + leading.length + 2, range.from + leading.length + 5),
  }
}

export const toggleBold = applyPlan((state) => inlineMarkPlan(state, '**'))
export const toggleItalic = applyPlan((state) => inlineMarkPlan(state, '*'))
export const toggleStrike = applyPlan((state) => inlineMarkPlan(state, '~~'))
export const toggleInlineCode = applyPlan((state) => inlineMarkPlan(state, '`'))
export const setHeading = (level: 1 | 2 | 3 | 4 | 5 | 6): Command =>
  applyPlan((state) => planHeading(state, level))
export const setParagraph = applyPlan(planParagraph)
export const toggleBlockquote = applyPlan((state) => lineKindPlan(state, 'blockquote'))
export const toggleBulletList = applyPlan((state) => lineKindPlan(state, 'bullet'))
export const toggleOrderedList = applyPlan((state) => lineKindPlan(state, 'ordered'))
export const toggleTaskList = applyPlan((state) => lineKindPlan(state, 'task'))
export const insertCodeFence = (language = ''): Command =>
  applyPlan((state) =>
    enclosingNode(state, new Set(['FencedCode', 'CodeBlock', 'IndentedCode']))
      ? planParagraph(state)
      : planCodeFence(state, language),
  )
export const insertLink = (url = 'https://'): Command =>
  applyPlan((state) => planInsertLink(state, url))
export const removeLink: Command = applyPlan(planRemoveLink)
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
  removeLink: () => boolean
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
    if (!view || view.state.readOnly) return false
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
    removeLink: () => run(removeLink),
    insertTable: (rows = 3, columns = 3) => run(insertTable(rows, columns)),
    undo: () => run(cm6Undo),
    redo: () => run(cm6Redo),
  }
}

export const activeCm6Commands = createCm6Commands()
