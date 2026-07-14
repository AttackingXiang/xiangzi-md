import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view'
import { GFM, parser as markdownParser } from '@lezer/markdown'
import {
  tableCellCommandBridge,
  type TableCellCommandState,
  type TableCellInlineFormat,
} from '../../lib/tableCellCommandBridge'
import './tablePreview.css'

export type TableAlignment = 'left' | 'center' | 'right' | null
export interface MarkdownTableCell {
  from: number
  to: number
  text: string
}
export interface MarkdownTableMatch {
  from: number
  to: number
  source: string
  header: MarkdownTableCell[]
  rows: MarkdownTableCell[][]
  alignments: TableAlignment[]
}
export interface MarkdownTablePreviewOptions {
  bufferChars?: number
  /** Initial CM6 viewport estimate only. The rendered table is always measured from its DOM. */
  rowHeight?: number
}

const DEFAULT_BUFFER_CHARS = 2_000
const DEFAULT_ROW_HEIGHT = 38
const tableCellParser = markdownParser.configure([GFM])

export type TableInlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'break'; source: string }
  | {
      kind: 'strong' | 'emphasis' | 'strike' | 'code' | 'link' | 'plain'
      prefix: string
      suffix: string
      children: TableInlinePart[]
    }

type TableCellSyntaxNode = ReturnType<typeof tableCellParser.parse>['topNode']

function textPart(text: string): TableInlinePart[] {
  return text ? [{ kind: 'text', text }] : []
}

function directChildren(node: TableCellSyntaxNode, name: string): TableCellSyntaxNode[] {
  const matches: TableCellSyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) matches.push(child)
  }
  return matches
}

function inlinePartsInRange(
  node: TableCellSyntaxNode,
  source: string,
  from: number,
  to: number,
): TableInlinePart[] {
  const parts: TableInlinePart[] = []
  let cursor = from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.to <= from) continue
    if (child.from >= to) break
    if (child.from > cursor) parts.push(...textPart(source.slice(cursor, Math.min(child.from, to))))
    if (child.from >= from && child.to <= to) parts.push(...inlinePartForNode(child, source))
    cursor = Math.max(cursor, Math.min(child.to, to))
  }
  if (cursor < to) parts.push(...textPart(source.slice(cursor, to)))
  return parts
}

function markedInlinePart(
  node: TableCellSyntaxNode,
  source: string,
  kind: Exclude<TableInlinePart['kind'], 'text' | 'break' | 'link'>,
  markerName: string,
): TableInlinePart[] {
  const marks = directChildren(node, markerName)
  if (marks.length < 2) return textPart(source.slice(node.from, node.to))
  const contentFrom = marks[0].to
  const contentTo = marks[marks.length - 1].from
  return [
    {
      kind,
      prefix: source.slice(node.from, contentFrom),
      suffix: source.slice(contentTo, node.to),
      children: inlinePartsInRange(node, source, contentFrom, contentTo),
    },
  ]
}

function inlinePartForNode(node: TableCellSyntaxNode, source: string): TableInlinePart[] {
  if (node.name === 'StrongEmphasis')
    return markedInlinePart(node, source, 'strong', 'EmphasisMark')
  if (node.name === 'Emphasis') return markedInlinePart(node, source, 'emphasis', 'EmphasisMark')
  if (node.name === 'Strikethrough')
    return markedInlinePart(node, source, 'strike', 'StrikethroughMark')
  if (node.name === 'InlineCode') return markedInlinePart(node, source, 'code', 'CodeMark')
  if (node.name === 'Link' || node.name === 'Autolink') {
    const marks = directChildren(node, 'LinkMark')
    if (marks.length < 2) return textPart(source.slice(node.from, node.to))
    const contentFrom = marks[0].to
    const contentTo = marks[1].from
    return [
      {
        kind: 'link',
        prefix: source.slice(node.from, contentFrom),
        suffix: source.slice(contentTo, node.to),
        children: inlinePartsInRange(node, source, contentFrom, contentTo),
      },
    ]
  }
  if (node.name === 'URL') {
    return [
      {
        kind: 'link',
        prefix: '',
        suffix: '',
        children: textPart(source.slice(node.from, node.to)),
      },
    ]
  }
  if (node.name === 'Escape') {
    return [
      {
        kind: 'plain',
        prefix: source.slice(node.from, node.from + 1),
        suffix: '',
        children: textPart(source.slice(node.from + 1, node.to)),
      },
    ]
  }
  if (node.name === 'HTMLTag' && CELL_BREAK_PATTERN.test(source.slice(node.from, node.to))) {
    return [{ kind: 'break', source: source.slice(node.from, node.to) }]
  }
  if (!node.firstChild) return textPart(source.slice(node.from, node.to))
  return inlinePartsInRange(node, source, node.from, node.to)
}

/** Parse the safe, editable subset of Markdown inline syntax used inside a GFM table cell. */
export function parseTableCellInline(source: string): TableInlinePart[] {
  return inlinePartsInRange(tableCellParser.parse(source).topNode, source, 0, source.length)
}

function inlinePlainText(parts: readonly TableInlinePart[]): string {
  return parts
    .map((part) =>
      part.kind === 'text'
        ? part.text
        : part.kind === 'break'
          ? '\n'
          : inlinePlainText(part.children),
    )
    .join('')
}

export function serializeTableCellInline(parts: readonly TableInlinePart[]): string {
  return parts
    .map((part) =>
      part.kind === 'text'
        ? part.text
        : part.kind === 'break'
          ? part.source
          : `${part.prefix}${serializeTableCellInline(part.children)}${part.suffix}`,
    )
    .join('')
}

