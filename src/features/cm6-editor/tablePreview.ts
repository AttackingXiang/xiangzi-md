import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view'
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
  header: MarkdownTableCell[]
  rows: MarkdownTableCell[][]
  alignments: TableAlignment[]
}
export interface MarkdownTablePreviewOptions {
  bufferChars?: number
  rowHeight?: number
}

const DEFAULT_BUFFER_CHARS = 2_000
const DEFAULT_ROW_HEIGHT = 38

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
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

/** Plain-text snapshot of a table, used as the working copy for row/column edits. */
interface TableData {
  header: string[]
  rows: string[][]
  alignments: TableAlignment[]
}

function toTableData(table: MarkdownTableMatch): TableData {
  return {
    header: table.header.map((cell) => cell.text),
    rows: table.rows.map((row) => row.map((cell) => cell.text)),
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

function serializeTableData(data: TableData): string {
  return [
    serializeRow(data.header),
    serializeRow(data.alignments.map(alignmentMarker)),
    ...data.rows.map(serializeRow),
  ].join('\n')
}

/** Row/column structural edits. `rowIndex`/`columnIndex` are 0-based into `data.rows`/cells;
 *  the header row is addressed separately since it can't be deleted or reordered. */
function insertRowAt(data: TableData, rowIndex: number): TableData {
  const rows = [...data.rows]
  rows.splice(rowIndex, 0, data.header.map(() => ''))
  return { ...data, rows }
}
function deleteRowAt(data: TableData, rowIndex: number): TableData {
  return { ...data, rows: data.rows.filter((_, index) => index !== rowIndex) }
}
function insertColumnAt(data: TableData, columnIndex: number): TableData {
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
function deleteColumnAt(data: TableData, columnIndex: number): TableData {
  return {
    header: data.header.filter((_, index) => index !== columnIndex),
    alignments: data.alignments.filter((_, index) => index !== columnIndex),
    rows: data.rows.map((row) => row.filter((_, index) => index !== columnIndex)),
  }
}
function setColumnAlignment(data: TableData, columnIndex: number, align: TableAlignment): TableData {
  const alignments = [...data.alignments]
  alignments[columnIndex] = align
  return { ...data, alignments }
}

function applyTableEdit(
  view: EditorView,
  table: MarkdownTableMatch,
  mutate: (data: TableData) => TableData,
): void {
  const next = mutate(toTableData(table))
  view.dispatch({ changes: { from: table.from, to: table.to, insert: serializeTableData(next) } })
  view.focus()
}

function deleteTable(view: EditorView, table: MarkdownTableMatch): void {
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
  const bodyRowIndex = rowKind === 'header' ? null : rowKind
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
    menu.append(Object.assign(document.createElement('div'), { className: 'xmd-cm-table-menu-separator' }))
  }

  addItem(
    '在上方插入行',
    null,
    () => applyTableEdit(view, table, (data) => insertRowAt(data, bodyRowIndex ?? 0)),
    bodyRowIndex === null,
  )
  addItem('在下方插入行', '⌘Enter', () =>
    applyTableEdit(view, table, (data) =>
      insertRowAt(data, bodyRowIndex === null ? 0 : bodyRowIndex + 1),
    ),
  )
  addItem(
    '删除行',
    '⌘⌫',
    () => applyTableEdit(view, table, (data) => deleteRowAt(data, bodyRowIndex ?? 0)),
    bodyRowIndex === null,
  )
  addSeparator()
  addItem('在左侧插入列', null, () =>
    applyTableEdit(view, table, (data) => insertColumnAt(data, columnIndex)),
  )
  addItem('在右侧插入列', null, () =>
    applyTableEdit(view, table, (data) => insertColumnAt(data, columnIndex + 1)),
  )
  addItem(
    '删除列',
    null,
    () => applyTableEdit(view, table, (data) => deleteColumnAt(data, columnIndex)),
    table.header.length <= 1,
  )
  addSeparator()
  addItem('左对齐', null, () =>
    applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'left')),
  )
  addItem('居中对齐', null, () =>
    applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'center')),
  )
  addItem('右对齐', null, () =>
    applyTableEdit(view, table, (data) => setColumnAlignment(data, columnIndex, 'right')),
  )
  addSeparator()
  addItem('删除表格', null, () => deleteTable(view, table))

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

function insertPlainText(text: string): void {
  document.execCommand('insertText', false, text)
}

