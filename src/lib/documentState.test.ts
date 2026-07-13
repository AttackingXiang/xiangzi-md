import { describe, expect, it } from 'vitest'
import type { Tab } from '../types'
import { activateOrAppendTab, mergeRestoredTabs, tabsAreClean } from './documentState'

function tab(id: string, path: string, content = id): Tab {
  return {
    id,
    path,
    name: path.split('/').at(-1) ?? path,
    content,
    savedContent: content,
    dirty: false,
    revision: 0,
    version: null,
  }
}

describe('document tab lifecycle', () => {
  it('activates the existing tab when the same path is opened again', () => {
    const current = [tab('existing', '/notes/a.md')]
    const result = activateOrAppendTab(current, tab('duplicate', '/notes/a.md'))
    expect(result.tabs).toBe(current)
    expect(result.activeId).toBe('existing')
  })

  it('appends a genuinely new path exactly once', () => {
    const current = [tab('a', '/notes/a.md')]
    const first = activateOrAppendTab(current, tab('b', '/notes/b.md'))
    const repeated = activateOrAppendTab(first.tabs, tab('b-again', '/notes/b.md'))
    expect(first.tabs.map((item) => item.id)).toEqual(['a', 'b'])
    expect(repeated.tabs).toBe(first.tabs)
    expect(repeated.activeId).toBe('b')
  })

  it('does not duplicate a user-opened path when session restoration finishes later', () => {
    const userOpened = [tab('user', '/notes/a.md', 'newer memory')]
    const result = mergeRestoredTabs(
      userOpened,
      [tab('restored-a', '/notes/a.md', 'stale read'), tab('restored-b', '/notes/b.md')],
      '/notes/a.md',
      null,
    )
    expect(result.tabs.map((item) => [item.id, item.content])).toEqual([
      ['user', 'newer memory'],
      ['restored-b', 'restored-b'],
    ])
    expect(result.activeId).toBe('user')
  })

  it('deduplicates corrupt repeated session paths and preserves a valid active tab', () => {
    const current = [tab('current', '/notes/current.md')]
    const result = mergeRestoredTabs(
      current,
      [tab('a1', '/notes/a.md'), tab('a2', '/notes/a.md')],
      '/notes/a.md',
      'current',
    )
    expect(result.tabs.map((item) => item.id)).toEqual(['current', 'a1'])
    expect(result.activeId).toBe('current')
  })

  it('blocks close or quit when an edit remains after the requested saves finish', () => {
    const clean = tab('clean', '/notes/a.md')
    const dirty = { ...tab('dirty', '/notes/b.md'), content: 'new', dirty: true }
    expect(tabsAreClean([clean, dirty], new Set(['clean']))).toBe(true)
    expect(tabsAreClean([clean, dirty], new Set(['clean', 'dirty']))).toBe(false)
  })
})