export function splitMarkdownTableRow(text: string, lineFrom: number): MarkdownTableCell[] {
  const delimiters: number[] = []
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '|') continue
    let slashes = 0
    for (let before = index - 1; before >= 0 && text[before] === '\\'; before--) slashes++
    if (slashes % 2 === 0) delimiters.push(index)
  }
  if (!delimiters.length) return []
  const startsWithPipe = text.slice(0, delimiters[0]).trim() === ''
  const endsWithPipe = text.slice(delimiters.at(-1)! + 1).trim() === ''
  const contentFrom = startsWithPipe ? delimiters[0] + 1 : 0
  const contentTo = endsWithPipe ? delimiters.at(-1)! : text.length
  const separators = delimiters.filter(
    (delimiter) => delimiter >= contentFrom && delimiter < contentTo,
  )
  const spans: { from: number; to: number }[] = []
  let cursor = contentFrom
  for (const separator of separators) {
    spans.push({ from: cursor, to: separator })
    cursor = separator + 1
  }
  spans.push({ from: cursor, to: contentTo })
  const cells: MarkdownTableCell[] = []
  for (const span of spans) {
    const rawFrom = span.from
    const rawTo = span.to
    const raw = text.slice(rawFrom, rawTo)
    const leading = raw.length - raw.trimStart().length
    const trailing = raw.length - raw.trimEnd().length
    const from = lineFrom + rawFrom + leading
    const to = Math.max(from, lineFrom + rawTo - trailing)
    cells.push({ from, to, text: raw.trim().replace(/\\\|/g, '|').replace(/\\\\/g, '\\') })
  }
  return cells
}

function alignment(cell: MarkdownTableCell): TableAlignment {
  const value = cell.text.trim()
  if (!/^:?-+:?$/.test(value)) return null
  if (value.startsWith(':') && value.endsWith(':')) return 'center'
  return value.endsWith(':') ? 'right' : 'left'
}

export function parseMarkdownTable(
  state: EditorState,
  from: number,
  to: number,
): MarkdownTableMatch | null {
  const lines = []
  for (let position = from; position <= to; ) {
    const line = state.doc.lineAt(position)
    lines.push(line)
    if (line.to >= to) break
    position = line.to + 1
  }
  if (lines.length < 2) return null
  const header = splitMarkdownTableRow(lines[0].text, lines[0].from)
  const delimiter = splitMarkdownTableRow(lines[1].text, lines[1].from)
  if (!header.length || delimiter.length !== header.length) return null
  const alignments = delimiter.map(alignment)
  if (alignments.some((item) => item === null)) return null
  return {
    from,
    to,
    source: state.doc.sliceString(from, to),
    header,
    alignments,
    rows: lines.slice(2).map((line) => splitMarkdownTableRow(line.text, line.from)),
  }
}

export function findVisibleMarkdownTables(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  bufferChars = DEFAULT_BUFFER_CHARS,
): MarkdownTableMatch[] {
  const tables: MarkdownTableMatch[] = []
  const seen = new Set<number>()
  const tree = syntaxTree(state)
  for (const visible of visibleRanges) {
    const from = state.doc.lineAt(Math.max(0, visible.from - bufferChars)).from
    const to = state.doc.lineAt(Math.min(state.doc.length, visible.to + bufferChars)).to
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'Table' || seen.has(node.from)) return
        const table = parseMarkdownTable(state, node.from, node.to)
        if (table) tables.push(table)
        seen.add(node.from)
      },
    })
  }
  return tables.sort((a, b) => a.from - b.from)
}

/** Re-escape a cell's plain text back into Markdown table syntax. */
function escapeTableCellText(value: string): string {
  let escaped = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '|') {
      let slashes = 0
      for (let before = index - 1; before >= 0 && value[before] === '\\'; before -= 1) slashes += 1
      if (slashes % 2 === 0) escaped += '\\'
    }
    escaped += character
  }
  return escaped
}

/** Plain-text snapshot of a table, used as the working copy for row/column edits. */
export interface TableData {
  header: string[]
  rows: string[][]
  alignments: TableAlignment[]
}

export function toTableData(table: MarkdownTableMatch): TableData {
  const columnCount = table.header.length
  return {
    header: table.header.map((cell) => cell.text),
    // GFM ignores surplus body cells and renders missing cells as empty. Keep the
    // editable model consistent with that visual column count before structural edits.
    rows: table.rows.map((row) =>
      Array.from({ length: columnCount }, (_, column) => row[column]?.text ?? ''),
    ),
    alignments: [...table.alignments],
  }
}

function alignmentMarker(align: TableAlignment): string {
  if (align === 'center') return ':---:'
  if (align === 'right') return '----:'
  if (align === 'left') return ':----'
  return '----'
}

function serializeRow(cells: string[]): string {
  return `| ${cells.map(escapeTableCellText).join(' | ')} |`
}

export function serializeTableData(data: TableData): string {
  return [
    serializeRow(data.header),
    serializeRow(data.alignments.map(alignmentMarker)),
    ...data.rows.map(serializeRow),
  ].join('\n')
}

/** Row/column structural edits. `rowIndex`/`columnIndex` are 0-based into `data.rows`/cells;
 *  the header row is addressed separately since it can't be deleted or reordered. */
