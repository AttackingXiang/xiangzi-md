import { describe, expect, it } from 'vitest'
import {
  deleteColumnAt,
  insertColumnAt,
  moveRowAt,
  serializeTableData,
  type TableData,
} from './tableModel'

const data: TableData = {
  header: ['Name', 'Value'],
  alignments: ['left', 'right'],
  rows: [
    ['A', '1'],
    ['B', '2'],
  ],
}

describe('tableModel', () => {
  it('keeps header, alignment and body columns in lockstep', () => {
    const inserted = insertColumnAt(data, 1)
    expect(inserted).toMatchObject({
      header: ['Name', '', 'Value'],
      alignments: ['left', null, 'right'],
      rows: [
        ['A', '', '1'],
        ['B', '', '2'],
      ],
    })
    expect(deleteColumnAt(inserted, 1)).toEqual(data)
  })

  it('serializes escaped pipes and reordered rows without DOM or CM6', () => {
    const moved = moveRowAt({ ...data, header: ['A|B', 'Value'] }, 1, 0)
    expect(serializeTableData(moved)).toBe(
      ['| A\\|B | Value |', '| :---- | ----: |', '| B | 2 |', '| A | 1 |'].join('\n'),
    )
  })
})
