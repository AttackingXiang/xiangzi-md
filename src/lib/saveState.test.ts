import { describe, expect, it } from 'vitest'
import type { Tab } from '../types'
import { completePersistedTransform, completeSave, updateTabContent } from './saveState'

const version = { sizeBytes: 3, modifiedNanos: 1, contentHash: 'hash' }

function tab(content: string, revision: number): Tab {
  return {
    id: 'tab',
    path: '/notes/a.md',
    name: 'a.md',
    content,
    savedContent: '',
    dirty: true,
    revision,
    version: null,
  }
}

describe('save completion', () => {
  it('keeps edits made during I/O dirty while advancing the saved baseline', () => {
    const result = completeSave(
      tab('new edit', 2),
      { content: 'disk snapshot', revision: 1 },
      version,
    )
    expect(result.savedContent).toBe('disk snapshot')
    expect(result.content).toBe('new edit')
    expect(result.dirty).toBe(true)
  })

  it('marks the exact saved revision clean', () => {
    expect(completeSave(tab('same', 2), { content: 'same', revision: 2 }, version).dirty).toBe(
      false,
    )
  })

  it('marks edit-then-undo during I/O clean when the saved bytes match', () => {
    const result = completeSave(tab('same', 9), { content: 'same', revision: 2 }, version)
    expect(result.savedContent).toBe('same')
    expect(result.dirty).toBe(false)
  })

  it('derives dirty state from the saved content when editor transactions update a tab', () => {
    const saved = { ...tab('saved', 4), savedContent: 'saved', dirty: false }
    const changed = updateTabContent(saved, 'changed')
    expect(changed).toMatchObject({ content: 'changed', revision: 5, dirty: true })
    expect(updateTabContent(changed, 'saved')).toMatchObject({
      content: 'saved',
      revision: 6,
      dirty: false,
    })
  })

  it('does not overwrite an edit made while a direct disk transform is pending', () => {
    const current = { ...tab('user edit', 7), savedContent: 'base' }
    const result = completePersistedTransform(current, 'base', 'renamed tag', version)
    expect(result).toMatchObject({
      content: 'user edit',
      savedContent: 'renamed tag',
      revision: 7,
      dirty: true,
      version,
    })
  })

  it('adopts a direct disk transform when the open tab still matches its base', () => {
    const current = { ...tab('base', 3), savedContent: 'base' }
    const result = completePersistedTransform(current, 'base', 'renamed tag', version)
    expect(result).toMatchObject({
      content: 'renamed tag',
      savedContent: 'renamed tag',
      revision: 4,
      dirty: false,
      version,
    })
  })
})
