import { describe, expect, it } from 'vitest'
import { effectiveShortcut, effectiveShortcutMap, isSafeShortcut } from './shortcuts'

describe('keyboard shortcuts', () => {
  it('uses defaults until a user override is present', () => {
    expect(effectiveShortcut({}, 'save')).toBe('Mod+S')
    expect(effectiveShortcut({ save: 'Mod+Alt+S' }, 'save')).toBe('Mod+Alt+S')
  })

  it('indexes effective shortcuts by normalized binding', () => {
    const bindings = effectiveShortcutMap({ 'open-settings': 'Mod+Alt+,' })
    expect(bindings.get('Mod+Alt+,')).toBe('open-settings')
    expect(bindings.get('Mod+,')).toBeUndefined()
  })

  it('rejects bare keys and malformed combinations', () => {
    expect(isSafeShortcut('Mod+Shift+K')).toBe(true)
    expect(isSafeShortcut('Alt+F8')).toBe(true)
    expect(isSafeShortcut('K')).toBe(false)
    expect(isSafeShortcut('Shift+K')).toBe(false)
    expect(isSafeShortcut('Mod+')).toBe(false)
    expect(isSafeShortcut('Mod+NotAKey')).toBe(false)
  })
})
