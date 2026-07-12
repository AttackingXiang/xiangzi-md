import { describe, expect, it } from 'vitest'
import { canDropTreeItem, replaceMovedPath } from './treeDrag'

describe('treeDrag', () => {
  it('allows moving a file into a different folder', () => {
    expect(canDropTreeItem({ path: '/notes/a.md', isDir: false }, '/notes/archive')).toBe(true)
  })

  it('rejects no-op and cyclic folder drops on both path styles', () => {
    expect(canDropTreeItem({ path: '/notes/a.md', isDir: false }, '/notes')).toBe(false)
    expect(canDropTreeItem({ path: '/notes/work', isDir: true }, '/notes/work/drafts')).toBe(false)
    expect(
      canDropTreeItem({ path: 'C:\\Notes\\Work', isDir: true }, 'c:\\notes\\work\\drafts'),
    ).toBe(false)
  })

  it('updates open document paths after a folder move on Windows', () => {
    expect(
      replaceMovedPath('C:\\Notes\\Work\\draft.md', 'C:\\Notes\\Work', 'C:\\Notes\\Archive\\Work'),
    ).toBe('C:\\Notes\\Archive\\Work\\draft.md')
  })
})
