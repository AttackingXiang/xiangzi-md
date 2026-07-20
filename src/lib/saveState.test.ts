import { describe, expect, it } from 'vitest'
import type { Tab } from '../types'
import {
  completePersistedTransform,
  completeSave,
  markExternalUnavailable,
  reconcileExternalRead,
  updateTabContent,
} from './saveState'

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

describe('external disk reconciliation', () => {
  const baseVersion = { sizeBytes: 4, modifiedNanos: 1, contentHash: 'base' }
  const diskVersion = { sizeBytes: 8, modifiedNanos: 2, contentHash: 'external' }
  const diskFile = {
    path: '/notes/a.md',
    name: 'a.md',
    content: 'external',
    version: diskVersion,
  }

  it('automatically reloads a clean tab and advances its disk baseline', () => {
    const current = {
      ...tab('base', 3),
      savedContent: 'base',
      dirty: false,
      version: baseVersion,
    }
    const result = reconcileExternalRead(current, diskFile)
    expect(result.outcome).toBe('reloaded')
    expect(result.tab).toMatchObject({
      content: 'external',
      savedContent: 'external',
      dirty: false,
      revision: 4,
      version: diskVersion,
    })
  })

  it('keeps unsaved editor content and stores the external snapshot as a conflict', () => {
    const current = {
      ...tab('my edit', 5),
      savedContent: 'base',
      version: baseVersion,
    }
    const result = reconcileExternalRead(current, diskFile)
    expect(result.outcome).toBe('conflict')
    expect(result.tab).toMatchObject({
      content: 'my edit',
      savedContent: 'base',
      dirty: true,
      version: baseVersion,
      diskState: { kind: 'changed', snapshot: diskFile },
    })
  })

  it('clears a stale warning when disk content matches the known version again', () => {
    const current = {
      ...tab('my edit', 5),
      savedContent: 'base',
      version: baseVersion,
      diskState: { kind: 'changed' as const, snapshot: diskFile },
    }
    const originalFile = { ...diskFile, content: 'base', version: baseVersion }
    const result = reconcileExternalRead(current, originalFile)
    expect(result.outcome).toBe('unchanged')
    expect(result.tab.content).toBe('my edit')
    expect(result.tab.diskState).toBeUndefined()
  })

  it('marks an unavailable file without modifying its editor content', () => {
    const current = tab('my edit', 5)
    expect(markExternalUnavailable(current, 123)).toMatchObject({
      content: 'my edit',
      dirty: true,
      diskState: { kind: 'unavailable', detectedAt: 123 },
    })
  })
})