export function insertRowAt(data: TableData, rowIndex: number): TableData {
  const rows = [...data.rows]
  rows.splice(
    rowIndex,
    0,
    data.header.map(() => ''),
  )
  return { ...data, rows }
}
export function deleteRowAt(data: TableData, rowIndex: number): TableData {
  return { ...data, rows: data.rows.filter((_, index) => index !== rowIndex) }
}
export function insertColumnAt(data: TableData, columnIndex: number): TableData {
  const header = [...data.header]
  header.splice(columnIndex, 0, '')
  const alignments = [...data.alignments]
  alignments.splice(columnIndex, 0, null)
  const rows = data.rows.map((row) => {
    const next = [...row]
    next.splice(columnIndex, 0, '')
    return next
  })
  return { header, alignments, rows }
}
export function deleteColumnAt(data: TableData, columnIndex: number): TableData {
  return {
    header: data.header.filter((_, index) => index !== columnIndex),
    alignments: data.alignments.filter((_, index) => index !== columnIndex),
    rows: data.rows.map((row) => row.filter((_, index) => index !== columnIndex)),
  }
}
export function moveRowAt(data: TableData, rowIndex: number, targetIndex: number): TableData {
  if (
    rowIndex < 0 ||
    rowIndex >= data.rows.length ||
    targetIndex < 0 ||
    targetIndex >= data.rows.length ||
    rowIndex === targetIndex
  )
    return data
  const rows = data.rows.map((row) => [...row])
  const [row] = rows.splice(rowIndex, 1)
  rows.splice(targetIndex, 0, row)
  return { ...data, rows }
}

export function moveColumnAt(data: TableData, columnIndex: number, targetIndex: number): TableData {
  if (
    columnIndex < 0 ||
    columnIndex >= data.header.length ||
    targetIndex < 0 ||
    targetIndex >= data.header.length ||
    columnIndex === targetIndex
  )
    return data
  const move = <T>(values: T[]): T[] => {
    const next = [...values]
    const [value] = next.splice(columnIndex, 1)
    next.splice(targetIndex, 0, value)
    return next
  }
  return {
    header: move(data.header),
    alignments: move(data.alignments),
    rows: data.rows.map((row) =>
      move(Array.from({ length: data.header.length }, (_, index) => row[index] ?? '')),
    ),
  }
}

export function setColumnAlignment(
  data: TableData,
  columnIndex: number,
  align: TableAlignment,
): TableData {
  const alignments = [...data.alignments]
  alignments[columnIndex] = align
  return { ...data, alignments }
}

export function tableCellPlainText(value: string): string {
  return inlinePlainText(parseTableCellInline(value))
}

