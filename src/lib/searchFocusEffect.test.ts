import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEARCH_FOCUS_EFFECT,
  normalizeSearchFocusEffect,
  SEARCH_FOCUS_EFFECT_PRESETS,
} from './searchFocusEffect'

describe('search focus effect presets', () => {
  it('keeps a small, explicit set of themeable presets', () => {
    expect(Object.keys(SEARCH_FOCUS_EFFECT_PRESETS)).toEqual([
      'off',
      'sparkle',
      'ring',
      'confetti',
      'shatter',
    ])
    expect(SEARCH_FOCUS_EFFECT_PRESETS.confetti.animation).toBe('xmd-focus-confetti')
    expect(SEARCH_FOCUS_EFFECT_PRESETS.confetti.duration).toBe('1100ms')
  })

  it('falls back safely for old or invalid settings', () => {
    expect(normalizeSearchFocusEffect(undefined)).toBe(DEFAULT_SEARCH_FOCUS_EFFECT)
    expect(normalizeSearchFocusEffect('not-a-preset')).toBe(DEFAULT_SEARCH_FOCUS_EFFECT)
    expect(normalizeSearchFocusEffect('confetti')).toBe('confetti')
  })
})
