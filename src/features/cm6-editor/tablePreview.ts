import { redo as cm6Redo, undo as cm6Undo } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view'
import { GFM, parser as markdownParser } from '@lezer/markdown'
import {
  tableCellCommandBridge,
  type TableCellCommandState,
  type TableCellInlineFormat,
} from '../../lib/tableCellCommandBridge'
import {
  fitColumnsToContainer,
  fitColumnsToContents,
  type IntrinsicColumnWidth,
} from '../../lib/tableColumnSizing'
import { tableZoomBridge } from '../../lib/tableZoomBridge'
import { t } from '../../lib/i18n'
import { shortcutHint } from '../../lib/shortcuts'
import { hiddenRangeSource, type HiddenRange } from './core/hiddenRanges'
import './tablePreview.css'

export type TableAlignment = 'left' | 'center' | 'right' | null
export type TableColumnWidthMode = 'distribute' | 'fit' | 'equal'
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
  /** Default layout for tables that do not have a per-table context-menu override. */
  columnWidthMode?: TableColumnWidthMode
  /** Re-measure the active table shortly after its cell content changes. */
  autoResize?: boolean
}

const DEFAULT_BUFFER_CHARS = 2_000
const DEFAULT_ROW_HEIGHT = 38
const tableCellParser = markdownParser.configure([GFM])

interface TableLayoutOverride {
  from: number
  mode: TableColumnWidthMode
}

const setTableLayoutOverride = StateEffect.define<TableLayoutOverride>({
  map: (value, changes) => ({ ...value, from: changes.mapPos(value.from, -1) }),
})

/** Per-editor, transaction-mapped table overrides survive widget rebuilds and structural edits. */
const tableLayoutOverrides = StateField.define<ReadonlyMap<number, TableColumnWidthMode>>({
  create: () => new Map(),
  update(previous, transaction) {
    let next = previous
    if (transaction.docChanged && previous.size > 0) {
      next = new Map(
        Array.from(previous, ([from, mode]) => [transaction.changes.mapPos(from, -1), mode]),
      )
    }
    for (const effect of transaction.effects) {
      if (!effect.is(setTableLayoutOverride)) continue
      const mutable =
        next === previous ? new Map(previous) : (next as Map<number, TableColumnWidthMode>)
      mutable.set(effect.value.from, effect.value.mode)
      next = mutable
    }
    return next
  },
})

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

/**
 * The single source of atomic/hidden ranges this feature contributes to the
 * core engine (`core/hiddenRanges.ts`), replacing the standalone
 * `EditorView.atomicRanges` provider a table preview would otherwise need to
 * maintain on its own. A `Table` node's whole source span (`table.from`..
 * `table.to`) is the `atomic-block` case registered in `core/nodePolicy.ts`:
 * it matches exactly the range `markdownTablePreview`'s own decoration field
 * already replaces with a `TableWidget`, so `presentation: 'external'` means core
 * never paints a second, redundant invisible replacement over it — this
 * module's own StateField already does that.
 */