function copyPlainText(value: string): void {
  const fallback = (): void => {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.append(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
  if (!navigator.clipboard?.writeText) return fallback()
  void navigator.clipboard.writeText(value).catch(fallback)
}

function applyTableEdit(
  view: EditorView,
  table: MarkdownTableMatch,
  mutate: (data: TableData) => TableData,
): void {
  if (view.state.readOnly) return
  const next = mutate(toTableData(table))
  view.dispatch({ changes: { from: table.from, to: table.to, insert: serializeTableData(next) } })
  view.focus()
}

function deleteTable(view: EditorView, table: MarkdownTableMatch): void {
  if (view.state.readOnly) return
  const eatsTrailingNewline = view.state.doc.sliceString(table.to, table.to + 1) === '\n'
  view.dispatch({ changes: { from: table.from, to: table.to + (eatsTrailingNewline ? 1 : 0) } })
  view.focus()
}

/** `'header'` for the header row, or the 0-based index into `table.rows` for a body row. */
type TableRowKind = 'header' | number

function cellPosition(element: HTMLElement): { rowKind: TableRowKind; columnIndex: number } | null {
  const row = element.closest('tr')
  const table = element.closest('table')
  if (!row || !table) return null
  const columnIndex = Array.from(row.children).indexOf(element)
  if (row.parentElement?.tagName === 'THEAD') return { rowKind: 'header', columnIndex }
  const rowIndex = Array.from(table.querySelectorAll('tbody > tr')).indexOf(row)
  return rowIndex < 0 ? null : { rowKind: rowIndex, columnIndex }
}

interface TableMenuContext {
  view: EditorView
  table: MarkdownTableMatch
  rowKind: TableRowKind
  columnIndex: number
}

let closeOpenTableMenu: (() => void) | null = null

function openTableContextMenu(event: MouseEvent, ctx: TableMenuContext): void {
  event.preventDefault()
  // The app's own global editor context menu also listens for `contextmenu` further
  // up the DOM (see useEditorContextMenu). Without this, both menus open at once.
  event.stopPropagation()
  closeOpenTableMenu?.()

  const { view, table, rowKind, columnIndex } = ctx
  const readOnly = view.state.readOnly
  const bodyRowIndex = rowKind === 'header' ? null : rowKind
  const selectedCell =
    rowKind === 'header' ? table.header[columnIndex] : table.rows[rowKind]?.[columnIndex]
  const menu = document.createElement('div')
  menu.className = 'xmd-cm-table-menu'
  menu.style.left = `${event.clientX}px`
  menu.style.top = `${event.clientY}px`

  const addItem = (
    label: string,
    shortcut: string | null,
    action: () => void,
    disabled = false,
  ): void => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'xmd-cm-table-menu-item'
    item.disabled = disabled
    const text = document.createElement('span')
    text.textContent = label
    item.append(text)
    if (shortcut) {
      const hint = document.createElement('span')
      hint.className = 'xmd-cm-table-menu-shortcut'
      hint.textContent = shortcut
      item.append(hint)
    }
    if (!disabled) {
      item.addEventListener('click', () => {
        closeOpenTableMenu?.()
        action()
      })
    }
    menu.append(item)
  }

  const addSeparator = (): void => {
    menu.append(
      Object.assign(document.createElement('div'), { className: 'xmd-cm-table-menu-separator' }),
    )
  }

  addItem('复制单元格', null, () => copyPlainText(tableCellPlainText(selectedCell?.text ?? '')))
  addItem('复制表格', null, () => copyPlainText(view.state.doc.sliceString(table.from, table.to)))
  addSeparator()

  addItem(
    '在上方插入行',
    null,
    () => applyTableEdit(view, table, (data) => insertRowAt(data, bodyRowIndex ?? 0)),
    readOnly || bodyRowIndex === null,
  )
  addItem(
    '在下方插入行',
    null,
    () =>
      applyTableEdit(view, table, (data) =>
        insertRowAt(data, bodyRowIndex === null ? 0 : bodyRowIndex + 1),
      ),
    readOnly,
  )
  addItem(
    '删除行',
    '⌘⌫',
    () => applyTableEdit(view, table, (data) => deleteRowAt(data, bodyRowIndex ?? 0)),
    readOnly || bodyRowIndex === null,
  )
  addItem(
    '上移行',
    null,
    () => applyTableEdit(view, table, (data) => moveRowAt(data, bodyRowIndex!, bodyRowIndex! - 1)),
    readOnly || bodyRowIndex === null || bodyRowIndex === 0,
  )
  addItem(
    '下移行',
    null,
    () => applyTableEdit(view, table, (data) => moveRowAt(data, bodyRowIndex!, bodyRowIndex! + 1)),
    readOnly || bodyRowIndex === null || bodyRowIndex === table.rows.length - 1,
  )
  addSeparator()
  addItem(
    '在左侧插入列',
    null,
    () => applyTableEdit(view, table, (data) => insertColumnAt(data, columnIndex)),
    readOnly,
  )
  addItem(
    '在右侧插入列',
    null,
    () => applyTableEdit(view, table, (data) => insertColumnAt(data, columnIndex + 1)),
    readOnly,
  )
  addItem(
    '删除列',
    null,
    () => applyTableEdit(view, table, (data) => deleteColumnAt(data, columnIndex)),
    readOnly || table.header.length <= 1,
  )
  addItem(
    '左移列',
    null,
    () => applyTableEdit(view, table, (data) => moveColumnAt(data, columnIndex, columnIndex - 1)),
    readOnly || columnIndex === 0,
  )
  addItem(
    '右移列',
    null,
    () => applyTableEdit(view, table, (data) => moveColumnAt(data, columnIndex, columnIndex + 1)),
    readOnly || columnIndex === table.header.length - 1,
  )
  addSeparator()
  addItem(
    '左对齐',
    null,
    () => applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'left')),
    readOnly,
  )
  addItem(
    '居中对齐',
    null,
    () => applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'center')),
    readOnly,
  )
  addItem(
    '右对齐',
    null,
    () => applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'right')),
    readOnly,
  )
  addSeparator()
  addItem('删除表格', null, () => deleteTable(view, table), readOnly)

  document.body.append(menu)
  const rect = menu.getBoundingClientRect()
  if (rect.right > window.innerWidth) {
    menu.style.left = `${Math.max(0, window.innerWidth - rect.width - 8)}px`
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(0, window.innerHeight - rect.height - 8)}px`
  }

  const onPointerDown = (pointerEvent: MouseEvent): void => {
    if (!menu.contains(pointerEvent.target as Node)) closeOpenTableMenu?.()
  }
  const onKeydown = (keyEvent: KeyboardEvent): void => {
    if (keyEvent.key === 'Escape') closeOpenTableMenu?.()
  }
  const onDismiss = (): void => closeOpenTableMenu?.()
  window.addEventListener('mousedown', onPointerDown, true)
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('scroll', onDismiss, true)
  window.addEventListener('resize', onDismiss)

  closeOpenTableMenu = () => {
    menu.remove()
    window.removeEventListener('mousedown', onPointerDown, true)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('scroll', onDismiss, true)
    window.removeEventListener('resize', onDismiss)
    closeOpenTableMenu = null
  }
}

interface TableWidgetController {
  table: MarkdownTableMatch
  cellElements: Map<MarkdownTableCell, HTMLElement>
  cellByElement: WeakMap<HTMLElement, MarkdownTableCell>
  resizeObserver?: ResizeObserver
}

const tableControllers = new WeakMap<HTMLElement, TableWidgetController>()

/** Cells after `boundary` (in document order) shift by `delta` once an earlier cell is edited.
 *  `edited` is excluded — its own offsets were already updated by the caller, and for an
 *  originally-empty cell `from === to === boundary` would otherwise double-shift it. */
function shiftCellsAfter(
  table: MarkdownTableMatch,
  edited: MarkdownTableCell,
  boundary: number,
  delta: number,
): void {
  if (delta === 0) return
  const allCells = [...table.header, ...table.rows.flat()]
  for (const cell of allCells) {
    if (cell !== edited && cell.from >= boundary) {
      cell.from += delta
      cell.to += delta
    }
  }
  if (table.to >= boundary) table.to += delta
}

function editableCellsInOrder(dom: HTMLElement): HTMLElement[] {
  return Array.from(dom.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
}

const CELL_BREAK_PATTERN = /^<br\s*\/?\s*>$/i

function tableCellBreakRanges(value: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  tableCellParser.parse(value).iterate({
    enter(node) {
      if (node.name === 'HTMLTag' && CELL_BREAK_PATTERN.test(value.slice(node.from, node.to))) {
        ranges.push({ from: node.from, to: node.to })
      }
    },
  })
  return ranges
}

export function splitTableCellLines(value: string): string[] {
  const ranges = tableCellBreakRanges(value)
  if (!ranges.length) return [value]
  const lines: string[] = []
  let cursor = 0
  for (const range of ranges) {
    lines.push(value.slice(cursor, range.from))
    cursor = range.to
  }
  lines.push(value.slice(cursor))
  return lines
}

export function normalizeTableCellBreaks(value: string): string {
  return splitTableCellLines(value).join('<br>')
}

function renderTableInlinePart(part: TableInlinePart): Node {
  if (part.kind === 'text') return document.createTextNode(part.text)
  if (part.kind === 'break') return document.createElement('br')
  const tag =
    part.kind === 'strong'
      ? 'strong'
      : part.kind === 'emphasis'
        ? 'em'
        : part.kind === 'strike'
          ? 'del'
          : part.kind === 'code'
            ? 'code'
            : 'span'
  const element = document.createElement(tag)
  element.dataset.xmdTableInline = 'true'
  element.dataset.xmdPrefix = part.prefix
  element.dataset.xmdSuffix = part.suffix
  if (part.kind === 'link') element.className = 'xmd-cm-table-inline-link'
  if (part.kind === 'code') element.className = 'xmd-cm-table-inline-code'
  for (const child of part.children) element.append(renderTableInlinePart(child))
  return element
}

/** Render Markdown's portable in-cell line break without enabling arbitrary HTML. */
export function setTableCellContent(element: HTMLElement, value: string): void {
  element.replaceChildren()
  for (const inline of parseTableCellInline(value)) element.append(renderTableInlinePart(inline))
}

/** Convert the safe contenteditable DOM back to the canonical Markdown cell value. */
export function readTableCellContent(element: HTMLElement): string {
  const read = (node: Node): string => {
    // A terminal soft break needs a real following caret box in WebKit. The
    // invisible sentinel supplies that box, but is never part of Markdown.
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u200b/g, '')
    if (node.nodeName === 'BR') return '<br>'
    const content = Array.from(node.childNodes, read).join('')
    if (node instanceof HTMLElement && node.dataset.xmdTableInline === 'true') {
      // If all visible content of a format wrapper was deleted, drop its hidden
      // Markdown markers as well instead of leaving `****`, `` or an empty link.
      if (!content) return ''
      return `${node.dataset.xmdPrefix ?? ''}${content}${node.dataset.xmdSuffix ?? ''}`
    }
    return content
  }
  return Array.from(element.childNodes, read).join('')
}

const TABLE_INLINE_FORMAT_DOM: Record<
  TableCellInlineFormat,
  { tag: 'STRONG' | 'EM' | 'DEL' | 'CODE'; prefix: string; suffix: string }
> = {
  bold: { tag: 'STRONG', prefix: '**', suffix: '**' },
  italic: { tag: 'EM', prefix: '*', suffix: '*' },
  strike: { tag: 'DEL', prefix: '~~', suffix: '~~' },
  inlineCode: { tag: 'CODE', prefix: '`', suffix: '`' },
}

function closestTableInlineWrapper(
  node: Node,
  cell: HTMLElement,
  format: TableCellInlineFormat,
): HTMLElement | null {
  const tag = TABLE_INLINE_FORMAT_DOM[format].tag
  let current: HTMLElement | null =
    node instanceof HTMLElement
      ? node
      : node.parentElement instanceof HTMLElement
        ? node.parentElement
        : null
  while (current && current !== cell) {
    if (current.tagName === tag && current.dataset.xmdTableInline === 'true') return current
    current = current.parentElement
  }
  return null
}

function closestAnyTableInlineWrapper(node: Node, cell: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null =
    node instanceof HTMLElement
      ? node
      : node.parentElement instanceof HTMLElement
        ? node.parentElement
        : null
  while (current && current !== cell) {
    if (current.dataset.xmdTableInline === 'true') return current
    current = current.parentElement
  }
  return null
}

function selectionRangeInCell(cell: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  return cell.contains(range.startContainer) && cell.contains(range.endContainer) ? range : null
}

function tableCellInlineState(cell: HTMLElement): Omit<TableCellCommandState, 'focused'> {
  const range = selectionRangeInCell(cell)
  const active = (format: TableCellInlineFormat): boolean => {
    if (!range) return false
    const start = closestTableInlineWrapper(range.startContainer, cell, format)
    return Boolean(start && start === closestTableInlineWrapper(range.endContainer, cell, format))
  }
  return {
    hasSelection: Boolean(range && !range.collapsed),
    bold: active('bold'),
    italic: active('italic'),
    strike: active('strike'),
    inlineCode: active('inlineCode'),
  }
}

function rangeTextOffset(root: HTMLElement, node: Node, offset: number): number {
  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(node, offset)
  return prefix.toString().length
}

function selectNodes(first: Node, last: Node): void {
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.setStartBefore(first)
  range.setEndAfter(last)
  selection.removeAllRanges()
  selection.addRange(range)
}

function unwrapTableInlineElement(element: HTMLElement): { first: Node; last: Node } | null {
  const first = element.firstChild
  const last = element.lastChild
  if (!first || !last) return null
  element.replaceWith(...Array.from(element.childNodes))
  return { first, last }
}

/**
 * Apply the safe inline subset directly to a cell's own contenteditable DOM.
 * Block styles never enter this path. Partial removal from inside one existing
 * wrapper is deliberately rejected rather than producing overlapping Markdown.
 */
export function toggleTableCellInlineFormat(
  cell: HTMLElement,
  format: TableCellInlineFormat,
): boolean {
  const range = selectionRangeInCell(cell)
  if (!range || range.collapsed) return false
  const config = TABLE_INLINE_FORMAT_DOM[format]
  const startWrapper = closestTableInlineWrapper(range.startContainer, cell, format)
  const endWrapper = closestTableInlineWrapper(range.endContainer, cell, format)

  if (startWrapper && startWrapper === endWrapper) {
    const start = rangeTextOffset(startWrapper, range.startContainer, range.startOffset)
    const end = rangeTextOffset(startWrapper, range.endContainer, range.endOffset)
    if (start !== 0 || end !== (startWrapper.textContent ?? '').length) return false
    const unwrapped = unwrapTableInlineElement(startWrapper)
    if (!unwrapped) return false
    selectNodes(unwrapped.first, unwrapped.last)
    return true
  }

  // A range crossing an inline-wrapper boundary cannot be safely reparented
  // with DOM Range APIs without changing formatting outside the selection.
  // Reject it instead of producing overlapping Markdown or stale outer edits.
  if (
    startWrapper ||
    endWrapper ||
    closestAnyTableInlineWrapper(range.startContainer, cell) !==
      closestAnyTableInlineWrapper(range.endContainer, cell)
  ) {
    return false
  }

  const preview = range.cloneContents()
  if (
    format === 'inlineCode' &&
    (preview.querySelector('br') || preview.querySelector('[data-xmd-table-inline="true"]'))
  ) {
    return false
  }
  const fragment = range.extractContents()
  const nested = Array.from(
    fragment.querySelectorAll<HTMLElement>(
      `${config.tag.toLowerCase()}[data-xmd-table-inline="true"]`,
    ),
  ).reverse()
  for (const wrapper of nested) unwrapTableInlineElement(wrapper)

  const wrapper = document.createElement(config.tag.toLowerCase())
  wrapper.dataset.xmdTableInline = 'true'
  wrapper.dataset.xmdPrefix = config.prefix
  wrapper.dataset.xmdSuffix = config.suffix
  wrapper.append(fragment)
  range.insertNode(wrapper)

  let merged = wrapper
  const previous = merged.previousSibling
  if (
    previous instanceof HTMLElement &&
    previous.tagName === config.tag &&
    previous.dataset.xmdTableInline === 'true'
  ) {
    previous.append(...Array.from(merged.childNodes))
    merged.remove()
    merged = previous
  }
  const next = merged.nextSibling
  if (
    next instanceof HTMLElement &&
    next.tagName === config.tag &&
    next.dataset.xmdTableInline === 'true'
  ) {
    merged.append(...Array.from(next.childNodes))
    next.remove()
  }
  if (merged.firstChild && merged.lastChild) selectNodes(merged.firstChild, merged.lastChild)
  return true
}

function replaceCellSelection(element: HTMLElement, value: string): boolean {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return false
  range.deleteContents()
  const fragment = document.createDocumentFragment()
  const parts = value.replace(/\r\n?/g, '\n').split('\n')
  let lastNode: Node | null = null
  parts.forEach((part, index) => {
    if (index > 0) {
      lastNode = document.createElement('br')
      fragment.append(lastNode)
    }
    if (part) {
      lastNode = document.createTextNode(part)
      fragment.append(lastNode)
    }
  })
  if (!lastNode) return true
  range.insertNode(fragment)
  range.setStartAfter(lastNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

/**
 * Insert a Markdown `<br>` with a stable caret target. A bare trailing BR has
 * no editable line box in WebKit, so the first Shift+Enter appears to do
 * nothing until the user presses it again. The zero-width sentinel is removed
 * by `readTableCellContent` before every source transaction.
 */
function insertTableCellSoftBreak(element: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  if (!element.contains(range.commonAncestorContainer)) return false
  range.deleteContents()
  const breakElement = document.createElement('br')
  const sentinel = document.createTextNode('\u200b')
  const fragment = document.createDocumentFragment()
  fragment.append(breakElement, sentinel)
  range.insertNode(fragment)
  range.setStart(sentinel, 0)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: MarkdownTableMatch,
    readonly rowHeight: number,
    readonly readOnly: boolean,
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return (
      this.rowHeight === other.rowHeight &&
      this.readOnly === other.readOnly &&
      this.table.from === other.table.from &&
      this.table.to === other.table.to &&
      this.table.source === other.table.source
    )
  }
  get estimatedHeight(): number {
    return (this.table.rows.length + 1) * this.rowHeight + 2
  }

  updateDOM(dom: HTMLElement): boolean {
    const controller = tableControllers.get(dom)
    if (!controller) return false
    if (controller.table.header.length !== this.table.header.length) return false
    if (controller.table.rows.length !== this.table.rows.length) return false
    if (controller.table.rows.some((row, index) => row.length !== this.table.rows[index].length))
      return false

    controller.table = this.table
    // Skips the actively-focused cell so mid-edit reconciliation cannot move the caret.
    this.reconcileCells(controller)
    return true
  }

  private reconcileCells(controller: TableWidgetController): void {
    const elements = Array.from(controller.cellElements.values())
    const nextCellElements = new Map<MarkdownTableCell, HTMLElement>()
    let index = 0
    for (const row of [this.table.header, ...this.table.rows]) {
      row.forEach((cell, column) => {
        const element = elements[index]
        index += 1
        if (!element) return
        if (document.activeElement !== element && readTableCellContent(element) !== cell.text) {
          setTableCellContent(element, cell.text)
        }
        element.style.textAlign = this.table.alignments[column] ?? ''
        element.dataset.sourceFrom = String(cell.from)
        element.dataset.sourceTo = String(cell.to)
        nextCellElements.set(cell, element)
        controller.cellByElement.set(element, cell)
      })
    }
    controller.cellElements = nextCellElements
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'xmd-cm-table-preview'
    wrapper.dataset.xmdTable = 'true'
    const table = document.createElement('table')
    const head = document.createElement('thead')
    const body = document.createElement('tbody')

    const controller: TableWidgetController = {
      table: this.table,
      cellElements: new Map(),
      cellByElement: new WeakMap(),
    }

    head.append(this.createRow(view, controller, this.table.header, true))
    for (const row of this.table.rows) body.append(this.createRow(view, controller, row, false))
    table.append(head, body)
    wrapper.append(table)
    if (typeof ResizeObserver !== 'undefined') {
      controller.resizeObserver = new ResizeObserver(() => view.requestMeasure())
      controller.resizeObserver.observe(wrapper)
    }
    tableControllers.set(wrapper, controller)
    return wrapper
  }

  destroy(dom: HTMLElement): void {
    for (const cell of editableCellsInOrder(dom)) tableCellCommandBridge.deactivate(cell)
    tableControllers.get(dom)?.resizeObserver?.disconnect()
    tableControllers.delete(dom)
  }

  ignoreEvent(): boolean {
    // Cell input/keyboard handlers own widget events and explicitly dispatch changes.
    return true
  }

  private createRow(
    view: EditorView,
    controller: TableWidgetController,
    cells: MarkdownTableCell[],
    header: boolean,
  ): HTMLTableRowElement {
    const row = document.createElement('tr')
    // GFM's rendered table always follows the header column count. Surplus source
    // cells are ignored and missing cells remain visual placeholders.
    const count = this.table.header.length
    for (let column = 0; column < count; column++) {
      const cell = cells[column]
      const element = document.createElement(header ? 'th' : 'td')
      const align = this.table.alignments[column]
      if (align) element.style.textAlign = align
      if (cell) {
        setTableCellContent(element, cell.text)
        element.contentEditable = this.readOnly ? 'false' : 'true'
        element.setAttribute('aria-readonly', String(this.readOnly))
        element.dataset.sourceFrom = String(cell.from)
        element.dataset.sourceTo = String(cell.to)
        controller.cellElements.set(cell, element)
        controller.cellByElement.set(element, cell)
        this.bindCellEvents(view, controller, element)
      }
      row.append(element)
    }
    return row
  }

  private bindCellEvents(
    view: EditorView,
    controller: TableWidgetController,
    element: HTMLElement,
  ): void {
    const commitCell = (): void => {
      if (view.state.readOnly) return
      // updateDOM reuses cell elements but replaces the parsed table/cell objects.
      // Resolve the current object for every transaction rather than retaining stale
      // source offsets in this event-handler closure.
      const cell = controller.cellByElement.get(element)
      if (!cell) return
      const raw = readTableCellContent(element)
      if (raw === cell.text) return
      const escaped = escapeTableCellText(raw)
      const from = cell.from
      const to = cell.to
      const delta = escaped.length - (to - from)
      view.dispatch({ changes: { from, to, insert: escaped } })
      cell.text = raw
      cell.to = from + escaped.length
      shiftCellsAfter(controller.table, cell, to, delta)
    }

    element.addEventListener('input', (event) => {
      if (event instanceof InputEvent && event.isComposing) return
      commitCell()
      tableCellCommandBridge.refresh(element)
    })
    element.addEventListener('compositionend', commitCell)
    element.addEventListener('focus', () => {
      element
        .closest('table')
        ?.querySelectorAll('.xmd-cm-table-cell-active')
        .forEach((active) => {
          if (active !== element) active.classList.remove('xmd-cm-table-cell-active')
        })
      element.classList.add('xmd-cm-table-cell-active')
      tableCellCommandBridge.activate({
        element,
        runInline: (format) => {
          if (view.state.readOnly || !toggleTableCellInlineFormat(element, format)) return false
          commitCell()
          return true
        },
        readState: () => tableCellInlineState(element),
        selectAll: () => {
          const selection = window.getSelection()
          if (!selection) return
          const range = document.createRange()
          range.selectNodeContents(element)
          selection.removeAllRanges()
          selection.addRange(range)
        },
      })
    })
    element.addEventListener('blur', () => {
      tableCellCommandBridge.deactivate(element)
      element.classList.remove('xmd-cm-table-cell-active')
      const cell = controller.cellByElement.get(element)
      if (cell) setTableCellContent(element, cell.text)
    })
    element.addEventListener('mouseup', () => tableCellCommandBridge.refresh(element))
    element.addEventListener('keyup', () => tableCellCommandBridge.refresh(element))

    element.addEventListener('paste', (event) => {
      if (view.state.readOnly) return
      event.preventDefault()
      const text = event.clipboardData?.getData('text/plain') ?? ''
      if (replaceCellSelection(element, text)) commitCell()
    })

    element.addEventListener('contextmenu', (event) => {
      const position = cellPosition(element)
      if (!position) return
      openTableContextMenu(event, {
        view,
        table: controller.table,
        rowKind: position.rowKind,
        columnIndex: position.columnIndex,
      })
    })

    element.addEventListener('keydown', (event) => {
      if (event.isComposing) return
      if (view.state.readOnly) return
      const withMod = event.metaKey || event.ctrlKey
      if (withMod && event.key === 'Enter') {
        event.preventDefault()
        // Input is synchronized transaction-by-transaction. Mod+Enter explicitly
        // commits and remains in this cell, matching spreadsheet conventions.
        commitCell()
        return
      }
      if (withMod && event.key === 'Backspace') {
        event.preventDefault()
        const position = cellPosition(element)
        if (position && position.rowKind !== 'header') {
          applyTableEdit(view, controller.table, (data) =>
            deleteRowAt(data, position.rowKind as number),
          )
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) {
          if (insertTableCellSoftBreak(element)) commitCell()
        } else {
          commitCell()
          this.moveFocus(element, 1, /* vertical */ true)
        }
        return
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (!this.isAtCellVerticalBoundary(element, event.key === 'ArrowUp')) return
        event.preventDefault()
        const direction = event.key === 'ArrowUp' ? -1 : 1
        if (!this.moveFocus(element, direction, /* vertical */ true)) {
          // At a table edge, continue in the document above/below the table.
          // Never fall back to a neighbouring left/right cell for a vertical key.
          const position = direction < 0 ? controller.table.from : controller.table.to
          view.dispatch({ selection: { anchor: position }, scrollIntoView: true })
          view.focus()
        }
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        this.moveFocus(element, event.shiftKey ? -1 : 1, /* sameColumn */ false)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        element.blur()
        view.focus()
      }
    })
  }

  /** Tab moves in reading order. Vertical moves preserve the caret's screen X coordinate. */
  private moveFocus(current: HTMLElement, direction: 1 | -1, vertical: boolean): boolean {
    const table = current.closest('table')
    const row = current.closest('tr')
    if (!table || !row) return false
    if (vertical) {
      const allRows = Array.from(table.querySelectorAll('tr'))
      const targetRow = allRows[allRows.indexOf(row) + direction]
      const target = targetRow
        ? this.cellAtHorizontalCoordinate(Array.from(targetRow.children), this.caretX(current))
        : undefined
      if (target?.isContentEditable) {
        this.focusCell(target, this.caretX(current))
        return true
      }
      return false
    }
    const cells = editableCellsInOrder(table)
    const target = cells[cells.indexOf(current) + direction]
    if (target) {
      this.focusCell(target)
      return true
    }
    return false
  }

  /** True only when native vertical movement would leave this cell. */
  private isAtCellVerticalBoundary(element: HTMLElement, atStart: boolean): boolean {
    const selection = window.getSelection()
    if (!selection?.rangeCount) return false
    const range = selection.getRangeAt(0)
    if (!range.collapsed || !element.contains(range.startContainer)) return false
    const probe = document.createRange()
    probe.selectNodeContents(element)
    if (atStart) probe.setEnd(range.startContainer, range.startOffset)
    else probe.setStart(range.startContainer, range.startOffset)
    // `<br>` represents a visual line boundary. Text-only cells are one line.
    return !Array.from(probe.cloneContents().querySelectorAll('br')).length &&
      probe.toString().replace(/\u200b/g, '') === ''
  }

  private caretX(element: HTMLElement): number {
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null
    const rect = range?.getClientRects().item(0)
    return rect?.left ?? element.getBoundingClientRect().left + 12
  }

  private cellAtHorizontalCoordinate(cells: Element[], x: number): HTMLElement | undefined {
    const editable = cells.filter((cell): cell is HTMLElement => cell instanceof HTMLElement && cell.isContentEditable)
    return editable.find((cell) => {
      const rect = cell.getBoundingClientRect()
      return x >= rect.left && x <= rect.right
    }) ?? editable.reduce<HTMLElement | undefined>((nearest, cell) => {
      if (!nearest) return cell
      const nearestRect = nearest.getBoundingClientRect()
      const rect = cell.getBoundingClientRect()
      const nearestDistance = Math.abs((nearestRect.left + nearestRect.right) / 2 - x)
      const distance = Math.abs((rect.left + rect.right) / 2 - x)
      return distance < nearestDistance ? cell : nearest
    }, undefined)
  }

  private focusCell(element: HTMLElement, x?: number): void {
    element.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    const rect = element.getBoundingClientRect()
    const documentWithCaret = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
      caretRangeFromPoint?: (x: number, y: number) => Range | null
    }
    const targetX = x ?? rect.right - 4
    const caret = documentWithCaret.caretPositionFromPoint?.(targetX, rect.top + rect.height / 2)
    const hitRange = caret
      ? null
      : documentWithCaret.caretRangeFromPoint?.(targetX, rect.top + rect.height / 2)
    if (caret && element.contains(caret.offsetNode)) range.setStart(caret.offsetNode, caret.offset)
    else if (hitRange && element.contains(hitRange.startContainer)) range.setStart(hitRange.startContainer, hitRange.startOffset)
    else {
      range.selectNodeContents(element)
      range.collapse(x === undefined)
    }
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
}

export function markdownTablePreview(options: MarkdownTablePreviewOptions = {}): Extension {
  const bufferChars = options.bufferChars ?? DEFAULT_BUFFER_CHARS
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT
  const setDecorations = StateEffect.define<ReturnType<typeof Decoration.set>>({
    map: (decorations, changes) => decorations.map(changes),
  })
  const decorationField = StateField.define<ReturnType<typeof Decoration.set>>({
    create: () => Decoration.none,
    update(decorations, transaction) {
      let next = transaction.docChanged ? decorations.map(transaction.changes) : decorations
      for (const effect of transaction.effects) {
        if (effect.is(setDecorations)) next = effect.value
      }
      return next
    },
    provide: (field) => EditorView.decorations.from(field),
  })
  const viewportObserver = ViewPlugin.fromClass(
    class {
      private scheduled = false
      private destroyed = false

      constructor(readonly view: EditorView) {
        this.schedule()
      }

      update(update: ViewUpdate): void {
        // Cells are edited in place now, so table widgets no longer need to rebuild
        // when the selection merely moves into/out of the table's source range.
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.startState.readOnly !== update.state.readOnly ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        )
          this.schedule()
      }

      destroy(): void {
        this.destroyed = true
      }

      private schedule(): void {
        if (this.scheduled || this.destroyed) return
        this.scheduled = true
        queueMicrotask(() => {
          this.scheduled = false
          if (this.destroyed) return
          this.view.dispatch({ effects: setDecorations.of(this.build()) })
        })
      }

      private build(): ReturnType<typeof Decoration.set> {
        const ranges = findVisibleMarkdownTables(
          this.view.state,
          this.view.visibleRanges,
          bufferChars,
        ).map((table) =>
          Decoration.replace({
            widget: new TableWidget(table, rowHeight, this.view.state.readOnly),
            block: true,
          }).range(table.from, table.to),
        )
        return Decoration.set(ranges, true)
      }
    },
  )
  return [decorationField, viewportObserver]
}
