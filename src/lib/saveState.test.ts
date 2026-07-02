import { describe, expect, it } from 'vitest'
import type { Tab } from '../types'
import { completeSave } from './saveState'

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
    const result = completeSave(tab('new edit', 2), { content: 'disk snapshot', revision: 1 }, version)
    expect(result.savedContent).toBe('disk snapshot')
    expect(result.content).toBe('new edit')
    expect(result.dirty).toBe(true)
  })

  it('marks the exact saved revision clean', () => {
    expect(completeSave(tab('same', 2), { content: 'same', revision: 2 }, version).dirty).toBe(false)
  })
})
