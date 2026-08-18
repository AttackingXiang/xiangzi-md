// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { readTableCellContent, setTableCellContent } from './tablePreview'

describe('table cell content DOM bridge', () => {
  it('drops browser filler breaks from empty cells but preserves authored breaks', () => {
    const cell = document.createElement('td')

    setTableCellContent(cell, '')
    cell.append(document.createElement('br'))
    expect(readTableCellContent(cell)).toBe('')

    setTableCellContent(cell, 'first<br>second')
    expect(readTableCellContent(cell)).toBe('first<br>second')

    setTableCellContent(cell, '<br>')
    expect(readTableCellContent(cell)).toBe('<br>')
  })
})