class TableWidget extends WidgetType {
  constructor(
    readonly table: MarkdownTableMatch,
    readonly rowHeight: number,
  ) {
    super()
  }
  eq(other: TableWidget): boolean {
    return (
      this.rowHeight === other.rowHeight &&
      JSON.stringify(this.table) === JSON.stringify(other.table)
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
        if (document.activeElement !== element && element.textContent !== cell.text) {
          element.textContent = cell.text
        }
        element.style.textAlign = this.table.alignments[column] ?? ''
        element.dataset.sourceFrom = String(cell.from)
        element.dataset.sourceTo = String(cell.to)
        nextCellElements.set(cell, element)
      })
    }
    controller.cellElements = nextCellElements
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'xmd-cm-table-preview'
    wrapper.dataset.xmdTable = 'true'
    wrapper.style.minHeight = `${this.estimatedHeight}px`
    const table = document.createElement('table')
    const head = document.createElement('thead')
    const body = document.createElement('tbody')

    const controller: TableWidgetController = {
      table: this.table,
      cellElements: new Map(),
    }

    head.append(this.createRow(view, controller, this.table.header, true))
    for (const row of this.table.rows) body.append(this.createRow(view, controller, row, false))
    table.append(head, body)
    wrapper.append(table)
    tableControllers.set(wrapper, controller)
    return wrapper
  }

  destroy(dom: HTMLElement): void {
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
    const count = Math.max(this.table.header.length, cells.length)
    for (let column = 0; column < count; column++) {
      const cell = cells[column]
      const element = document.createElement(header ? 'th' : 'td')
      const align = this.table.alignments[column]
      if (align) element.style.textAlign = align
      if (cell) {
        element.textContent = cell.text
        element.contentEditable = 'true'
        element.dataset.sourceFrom = String(cell.from)
        element.dataset.sourceTo = String(cell.to)
        controller.cellElements.set(cell, element)
        this.bindCellEvents(view, controller, element, cell)
      }
      row.append(element)
    }
    return row
  }

  private bindCellEvents(
    view: EditorView,
    controller: TableWidgetController,
    element: HTMLElement,
    cell: MarkdownTableCell,
  ): void {
    element.addEventListener('input', () => {
      const raw = element.textContent ?? ''
      if (raw === cell.text) return
      const escaped = escapeTableCellText(raw)
      const from = cell.from
      const to = cell.to
      const delta = escaped.length - (to - from)
      view.dispatch({ changes: { from, to, insert: escaped } })
      cell.text = raw
      cell.to = from + escaped.length
      shiftCellsAfter(controller.table, cell, to, delta)
    })

    element.addEventListener('paste', (event) => {
      event.preventDefault()
      const text = event.clipboardData?.getData('text/plain') ?? ''
      insertPlainText(text.replace(/\r?\n/g, ' '))
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
      const withMod = event.metaKey || event.ctrlKey
      if (withMod && event.key === 'Enter') {
        event.preventDefault()
        const position = cellPosition(element)
        if (position) {
          applyTableEdit(view, controller.table, (data) =>
            insertRowAt(data, position.rowKind === 'header' ? 0 : position.rowKind + 1),
          )
        }
        return
      }
      if (withMod && event.key === 'Backspace') {
        event.preventDefault()
        const position = cellPosition(element)
        if (position && position.rowKind !== 'header') {
          applyTableEdit(view, controller.table, (data) => deleteRowAt(data, position.rowKind as number))
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        this.moveFocus(element, event.shiftKey ? -1 : 1, /* sameColumn */ true)
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

  /** Tab moves to the next/previous cell in reading order; Enter moves one row down/up. */
  private moveFocus(current: HTMLElement, direction: 1 | -1, sameColumn: boolean): void {
    const table = current.closest('table')
    const row = current.closest('tr')
    if (!table || !row) return
    if (sameColumn) {
      const columnIndex = Array.from(row.children).indexOf(current)
      const allRows = Array.from(table.querySelectorAll('tr'))
      const targetRow = allRows[allRows.indexOf(row) + direction]
      const target = targetRow?.children[columnIndex] as HTMLElement | undefined
      if (target?.isContentEditable) this.focusCell(target)
      return
    }
    const cells = editableCellsInOrder(table)
    const target = cells[cells.indexOf(current) + direction]
    if (target) this.focusCell(target)
  }

  private focusCell(element: HTMLElement): void {
    element.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
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
        if (update.docChanged || update.viewportChanged) this.schedule()
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
          Decoration.replace({ widget: new TableWidget(table, rowHeight), block: true }).range(
            table.from,
            table.to,
          ),
        )
        return Decoration.set(ranges, true)
      }
    },
  )
  return [decorationField, viewportObserver]
}
