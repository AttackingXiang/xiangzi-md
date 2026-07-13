import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  deleteColumnAt,
  findVisibleMarkdownTables,
  insertColumnAt,
  insertRowAt,
  moveColumnAt,
  moveRowAt,
  normalizeTableCellBreaks,
  parseTableCellInline,
  parseMarkdownTable,
  serializeTableCellInline,
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
  it('keeps table layout content-driven while containing horizontal overflow', () => {
    const styles = readFileSync(new URL('./tablePreview.css', import.meta.url), 'utf8')
    expect(styles).toContain('overflow-x: auto')
    expect(styles).toContain('table-layout: auto')
    expect(styles).toContain('white-space: pre-wrap')
    expect(styles).not.toContain('min-height:')
    expect(styles).not.toContain('table-layout: fixed')
  })
})
