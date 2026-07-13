import { ChangeSet } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { applyChangeSetToString } from './applyChangeSet'

describe('applyChangeSetToString', () => {
  it('applies multiple disjoint changes in old-document coordinates', () => {
    const changes = ChangeSet.of(
      [
        { from: 1, to: 2, insert: 'X' },
        { from: 4, to: 5, insert: 'YZ' },
      ],
      6,
    )
    expect(applyChangeSetToString('abcdef', changes)).toBe('aXcdYZf')
  })

  it('uses CodeMirror UTF-16 positions for Chinese text', () => {
    const source = '你好，世界'
    const changes = ChangeSet.of([{ from: 2, to: 3, insert: '！' }], source.length)
    expect(applyChangeSetToString(source, changes)).toBe('你好！世界')
  })

  it('supports deletion and insertion at document boundaries', () => {
    const deletion = ChangeSet.of([{ from: 0, to: 3 }], 6)
    expect(applyChangeSetToString('abcdef', deletion)).toBe('def')
    const insertion = ChangeSet.of([{ from: 3, insert: '末尾' }], 3)
    expect(applyChangeSetToString('abc', insertion)).toBe('abc末尾')
  })

  it('returns the same string for an empty ChangeSet', () => {
    const source = 'unchanged'
    expect(applyChangeSetToString(source, ChangeSet.empty(source.length))).toBe(source)
  })

  it('rejects a stale mirror instead of silently corrupting content', () => {
    const changes = ChangeSet.of([{ from: 1, insert: 'x' }], 2)
    expect(() => applyChangeSetToString('stale', changes)).toThrow(RangeError)
  })
})
