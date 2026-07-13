import { describe, expect, it } from 'vitest'
import { normalizeLinkHref, shiftedHeadingLevel } from './editorCommands'

describe('CM6 editor command adapter', () => {
  it('clamps heading promotion and demotion', () => {
    expect(shiftedHeadingLevel(3, 'promote')).toBe(2)
    expect(shiftedHeadingLevel(3, 'demote')).toBe(4)
    expect(shiftedHeadingLevel(1, 'promote')).toBe(1)
    expect(shiftedHeadingLevel(6, 'demote')).toBe(6)
  })

  it('normalizes safe links and rejects executable protocols', () => {
    expect(normalizeLinkHref('example.com')).toBe('https://example.com')
    expect(normalizeLinkHref('mailto:test@example.com')).toBe('mailto:test@example.com')
    expect(normalizeLinkHref(' javascript:alert(1) ')).toBeNull()
    expect(normalizeLinkHref('data:text/html,test')).toBeNull()
    expect(normalizeLinkHref('   ')).toBeNull()
  })
})
