import { beforeEach, describe, expect, it } from 'vitest'
import {
  isTypeaheadKey,
  nextTypeaheadIndex,
  pushTypeaheadChar,
  resetTypeahead,
} from './treeTypeahead'

const names = ['alpha.md', 'assets', 'beta.md', 'archive', 'notes.md']

beforeEach(resetTypeahead)

describe('nextTypeaheadIndex', () => {
  it('jumps to the next item starting with the letter, wrapping around', () => {
    expect(nextTypeaheadIndex(names, 0, 'a')).toBe(1)
    expect(nextTypeaheadIndex(names, 1, 'a')).toBe(3)
    expect(nextTypeaheadIndex(names, 3, 'a')).toBe(0)
  })

  it('cycles when the same letter is pressed repeatedly', () => {
    // 连按 a 应该在 a 开头的条目之间循环，而不是去找名叫 "aa" 的文件。
    expect(nextTypeaheadIndex(names, 0, 'aa')).toBe(1)
    expect(nextTypeaheadIndex(names, 1, 'aaa')).toBe(3)
  })

  it('lets a multi-character query match the current row', () => {
    // 打 "a" 停在 assets，再打 "s" 变成 "as" —— 不能因为要求"下一项"而跳过它。
    expect(nextTypeaheadIndex(names, 1, 'as')).toBe(1)
  })

  it('returns null when nothing matches', () => {
    expect(nextTypeaheadIndex(names, 0, 'zz')).toBeNull()
    expect(nextTypeaheadIndex(names, 0, '')).toBeNull()
  })
})

describe('pushTypeaheadChar', () => {
  it('accumulates characters typed in quick succession', () => {
    expect(pushTypeaheadChar('D', 1000)).toBe('d')
    expect(pushTypeaheadChar('o', 1100)).toBe('do')
    expect(pushTypeaheadChar('C', 1200)).toBe('doc')
  })

  it('starts over after a pause', () => {
    pushTypeaheadChar('a', 1000)
    expect(pushTypeaheadChar('b', 5000)).toBe('b')
  })
})

describe('isTypeaheadKey', () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false }

  it('accepts plain printable characters', () => {
    expect(isTypeaheadKey({ ...base, key: 'a' })).toBe(true)
    expect(isTypeaheadKey({ ...base, key: '7' })).toBe(true)
  })

  it('ignores modifiers, space, and named keys', () => {
    expect(isTypeaheadKey({ ...base, key: 'a', metaKey: true })).toBe(false)
    expect(isTypeaheadKey({ ...base, key: ' ' })).toBe(false)
    expect(isTypeaheadKey({ ...base, key: 'ArrowDown' })).toBe(false)
  })
})
