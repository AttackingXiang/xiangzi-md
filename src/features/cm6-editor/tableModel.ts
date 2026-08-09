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

/** Plain-text snapshot used by structural row and column edits. */
export interface TableData {
  header: string[]
  rows: string[][]
  alignments: TableAlignment[]
}

/** Re-escape a cell's plain text back into Markdown table syntax. */
export function escapeTableCellText(value: string): string {
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

export function toTableData(table: MarkdownTableMatch): TableData {
  const columnCount = table.header.length
  return {
    header: table.header.map((cell) => cell.text),
    // GFM ignores surplus body cells and renders missing cells as empty. Keep
    // the editing model aligned with that visible column count.
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
  const move = <Value>(values: Value[]): Value[] => {
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
