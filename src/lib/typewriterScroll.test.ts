import { describe, expect, it } from 'vitest'
import { typewriterScrollDelta } from './typewriterScroll'

describe('typewriterScrollDelta', () => {
  it('does not auto-scroll while the user is selecting text backwards or forwards', () => {
    expect(
      typewriterScrollDelta(false, false, { top: 720, height: 24 }, { top: 100, height: 600 }),
    ).toBeNull()
  })

  it('does not jump when a pointer drag has started but the selection is still collapsed', () => {
    expect(
      typewriterScrollDelta(true, true, { top: 720, height: 24 }, { top: 100, height: 600 }),
    ).toBeNull()
  })

  it('centers a collapsed caret in typewriter mode', () => {
    expect(
      typewriterScrollDelta(true, false, { top: 720, height: 24 }, { top: 100, height: 600 }),
    ).toBe(332)
  })

  it('ignores empty browser ranges and tiny movements', () => {
    expect(
      typewriterScrollDelta(true, false, { top: 0, height: 0 }, { top: 0, height: 600 }),
    ).toBeNull()
    expect(
      typewriterScrollDelta(true, false, { top: 399, height: 2 }, { top: 100, height: 600 }),
    ).toBeNull()
  })
})
