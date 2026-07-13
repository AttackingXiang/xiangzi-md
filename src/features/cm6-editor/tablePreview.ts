import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state'
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

function selectionTouches(state: EditorState, table: MarkdownTableMatch): boolean {
  return state.selection.ranges.some(({ from, to }) =>
    from === to ? from >= table.from && from < table.to : from < table.to && to > table.from,
  )
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
  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'xmd-cm-table-preview'
    wrapper.dataset.xmdTable = 'true'
    wrapper.style.minHeight = `${this.estimatedHeight}px`
    const table = document.createElement('table')
    const head = document.createElement('thead')
    const body = document.createElement('tbody')
    head.append(this.createRow(view, this.table.header, true))
    for (const row of this.table.rows) body.append(this.createRow(view, row, false))
    table.append(head, body)
    wrapper.append(table)
    return wrapper
  }
  ignoreEvent(): boolean {
    // Cell click handlers own widget events and explicitly move the CM6 selection.
    return true
  }
  private createRow(
    view: EditorView,
    cells: MarkdownTableCell[],
    header: boolean,
  ): HTMLTableRowElement {
    const row = document.createElement('tr')
    const count = Math.max(this.table.header.length, cells.length)
    for (let column = 0; column < count; column++) {
      const cell = cells[column]
      const element = document.createElement(header ? 'th' : 'td')
      element.textContent = cell?.text ?? ''
      const align = this.table.alignments[column]
      if (align) element.style.textAlign = align
      if (cell) {
        element.dataset.sourceFrom = String(cell.from)
        element.dataset.sourceTo = String(cell.to)
        element.addEventListener('click', (event) => {
          event.preventDefault()
          view.dispatch({
            selection: EditorSelection.range(cell.from, cell.to),
            scrollIntoView: true,
          })
          view.focus()
        })
      }
      row.append(element)
    }
    return row
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
        if (update.docChanged || update.selectionSet || update.viewportChanged) this.schedule()
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
        )
          .filter((table) => !selectionTouches(this.view.state, table))
          .map((table) =>
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
