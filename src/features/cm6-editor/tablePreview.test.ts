import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  caretOnBoundaryVisualLine,
  collectTableHiddenRanges,
  deleteColumnAt,
  findVisibleMarkdownTables,
  indexOfCellAtHorizontalCoordinate,
  insertColumnAt,
  insertRowAt,
  markdownTablePreview,
  moveColumnAt,
  moveRowAt,
  normalizeTableCellBreaks,
  parseTableCellInline,
  parseMarkdownTable,
  serializeTableCellInline,
  type VerticalCaretRect,
  serializeTableData,
  splitTableCellLines,
  tableCellPlainText,
  toTableData,
  splitMarkdownTableRow,
} from './tablePreview'

const source = ['| Name | Value |', '| :--- | ---: |', '| Alpha | 1 |', '| Beta | 2 |'].join('\n')
const makeState = (prefix = '') =>
  EditorState.create({ doc: `${prefix}${source}`, extensions: markdown({ extensions: GFM }) })

describe('Markdown table preview', () => {
  it('splits escaped pipes and preserves empty cells', () => {
    expect(splitMarkdownTableRow('| a\\|b |  | c |', 0).map((cell) => cell.text)).toEqual([
      'a|b',
      '',
      'c',
    ])
  })
  it('tracks source positions for cell navigation', () => {
    expect(splitMarkdownTableRow('| a | b |', 10)[0]).toMatchObject({ from: 12, to: 13, text: 'a' })
  })
  it('parses header, rows and alignment', () => {
    const state = makeState()
    const table = parseMarkdownTable(state, 0, state.doc.length)
    expect(table?.header.map((cell) => cell.text)).toEqual(['Name', 'Value'])
    expect(table?.rows[1].map((cell) => cell.text)).toEqual(['Beta', '2'])
    expect(table?.alignments).toEqual(['left', 'right'])
  })
  it('discovers only GFM Table nodes in the visible scan range', () => {
    expect(
      findVisibleMarkdownTables(makeState(), [{ from: 0, to: source.length }], 0),
    ).toHaveLength(1)
    const prefix = `${'plain text\n'.repeat(20)}\n`
    expect(findVisibleMarkdownTables(makeState(prefix), [{ from: 0, to: 10 }], 0)).toHaveLength(0)
  })
  it('normalizes portable in-cell Markdown line breaks', () => {
    expect(normalizeTableCellBreaks('first<BR />second<br>third')).toBe('first<br>second<br>third')
    expect(splitTableCellLines('`literal<br>tag`<br>next')).toEqual(['`literal<br>tag`', 'next'])
  })
  it('copies portable cell breaks as plain-text newlines', () => {
    expect(tableCellPlainText('**first**<br />`second` and [third](https://example.com)')).toBe(
      'first\nsecond and third',
    )
  })
  it('parses editable inline table formatting without exposing Markdown markers', () => {
    expect(parseTableCellInline('**bold** and `code` and [link](https://example.com)')).toEqual([
      {
        kind: 'strong',
        prefix: '**',
        suffix: '**',
        children: [{ kind: 'text', text: 'bold' }],
      },
      { kind: 'text', text: ' and ' },
      {
        kind: 'code',
        prefix: '`',
        suffix: '`',
        children: [{ kind: 'text', text: 'code' }],
      },
      { kind: 'text', text: ' and ' },
      {
        kind: 'link',
        prefix: '[',
        suffix: '](https://example.com)',
        children: [{ kind: 'text', text: 'link' }],
      },
    ])
  })
  it('round-trips nested inline source while its plain-text projection hides markers', () => {
    const source = '***bold italic***, ~~gone~~, \\*literal* and <https://example.com>'
    const parts = parseTableCellInline(source)
    expect(serializeTableCellInline(parts)).toBe(source)
    expect(tableCellPlainText(source)).toBe('bold italic, gone, *literal* and https://example.com')
  })
  it('normalizes irregular body rows to the GFM header width for structural edits', () => {
    const irregular = ['| A | B |', '| --- | --- |', '| one |', '| x | y | ignored |'].join('\n')
    const state = EditorState.create({ doc: irregular, extensions: markdown({ extensions: GFM }) })
    const parsed = parseMarkdownTable(state, 0, state.doc.length)
    expect(parsed).not.toBeNull()
    expect(toTableData(parsed!).rows).toEqual([
      ['one', ''],
      ['x', 'y'],
    ])
  })
  it('serializes inserted and deleted rows and columns without losing alignment', () => {
    const data = toTableData(parseMarkdownTable(makeState(), 0, source.length)!)
    const withRow = insertRowAt(data, 1)
    const withColumn = insertColumnAt(withRow, 1)
    expect(withColumn.rows[1]).toEqual(['', '', ''])
    expect(withColumn.alignments).toEqual(['left', null, 'right'])
    expect(serializeTableData(deleteColumnAt(withColumn, 1))).toContain('| :---- | ----: |')
  })
  it('preserves Markdown escapes and Windows paths while escaping table delimiters', () => {
    expect(
      serializeTableData({
        header: ['\\*literal\\*', 'C:\\tmp', 'A | B'],
        alignments: [null, null, null],
        rows: [],
      }),
    ).toContain('| \\*literal\\* | C:\\tmp | A \\| B |')
  })
  it('moves rows and columns together with their alignment and cell values', () => {
    const data = toTableData(parseMarkdownTable(makeState(), 0, source.length)!)
    expect(moveRowAt(data, 0, 1).rows).toEqual([
      ['Beta', '2'],
      ['Alpha', '1'],
    ])
    expect(moveColumnAt(data, 0, 1)).toMatchObject({
      header: ['Value', 'Name'],
      alignments: ['right', 'left'],
      rows: [
        ['1', 'Alpha'],
        ['2', 'Beta'],
      ],
    })
  })
  it('registers each table span through the core hidden-range engine, not its own atomicRanges provider', () => {
    const prefix = 'before\n\n'
    const state = makeState(prefix)
    expect(collectTableHiddenRanges(state, [{ from: 0, to: state.doc.length }], 0)).toEqual([
      { from: prefix.length, to: prefix.length + source.length, paint: false },
    ])
    // Invariant 3 (core/README.md): the only atomicRanges provider is the
    // aggregated one installed by hiddenRangesEngine() in markdownLivePreview.
    const withExtension = EditorState.create({
      doc: source,
      extensions: [markdown({ extensions: GFM }), markdownTablePreview()],
    })
    expect(withExtension.facet(EditorView.atomicRanges)).toHaveLength(0)
  })

  it('does not register hidden ranges outside the buffered visible scan range', () => {
    const prefix = `${'plain text\n'.repeat(20)}\n`
    expect(collectTableHiddenRanges(makeState(prefix), [{ from: 0, to: 10 }], 0)).toHaveLength(0)
  })

  it('picks the vertically navigated cell by containment first, then nearest center', () => {
    const rects = [
      { left: 0, right: 100 },
      { left: 108, right: 200 },
      { left: 208, right: 400 },
    ]
    // Inside a cell: containment wins, even when another center is closer.
    expect(indexOfCellAtHorizontalCoordinate(rects, 99)).toBe(0)
    // In the gap between two cells: nearest center wins.
    expect(indexOfCellAtHorizontalCoordinate(rects, 104)).toBe(1)
    // Outside the row entirely: clamps to the nearest edge cell.
    expect(indexOfCellAtHorizontalCoordinate(rects, -50)).toBe(0)
    expect(indexOfCellAtHorizontalCoordinate(rects, 1000)).toBe(2)
    // No editable cells in the row.
    expect(indexOfCellAtHorizontalCoordinate([], 10)).toBe(-1)
  })

  it('judges vertical cell boundaries by visual line, not caret column', () => {
    const content = { top: 0, bottom: 60 }
    const line = (top: number): VerticalCaretRect => ({ top, bottom: top + 20, height: 20 })
    // Single-line cell: the caret is on both boundary lines wherever it sits.
    const single = { top: 0, bottom: 20 }
    expect(caretOnBoundaryVisualLine(line(0), single, true)).toBe(true)
    expect(caretOnBoundaryVisualLine(line(0), single, false)).toBe(true)
    // Three-line cell: first line is only the start boundary…
    expect(caretOnBoundaryVisualLine(line(0), content, true)).toBe(true)
    expect(caretOnBoundaryVisualLine(line(0), content, false)).toBe(false)
    // …the middle line is neither, and the last line is only the end boundary.
    expect(caretOnBoundaryVisualLine(line(20), content, true)).toBe(false)
    expect(caretOnBoundaryVisualLine(line(20), content, false)).toBe(false)
    expect(caretOnBoundaryVisualLine(line(40), content, true)).toBe(false)
    expect(caretOnBoundaryVisualLine(line(40), content, false)).toBe(true)
    // Sub-pixel layout jitter stays within the tolerance.
    expect(caretOnBoundaryVisualLine(line(1.5), content, true)).toBe(true)
  })

  it('keeps table layout content-driven while containing horizontal overflow', () => {
    const styles = readFileSync(new URL('./tablePreview.css', import.meta.url), 'utf8')
    expect(styles).toContain('overflow-x: auto')
    expect(styles).toContain('table-layout: auto')
    expect(styles).toContain('white-space: pre-wrap')
    expect(styles).not.toContain('min-height:')
    expect(styles).not.toContain('table-layout: fixed')
  })
})