export function collectTableHiddenRanges(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
  bufferChars = DEFAULT_BUFFER_CHARS,
): HiddenRange[] {
  return findVisibleMarkdownTables(state, visibleRanges, bufferChars).map((table) => ({
    from: table.from,
    to: table.to,
    presentation: 'external',
  }))
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

const MIN_AUTO_COLUMN = 64
const MAX_AUTO_COLUMN = 640

function renderedColumnTracks(table: HTMLTableElement, columnCount: number): number[] {
  const colTracks = Array.from(table.querySelectorAll<HTMLTableColElement>('col')).map((col) =>
    Math.ceil(col.getBoundingClientRect().width),
  )
  if (colTracks.length === columnCount && colTracks.every((track) => track > 0)) return colTracks

  const tracks = Array<number>(columnCount).fill(0)
  for (const row of Array.from(table.rows)) {
    let column = 0
    for (const cell of Array.from(row.cells)) {
      const span = Math.max(1, cell.colSpan || 1)
      const perColumn = Math.ceil(cell.getBoundingClientRect().width / span)
      for (let offset = 0; offset < span && column + offset < columnCount; offset += 1) {
        tracks[column + offset] = Math.max(tracks[column + offset], perColumn)
      }
      column += span
    }
  }
  return tracks
}

/** Measure each column's min-content and max-content requirements without changing its final DOM. */
function measureIntrinsicColumnWidths(table: HTMLTableElement): IntrinsicColumnWidth[] {
  const cols = Array.from(table.querySelectorAll<HTMLTableColElement>('col'))
  if (cols.length === 0) return []
  const savedColWidths = cols.map((col) => col.style.width)
  const saved = {
    tableLayout: table.style.tableLayout,
    width: table.style.width,
    minWidth: table.style.minWidth,
    maxWidth: table.style.maxWidth,
  }
  cols.forEach((col) => {
    col.style.width = ''
  })
  table.style.tableLayout = 'auto'
  table.style.minWidth = '0'
  table.style.maxWidth = 'none'

  table.style.width = 'min-content'
  const minimums = renderedColumnTracks(table, cols.length)
  table.style.width = 'max-content'
  const preferred = renderedColumnTracks(table, cols.length)

  cols.forEach((col, index) => {
    col.style.width = savedColWidths[index] ?? ''
  })
  table.style.tableLayout = saved.tableLayout
  table.style.width = saved.width
  table.style.minWidth = saved.minWidth
  table.style.maxWidth = saved.maxWidth
  return cols.map((_, index) => ({
    min: minimums[index] || MIN_AUTO_COLUMN,
    preferred: Math.max(minimums[index] || 0, preferred[index] || 0, MIN_AUTO_COLUMN),
  }))
}

/** Apply one of the three main-branch column layouts to a rendered CM6 table. */
export function applyTableColumnLayout(wrapper: HTMLElement, mode: TableColumnWidthMode): number[] {
  const table = wrapper.querySelector<HTMLTableElement>('table')
  const cols = Array.from(wrapper.querySelectorAll<HTMLTableColElement>('colgroup > col'))
  if (!table || cols.length === 0) return []

  const available = Math.floor(wrapper.clientWidth || wrapper.getBoundingClientRect().width)
  const intrinsic =
    mode === 'equal'
      ? cols.map(() => ({ min: 1, preferred: 1 }))
      : measureIntrinsicColumnWidths(table)
  const widths =
    mode === 'fit'
      ? fitColumnsToContents(intrinsic, MIN_AUTO_COLUMN, MAX_AUTO_COLUMN)
      : available > 0
        ? fitColumnsToContainer(intrinsic, available)
        : []
  if (widths.length !== cols.length) return []

  wrapper.dataset.xmdTableLayout = mode
  table.style.tableLayout = 'fixed'
  table.style.minWidth = '0'
  table.style.maxWidth = 'none'
  table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`
  cols.forEach((col, index) => {
    col.style.width = `${widths[index]}px`
  })
  return widths
}

/** Build a read-only clone for the full-screen table viewer, preserving current width ratios. */
function expandedTableHtml(wrapper: HTMLElement): string | null {
  const table = wrapper.querySelector<HTMLTableElement>('table')
  if (!table) return null
  const liveCols = Array.from(table.querySelectorAll<HTMLTableColElement>('colgroup > col'))
  const widths = liveCols.map((col) => col.getBoundingClientRect().width)
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
  const clone = table.cloneNode(true) as HTMLTableElement
  clone.className = 'xmd-table-zoom-table'
  clone.removeAttribute('style')
  clone.querySelectorAll<HTMLElement>('[contenteditable]').forEach((element) => {
    element.removeAttribute('contenteditable')
    element.removeAttribute('aria-readonly')
    element.removeAttribute('data-source-from')
    element.removeAttribute('data-source-to')
    element.classList.remove('xmd-cm-table-cell-active')
  })
  const cloneCols = Array.from(clone.querySelectorAll<HTMLTableColElement>('colgroup > col'))
  cloneCols.forEach((col, index) => {
    col.removeAttribute('style')
    if (totalWidth > 0) col.style.width = `${((widths[index] / totalWidth) * 100).toFixed(4)}%`
  })
  return clone.outerHTML
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
  wrapper: HTMLElement
  cellElement: HTMLElement
}

type TableMenuIconTag = 'circle' | 'line' | 'path' | 'polyline' | 'rect'
type TableMenuIconNode = readonly [
  tag: TableMenuIconTag,
  attributes: Readonly<Record<string, string>>,
]

const tableMenuIcons = {
  scissors: [
    ['circle', { cx: '6', cy: '6', r: '3' }],
    ['path', { d: 'M8.12 8.12 12 12' }],
    ['path', { d: 'M20 4 8.12 15.88' }],
    ['circle', { cx: '6', cy: '18', r: '3' }],
    ['path', { d: 'M14.8 14.8 20 20' }],
  ],
  copy: [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
  ],
  clipboardPaste: [
    ['path', { d: 'M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z' }],
    [
      'path',
      {
        d: 'M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2M16 4h2a2 2 0 0 1 2 2v2M11 14h10',
      },
    ],
    ['path', { d: 'm17 10 4 4-4 4' }],
  ],
  cell: [
    ['path', { d: 'M5 3a2 2 0 0 0-2 2' }],
    ['path', { d: 'M19 3a2 2 0 0 1 2 2' }],
    ['path', { d: 'M21 19a2 2 0 0 1-2 2' }],
    ['path', { d: 'M5 21a2 2 0 0 1-2-2' }],
    ['path', { d: 'M9 3h1M14 3h1M9 21h1M14 21h1M3 9v1M3 14v1M21 9v1M21 14v1' }],
  ],
  table: [
    [
      'path',
      {
        d: 'M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18',
      },
    ],
  ],
  arrowUpToLine: [
    ['path', { d: 'M5 3h14' }],
    ['path', { d: 'm18 13-6-6-6 6' }],
    ['path', { d: 'M12 7v14' }],
  ],
  arrowDownToLine: [
    ['path', { d: 'M12 17V3' }],
    ['path', { d: 'm6 11 6 6 6-6' }],
    ['path', { d: 'M19 21H5' }],
  ],
  arrowLeftToLine: [
    ['path', { d: 'M3 19V5' }],
    ['path', { d: 'm13 6-6 6 6 6' }],
    ['path', { d: 'M7 12h14' }],
  ],
  arrowRightToLine: [
    ['path', { d: 'M17 12H3' }],
    ['path', { d: 'm11 18 6-6-6-6' }],
    ['path', { d: 'M21 5v14' }],
  ],
  arrowUp: [
    ['path', { d: 'm5 12 7-7 7 7' }],
    ['path', { d: 'M12 19V5' }],
  ],
  arrowDown: [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'm19 12-7 7-7-7' }],
  ],
  arrowLeft: [
    ['path', { d: 'm12 19-7-7 7-7' }],
    ['path', { d: 'M19 12H5' }],
  ],
  arrowRight: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'm12 5 7 7-7 7' }],
  ],
  trash: [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }],
    ['path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }],
    ['line', { x1: '10', x2: '10', y1: '11', y2: '17' }],
    ['line', { x1: '14', x2: '14', y1: '11', y2: '17' }],
  ],
  stretchHorizontal: [
    ['rect', { width: '20', height: '6', x: '2', y: '4', rx: '2' }],
    ['rect', { width: '20', height: '6', x: '2', y: '14', rx: '2' }],
  ],
  wandSparkles: [
    [
      'path',
      {
        d: 'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72',
      },
    ],
    ['path', { d: 'm14 7 3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9' }],
  ],
  columns: [
    ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M9 3v18M15 3v18' }],
  ],
  maximize: [
    ['polyline', { points: '15 3 21 3 21 9' }],
    ['polyline', { points: '9 21 3 21 3 15' }],
    ['line', { x1: '21', x2: '14', y1: '3', y2: '10' }],
    ['line', { x1: '3', x2: '10', y1: '21', y2: '14' }],
  ],
  alignLeft: [['path', { d: 'M15 12H3M17 18H3M21 6H3' }]],
  alignCenter: [['path', { d: 'M17 12H7M19 18H5M21 6H3' }]],
  alignRight: [['path', { d: 'M21 12H9M21 18H7M21 6H3' }]],
  selectAll: [
    ['path', { d: 'M3 7V5a2 2 0 0 1 2-2h2' }],
    ['path', { d: 'M17 3h2a2 2 0 0 1 2 2v2' }],
    ['path', { d: 'M21 17v2a2 2 0 0 1-2 2h-2' }],
    ['path', { d: 'M7 21H5a2 2 0 0 1-2-2v-2' }],
  ],
} as const satisfies Record<string, readonly TableMenuIconNode[]>

type TableMenuIconName = keyof typeof tableMenuIcons

function createTableMenuIcon(iconName: TableMenuIconName): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(namespace, 'svg')
  icon.classList.add('xmd-cm-table-menu-icon')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-width', '1.8')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('focusable', 'false')

  for (const [tag, attributes] of tableMenuIcons[iconName]) {
    const node = document.createElementNS(namespace, tag)
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
    icon.append(node)
  }
  return icon
}

let closeOpenTableMenu: (() => void) | null = null

function openTableContextMenu(event: MouseEvent, ctx: TableMenuContext): void {
  event.preventDefault()
  // The app's own global editor context menu also listens for `contextmenu` further
  // up the DOM (see useEditorContextMenu). Without this, both menus open at once.
  event.stopPropagation()
  closeOpenTableMenu?.()

  const { view, table, rowKind, columnIndex, wrapper, cellElement } = ctx
  const readOnly = view.state.readOnly
  const bodyRowIndex = rowKind === 'header' ? null : rowKind
  const selectedCell =
    rowKind === 'header' ? table.header[columnIndex] : table.rows[rowKind]?.[columnIndex]
  const menu = document.createElement('div')
  menu.className = 'xmd-cm-table-menu'
  menu.style.left = `${event.clientX}px`
  menu.style.top = `${event.clientY}px`

  interface TableMenuItemSpec {
    label: string
    icon: TableMenuIconName
    action: () => void
    shortcut?: string
    disabled?: boolean
    danger?: boolean
    selected?: boolean
    title?: string
  }

  let tooltip: HTMLDivElement | null = null
  const hideTooltip = (): void => {
    tooltip?.remove()
    tooltip = null
  }
  const showTooltip = (anchor: HTMLElement, label: string): void => {
    hideTooltip()
    const next = document.createElement('div')
    next.className = 'xmd-cm-table-menu-tooltip'
    next.textContent = label
    next.setAttribute('role', 'tooltip')
    document.body.append(next)

    const anchorRect = anchor.getBoundingClientRect()
    const tooltipRect = next.getBoundingClientRect()
    const preferredLeft = anchorRect.left + (anchorRect.width - tooltipRect.width) / 2
    const left = Math.min(window.innerWidth - tooltipRect.width - 8, Math.max(8, preferredLeft))
    const preferredTop = anchorRect.top - tooltipRect.height - 6
    const top = preferredTop >= 8 ? preferredTop : anchorRect.bottom + 6
    next.style.left = `${left}px`
    next.style.top = `${top}px`
    tooltip = next
  }

  const createItem = (spec: TableMenuItemSpec): HTMLButtonElement => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = [
      'xmd-cm-table-menu-item',
      spec.danger ? 'is-danger' : '',
      spec.selected ? 'is-selected' : '',
    ]
      .filter(Boolean)
      .join(' ')
    item.disabled = spec.disabled ?? false
    const accessibleLabel = spec.title ?? spec.label
    const tooltipLabel = spec.shortcut ? `${accessibleLabel} (${spec.shortcut})` : accessibleLabel
    item.setAttribute('aria-label', accessibleLabel)
    if (spec.selected) item.setAttribute('aria-pressed', 'true')
    item.append(createTableMenuIcon(spec.icon))
    item.addEventListener('pointerenter', () => showTooltip(item, tooltipLabel))
    item.addEventListener('pointerleave', hideTooltip)
    item.addEventListener('focus', () => showTooltip(item, tooltipLabel))
    item.addEventListener('blur', hideTooltip)
    if (!spec.disabled) {
      item.addEventListener('click', () => {
        hideTooltip()
        closeOpenTableMenu?.()
        spec.action()
      })
    }
    return item
  }

  const addSection = (title: string, items: TableMenuItemSpec[]): void => {
    const section = document.createElement('section')
    section.className = 'xmd-cm-table-menu-section'
    const heading = document.createElement('div')
    heading.className = 'xmd-cm-table-menu-section-title'
    heading.textContent = title
    const group = document.createElement('div')
    group.className = 'xmd-cm-table-menu-compact-group'
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', title)
    group.append(...items.map(createItem))
    section.append(heading, group)
    menu.append(section)
  }

  // Keep the native selection/focus inside the contenteditable cell while a
  // menu item is clicked, matching the app-level context menu's preserveSelection mode.
  menu.addEventListener('mousedown', (mouseEvent) => mouseEvent.preventDefault())

  addSection(t('剪贴板'), [
    {
      label: t('剪切'),
      icon: 'scissors',
      shortcut: shortcutHint('Mod+X'),
      action: () => document.execCommand('cut'),
      disabled: readOnly,
    },
    {
      label: t('复制'),
      icon: 'copy',
      shortcut: shortcutHint('Mod+C'),
      action: () => document.execCommand('copy'),
    },
    {
      label: t('粘贴'),
      icon: 'clipboardPaste',
      shortcut: shortcutHint('Mod+V'),
      action: () => document.execCommand('paste'),
      disabled: readOnly,
    },
  ])
  addSection(t('复制内容'), [
    {
      label: t('复制单元格'),
      icon: 'cell',
      action: () => copyPlainText(tableCellPlainText(selectedCell?.text ?? '')),
    },
    {
      label: t('复制表格'),
      icon: 'table',
      action: () => copyPlainText(view.state.doc.sliceString(table.from, table.to)),
    },
  ])

  addSection(t('行操作'), [
    {
      label: t('上方插行'),
      icon: 'arrowUpToLine',
      title: t('在上方插入行'),
      action: () => applyTableEdit(view, table, (data) => insertRowAt(data, bodyRowIndex ?? 0)),
      disabled: readOnly || bodyRowIndex === null,
    },
    {
      label: t('下方插行'),
      icon: 'arrowDownToLine',
      title: t('在下方插入行'),
      action: () =>
        applyTableEdit(view, table, (data) =>
          insertRowAt(data, bodyRowIndex === null ? 0 : bodyRowIndex + 1),
        ),
      disabled: readOnly,
    },
    {
      label: t('上移行'),
      icon: 'arrowUp',
      action: () =>
        applyTableEdit(view, table, (data) => moveRowAt(data, bodyRowIndex!, bodyRowIndex! - 1)),
      disabled: readOnly || bodyRowIndex === null || bodyRowIndex === 0,
    },
    {
      label: t('下移行'),
      icon: 'arrowDown',
      action: () =>
        applyTableEdit(view, table, (data) => moveRowAt(data, bodyRowIndex!, bodyRowIndex! + 1)),
      disabled: readOnly || bodyRowIndex === null || bodyRowIndex === table.rows.length - 1,
    },
    {
      label: t('删行'),
      icon: 'trash',
      title: t('删除当前行'),
      shortcut: shortcutHint('Mod+Backspace'),
      action: () => applyTableEdit(view, table, (data) => deleteRowAt(data, bodyRowIndex ?? 0)),
      disabled: readOnly || bodyRowIndex === null,
      danger: true,
    },
  ])
  addSection(t('列操作'), [
    {
      label: t('左侧插列'),
      icon: 'arrowLeftToLine',
      title: t('在左侧插入列'),
      action: () => applyTableEdit(view, table, (data) => insertColumnAt(data, columnIndex)),
      disabled: readOnly,
    },
    {
      label: t('右侧插列'),
      icon: 'arrowRightToLine',
      title: t('在右侧插入列'),
      action: () => applyTableEdit(view, table, (data) => insertColumnAt(data, columnIndex + 1)),
      disabled: readOnly,
    },
    {
      label: t('左移列'),
      icon: 'arrowLeft',
      action: () =>
        applyTableEdit(view, table, (data) => moveColumnAt(data, columnIndex, columnIndex - 1)),
      disabled: readOnly || columnIndex === 0,
    },
    {
      label: t('右移列'),
      icon: 'arrowRight',
      action: () =>
        applyTableEdit(view, table, (data) => moveColumnAt(data, columnIndex, columnIndex + 1)),
      disabled: readOnly || columnIndex === table.header.length - 1,
    },
    {
      label: t('删列'),
      icon: 'trash',
      title: t('删除当前列'),
      action: () => applyTableEdit(view, table, (data) => deleteColumnAt(data, columnIndex)),
      disabled: readOnly || table.header.length <= 1,
      danger: true,
    },
  ])
  const setColumnLayout = (mode: TableColumnWidthMode): void => {
    const controller = tableControllers.get(wrapper)
    if (controller) controller.layoutMode = mode
    applyTableColumnLayout(wrapper, mode)
    view.dispatch({ effects: setTableLayoutOverride.of({ from: table.from, mode }) })
  }
  const currentLayout =
    tableControllers.get(wrapper)?.layoutMode ??
    (wrapper.dataset.xmdTableLayout as TableColumnWidthMode | undefined)
  addSection(t('布局'), [
    {
      label: t('智能占满'),
      icon: 'stretchHorizontal',
      title: t('智能占满表格'),
      action: () => setColumnLayout('distribute'),
      selected: currentLayout === 'distribute',
    },
    {
      label: t('内容适配'),
      icon: 'wandSparkles',
      title: t('按内容适配列宽'),
      action: () => setColumnLayout('fit'),
      selected: currentLayout === 'fit',
    },
    {
      label: t('等宽'),
      icon: 'columns',
      title: t('所有列等宽'),
      action: () => setColumnLayout('equal'),
      selected: currentLayout === 'equal',
    },
    {
      label: t('放大展开'),
      icon: 'maximize',
      action: () => {
        const html = expandedTableHtml(wrapper)
        if (html) tableZoomBridge.request(html)
      },
    },
  ])
  addSection(t('对齐'), [
    {
      label: t('左对齐'),
      icon: 'alignLeft',
      action: () =>
        applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'left')),
      disabled: readOnly,
      selected: table.alignments[columnIndex] === 'left',
    },
    {
      label: t('居中对齐'),
      icon: 'alignCenter',
      action: () =>
        applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'center')),
      disabled: readOnly,
      selected: table.alignments[columnIndex] === 'center',
    },
    {
      label: t('右对齐'),
      icon: 'alignRight',
      action: () =>
        applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'right')),
      disabled: readOnly,
      selected: table.alignments[columnIndex] === 'right',
    },
  ])
  addSection(t('表格'), [
    {
      label: t('删除表格'),
      icon: 'trash',
      action: () => deleteTable(view, table),
      disabled: readOnly,
      danger: true,
    },
    {
      label: t('全选'),
      icon: 'selectAll',
      shortcut: shortcutHint('Mod+A'),
      action: () => {
        cellElement.focus()
        const selection = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(cellElement)
        selection?.removeAllRanges()
        selection?.addRange(range)
      },
    },
  ])

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
    hideTooltip()
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
  layoutMode: TableColumnWidthMode
  autoResize: boolean
  resizeObserver?: ResizeObserver
  layoutFrame?: number
  layoutTimer?: number
  /**
   * The screen x coordinate a run of consecutive ArrowUp/ArrowDown cell hops
   * is trying to keep (CM6's `goalColumn` semantics, but in widget-DOM
   * pixels). Re-reading the caret's x on every hop would let the goal drift
   * inward when the caret passes through a narrow cell and gets clamped to
   * its edge; remembering the first hop's x keeps a straight vertical path.
   * Reset by any non-vertical key and by pointer interaction.
   */
  verticalGoalX?: number
}

const tableControllers = new WeakMap<HTMLElement, TableWidgetController>()

function cancelScheduledTableLayout(controller: TableWidgetController): void {
  if (controller.layoutTimer !== undefined) window.clearTimeout(controller.layoutTimer)
  if (controller.layoutFrame !== undefined) window.cancelAnimationFrame(controller.layoutFrame)
  controller.layoutTimer = undefined
  controller.layoutFrame = undefined
}

function scheduleTableLayout(
  wrapper: HTMLElement,
  controller: TableWidgetController,
  delay = 0,
): void {
  cancelScheduledTableLayout(controller)
  const request = (): void => {
    controller.layoutTimer = undefined
    controller.layoutFrame = window.requestAnimationFrame(() => {
      controller.layoutFrame = undefined
      if (wrapper.isConnected) applyTableColumnLayout(wrapper, controller.layoutMode)
    })
  }
  if (delay > 0) controller.layoutTimer = window.setTimeout(request, delay)
  else request()
}

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
 *
 * A keydown can legitimately arrive with no live selection inside `element`
 * yet — e.g. the very first Shift+Enter right after a programmatic
 * `element.focus()` (`focusCell`/`moveFocus`), where the browser has not
 * finished publishing a `Selection` range for the new focus target by the
 * time this synchronous handler runs. Falling back to a fresh collapsed
 * range at the cell's end (instead of bailing out) is what makes the very
 * first press reliable instead of silently doing nothing until a second
 * attempt gives the browser time to catch up.
 */
function insertTableCellSoftBreak(element: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection) return false
  let range = selection.rangeCount ? selection.getRangeAt(0) : null
  if (!range || !element.contains(range.commonAncestorContainer)) {
    range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
  }
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

export interface HorizontalCellRect {
  left: number
  right: number
}

/**
 * Pure geometry step behind vertical cell navigation's "goal column": given
 * the client rects of one row's editable cells (in column order) and a
 * target x coordinate, pick the cell whose rect contains `x`, or — if `x`
 * falls in a gap/margin between cells — the cell whose horizontal center is
 * closest. Returns `-1` for an empty row. Factored out of
 * `TableWidget.cellAtHorizontalCoordinate` so the selection rule itself is
 * unit-testable without a real layout engine (`getBoundingClientRect` is
 * meaningless in jsdom).
 */
export function indexOfCellAtHorizontalCoordinate(
  rects: readonly HorizontalCellRect[],
  x: number,
): number {
  const containing = rects.findIndex((rect) => x >= rect.left && x <= rect.right)
  if (containing >= 0) return containing
  let nearest = -1
  let nearestDistance = Infinity
  rects.forEach((rect, index) => {
    const distance = Math.abs((rect.left + rect.right) / 2 - x)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = index
    }
  })
  return nearest
}

export interface VerticalCaretRect {
  top: number
  bottom: number
  height: number
}

/**
 * Whether a caret sits on a cell's first (`atStart`) or last visual line,
 * judged purely by geometry: the caret rect against the cell content's rect.
 * Geometry — unlike text-offset or `<br>`-counting checks — treats a caret
 * anywhere on the boundary line as "at the boundary" and stays correct for
 * soft-wrapped lines. Factored out of `TableWidget.isAtCellVerticalBoundary`
 * for the same jsdom reason as `indexOfCellAtHorizontalCoordinate`.
 */
export function caretOnBoundaryVisualLine(
  caret: VerticalCaretRect,
  content: { top: number; bottom: number },
  atStart: boolean,
): boolean {
  const tolerance = Math.max(caret.height / 2, 4)
  return atStart ? caret.top - content.top < tolerance : content.bottom - caret.bottom < tolerance
}

/**
 * A collapsed range at the viewport point, clamped to `cell`. Hit testing a
 * point in the cell's padding resolves to the nearest text position, which is
 * what a click there means; the cell's end is the fallback for the browsers and
 * jsdom that answer with nothing or with a node outside the cell.
 */
function caretRangeAtPoint(cell: HTMLElement, x: number, y: number): Range {
  const position = document.caretPositionFromPoint?.(x, y)
  const hit = position
    ? (() => {
        const range = document.createRange()
        range.setStart(position.offsetNode, position.offset)
        range.collapse(true)
        return range
      })()
    : (document.caretRangeFromPoint?.(x, y) ?? null)
  if (hit?.collapsed && cell.contains(hit.startContainer)) return hit
  const end = document.createRange()
  end.selectNodeContents(cell)
  end.collapse(false)
  return end
}

/**
 * Whether a cell selection belongs to the engine rather than the user: its text
 * projection carries no content, only structure.
 *
 * The three characters stripped here are the structure `Selection.toString()`
 * can emit around an empty range, and each one is a real case observed in
 * WebKit rather than a guess:
 *
 * - `\t` — a cell boundary. Clicking a cell's lower padding gets a range from
 *   the text's end to the *next* `<td>`'s start, which projects as a lone tab
 *   and paints as a strip across the rest of the line.
 * - `\n` — a block's implicit trailing break, the same strip within one cell.
 * - the zero-width filler an empty cell is padded with.
 *
 * Real spaces are deliberately not stripped: trimming would also swallow a
 * double-click on the gap between two words and teleport the caret to the
 * cell's end. A lone tab is treated as structure rather than content because a
 * GFM cell cannot hold one — selecting exactly a tab and nothing else is not a
 * gesture a user has, while the strip fires on an ordinary click.
 */
export function isSyntheticCellSelection(selectedText: string): boolean {
  return selectedText.replace(/[​\n\t]/g, '') === ''
}

/**
 * Collapse a table selection WebKit built spanning two adjacent cells' separate
 * `contentEditable` islands — not a state any gesture reaches on purpose, since
 * a GFM cell can hold neither a tab nor a run into a sibling cell, so its text
 * projection is structure only (`isSyntheticCellSelection`).
 *
 * Reacts to `selectionchange`, not to a specific pointer event, and that turns
 * out to be load-bearing rather than a style choice. Once WebKit crosses this
 * boundary it freezes the selection at that first bad range and stops tracking
 * the pointer — confirmed by instrumenting a live repro: a drag that started by
 * double-clicking into a header cell froze the selection spanning that cell and
 * its neighbour, then `mouseup` fired rows away, on a cell containing neither
 * endpoint. A handler bound to *a* mouse event on *a* cell inspects the wrong
 * place as soon as the event and the frozen range disagree on which cell that
 * is; `selectionchange` inspects the selection itself, wherever it lives, and
 * — per the same repro — reports the freeze before that mouseup even fires.
 *
 * Collapsing to the range's own start rather than to this event's pointer
 * position is deliberate for the same reason: once frozen, there is no live
 * pointer position left that means anything — the start is simply the last
 * point WebKit was still tracking correctly before it gave up.
 */
function settleTableSelection(root: HTMLElement): void {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  if (range.collapsed) return
  const anchor =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  if (!anchor || !root.contains(anchor) || !anchor.closest('.xmd-cm-table-preview')) return
  if (!isSyntheticCellSelection(selection.toString())) return
  selection.collapseToStart()
}

/**
 * Give a cell the same secondary-click rule `contextMenuSelection()` gives the
 * outer document: keep a real selection the pointer landed inside, otherwise
 * collapse to a caret there.
 *
 * That extension cannot reach here — `TableWidget.ignoreEvent()` makes CM6's
 * `eventBelongsToEditor` reject cell events before any `domEventHandlers` run —
 * while WebKit expands the caret to the text under the pointer before it
 * dispatches `contextmenu`, which on a cell's last line means its implicit
 * break, painting as the same wide strip `dblclick` deals with below.
 *
 * Unlike the outer document there is no race to lose here: a cell's selection
 * is plain DOM with no CM6 DOMObserver syncing it into state behind us, so the
 * range written here is the one that stays.
 */
function settleCellContextMenuSelection(cell: HTMLElement, event: MouseEvent): void {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  if (!cell.contains(range.startContainer) || !cell.contains(range.endContainer)) return
  const caret = caretRangeAtPoint(cell, event.clientX, event.clientY)
  // Real selected text under the pointer is the user's, and the cell menu's
  // inline-format commands act on it.
  if (
    !isSyntheticCellSelection(selection.toString()) &&
    range.comparePoint(caret.startContainer, caret.startOffset) === 0
  ) {
    return
  }
  selection.removeAllRanges()
  selection.addRange(caret)
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: MarkdownTableMatch,
    readonly rowHeight: number,
    readonly readOnly: boolean,
    readonly layoutMode: TableColumnWidthMode,
    readonly autoResize: boolean,
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return (
      this.rowHeight === other.rowHeight &&
      this.readOnly === other.readOnly &&
      this.layoutMode === other.layoutMode &&
      this.autoResize === other.autoResize &&
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

    const layoutChanged = controller.layoutMode !== this.layoutMode
    controller.table = this.table
    controller.layoutMode = this.layoutMode
    controller.autoResize = this.autoResize
    // Skips the actively-focused cell so mid-edit reconciliation cannot move the caret.
    this.reconcileCells(controller)
    if (layoutChanged) scheduleTableLayout(dom, controller)
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
    const colgroup = document.createElement('colgroup')
    for (let column = 0; column < this.table.header.length; column += 1) {
      colgroup.append(document.createElement('col'))
    }
    const head = document.createElement('thead')
    const body = document.createElement('tbody')

    const controller: TableWidgetController = {
      table: this.table,
      cellElements: new Map(),
      cellByElement: new WeakMap(),
      layoutMode: this.layoutMode,
      autoResize: this.autoResize,
    }

    head.append(this.createRow(view, controller, this.table.header, true))
    for (const row of this.table.rows) body.append(this.createRow(view, controller, row, false))
    table.append(colgroup, head, body)
    wrapper.append(table)
    // Two layers keep pointer activity on the table from turning into a CM6
    // source selection. CM6's own input dispatch already skips every event
    // whose target sits inside this widget (`ignoreEvent()` below returns
    // true, so `eventBelongsToEditor` rejects it), and the whole table span
    // is atomic via `collectTableHiddenRanges`, so even a drag that *starts
    // outside* the table steps over it as one unit instead of selecting its
    // source. What that leaves exposed is ancestor listeners outside CM6's
    // dispatch — bubble-phase handlers on the editor container/document added
    // by the app or future code, which never consult `ignoreEvent`. Stop
    // propagation at the widget boundary so a mousedown on the table's chrome
    // (padding/borders between cells, not a `td`/`th`) is never
    // re-interpreted upstream — the same defence `openTableContextMenu`
    // applies to `contextmenu`.
    wrapper.addEventListener('mousedown', (event) => event.stopPropagation())
    wrapper.addEventListener('pointerdown', (event) => event.stopPropagation())
    if (typeof ResizeObserver !== 'undefined') {
      controller.resizeObserver = new ResizeObserver(() => {
        scheduleTableLayout(wrapper, controller)
        view.requestMeasure()
      })
      controller.resizeObserver.observe(wrapper)
    }
    tableControllers.set(wrapper, controller)
    scheduleTableLayout(wrapper, controller)
    return wrapper
  }

  destroy(dom: HTMLElement): void {
    for (const cell of editableCellsInOrder(dom)) tableCellCommandBridge.deactivate(cell)
    const controller = tableControllers.get(dom)
    controller?.resizeObserver?.disconnect()
    if (controller) cancelScheduledTableLayout(controller)
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
      const wrapper = element.closest<HTMLElement>('.xmd-cm-table-preview')
      if (wrapper && controller.autoResize) scheduleTableLayout(wrapper, controller, 160)
    }

    element.addEventListener('input', (event) => {
      if (event instanceof InputEvent && event.isComposing) return
      commitCell()
      tableCellCommandBridge.refresh(element)
    })
    element.addEventListener('compositionend', commitCell)
    element.addEventListener('focus', () => {
      // Entering a cell must leave exactly one visible selection: the cell's
      // own. CM6 never sees the mousedown that focused this cell (widget
      // events are ignored), so a non-empty outer-document selection made
      // beforehand would stay painted by drawSelection next to the cell's
      // native selection. Collapse it.
      if (!view.state.selection.main.empty) {
        view.dispatch({ selection: { anchor: view.state.selection.main.head } })
      }
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
    element.addEventListener('mouseup', () => {
      // A pointer interaction re-anchors the caret; the next vertical run
      // starts a fresh goal column from wherever the user clicked.
      controller.verticalGoalX = undefined
      tableCellCommandBridge.refresh(element)
    })
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
      // Settle the selection before the menu reads it for its format state.
      settleCellContextMenuSelection(element, event)
      tableCellCommandBridge.refresh(element)
      openTableContextMenu(event, {
        view,
        table: controller.table,
        rowKind: position.rowKind,
        columnIndex: position.columnIndex,
        wrapper: element.closest<HTMLElement>('.xmd-cm-table-preview')!,
        cellElement: element,
      })
    })

    element.addEventListener('keydown', (event) => {
      if (event.isComposing) return
      // A table cell is a nested contenteditable island inside
      // `view.contentDOM`. CM6's own keymaps never see these keystrokes
      // (`ignoreEvent()` on this widget makes `eventBelongsToEditor` reject
      // them), but ancestor listeners outside CM6's dispatch — bubble-phase
      // keydown handlers on the editor container/document added by the app
      // or future code — would still receive them and could act on CM6's own,
      // unrelated document selection while the native caret stays in this
      // cell. Cut the bubble at the cell boundary; window-level *capture*
      // listeners (useAppShortcuts, which routes Cmd+B etc. into
      // tableCellCommandBridge) run before this handler and are unaffected.
      // This mirrors the existing `stopPropagation` in `openTableContextMenu`.
      event.stopPropagation()
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        controller.verticalGoalX = undefined
      }
      if (view.state.readOnly) return
      const withMod = event.metaKey || event.ctrlKey
      if (withMod && event.key.toLowerCase() === 'z') {
        // History belongs to the outer CM6 view, not this cell — and every
        // other keystroke here stops before reaching CM6's own historyKeymap
        // (see the stopPropagation above), so undo/redo must be dispatched
        // against `view` directly instead of relying on that keymap.
        event.preventDefault()
        const handled = event.shiftKey ? cm6Redo(view) : cm6Undo(view)
        if (handled) view.focus()
        return
      }
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
        if (!this.isAtCellVerticalBoundary(element, event.key === 'ArrowUp')) {
          // Native in-cell line movement changes the caret's x; a stale goal
          // from an earlier cross-cell run must not override it later.
          controller.verticalGoalX = undefined
          return
        }
        event.preventDefault()
        const direction = event.key === 'ArrowUp' ? -1 : 1
        const goalX = controller.verticalGoalX ?? this.caretX(element)
        controller.verticalGoalX = goalX
        if (!this.moveFocus(element, direction, /* vertical */ true, goalX)) {
          // At a table edge, continue in the document above/below the table.
          // Never fall back to a neighbouring left/right cell for a vertical
          // key. Land inside the adjacent line (not at the widget's own
          // from/to boundary, where the caret would render pinned to the
          // table's edge instead of in the neighbouring text row).
          controller.verticalGoalX = undefined
          const position =
            direction < 0
              ? Math.max(0, controller.table.from - 1)
              : Math.min(view.state.doc.length, controller.table.to + 1)
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

  /**
   * Tab moves in reading order. Vertical moves preserve the caret's screen X
   * coordinate — `goalX` (a run's remembered goal column, see
   * `TableWidgetController.verticalGoalX`) when supplied, the live caret x
   * otherwise.
   */
  private moveFocus(
    current: HTMLElement,
    direction: 1 | -1,
    vertical: boolean,
    goalX?: number,
  ): boolean {
    const table = current.closest('table')
    const row = current.closest('tr')
    if (!table || !row) return false
    if (vertical) {
      const x = goalX ?? this.caretX(current)
      const allRows = Array.from(table.querySelectorAll('tr'))
      const targetRow = allRows[allRows.indexOf(row) + direction]
      const target = targetRow
        ? this.cellAtHorizontalCoordinate(Array.from(targetRow.children), x)
        : undefined
      if (target?.isContentEditable) {
        this.focusCell(target, x)
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
    // An empty cell has no caret rect and exactly one visual line.
    const caretRect = range.getClientRects().item(0)
    if (!caretRect || caretRect.height === 0) return true
    const contents = document.createRange()
    contents.selectNodeContents(element)
    const contentRect = contents.getBoundingClientRect()
    if (contentRect.height === 0) return true
    return caretOnBoundaryVisualLine(caretRect, contentRect, atStart)
  }

  private caretX(element: HTMLElement): number {
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null
    const rect = range?.getClientRects().item(0)
    return rect?.left ?? element.getBoundingClientRect().left + 12
  }

  private cellAtHorizontalCoordinate(cells: Element[], x: number): HTMLElement | undefined {
    const editable = cells.filter(
      (cell): cell is HTMLElement => cell instanceof HTMLElement && cell.isContentEditable,
    )
    const index = indexOfCellAtHorizontalCoordinate(
      editable.map((cell) => cell.getBoundingClientRect()),
      x,
    )
    return index < 0 ? undefined : editable[index]
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
    else if (hitRange && element.contains(hitRange.startContainer))
      range.setStart(hitRange.startContainer, hitRange.startOffset)
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
  const columnWidthMode = options.columnWidthMode ?? 'distribute'
  const autoResize = options.autoResize ?? true
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
        document.addEventListener('selectionchange', this.onSelectionChange)
      }

      private onSelectionChange = (): void => {
        settleTableSelection(this.view.dom)
      }

      update(update: ViewUpdate): void {
        // Cells are edited in place now, so table widgets no longer need to rebuild
        // when the selection merely moves into/out of the table's source range.
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.startState.readOnly !== update.state.readOnly ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setTableLayoutOverride)),
          ) ||
          syntaxTree(update.startState) !== syntaxTree(update.state)
        )
          this.schedule()
      }

      destroy(): void {
        this.destroyed = true
        document.removeEventListener('selectionchange', this.onSelectionChange)
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
        const overrides = this.view.state.field(tableLayoutOverrides)
        const ranges = findVisibleMarkdownTables(
          this.view.state,
          this.view.visibleRanges,
          bufferChars,
        ).map((table) =>
          Decoration.replace({
            widget: new TableWidget(
              table,
              rowHeight,
              this.view.state.readOnly,
              overrides.get(table.from) ?? columnWidthMode,
              autoResize,
            ),
            block: true,
          }).range(table.from, table.to),
        )
        return Decoration.set(ranges, true)
      }
    },
  )
  return [
    tableLayoutOverrides,
    decorationField,
    viewportObserver,
    hiddenRangeSource.of(({ state, visibleRanges }) =>
      collectTableHiddenRanges(state, visibleRanges, bufferChars),
    ),
  ]
}
