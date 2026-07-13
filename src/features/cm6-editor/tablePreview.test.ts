import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import {
  findVisibleMarkdownTables,
  parseMarkdownTable,
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
})
