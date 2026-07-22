import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SHORTCUT_DEFINITIONS,
  effectiveShortcut,
  effectiveShortcutMap,
  isSafeShortcut,
  shortcutHint,
  shortcutFromKeyboardEvent,
} from './shortcuts'

function stubMac(): void {
  vi.stubGlobal('navigator', { platform: 'MacIntel' })
}

/** A minimal stand-in — `shortcutFromKeyboardEvent` only reads these fields. */
function keyEvent(fields: {
  code: string
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...fields,
  } as KeyboardEvent
}

describe('keyboard shortcuts', () => {
  afterEach(() => vi.unstubAllGlobals())

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

  it('exposes distinct configurable heading-level shortcuts', () => {
    expect(effectiveShortcut({}, 'promote-heading')).toBe('Mod+Alt+ArrowUp')
    expect(effectiveShortcut({}, 'demote-heading')).toBe('Mod+Alt+ArrowDown')
    const bindings = SHORTCUT_DEFINITIONS.map((definition) => definition.defaultBinding)
    expect(new Set(bindings).size).toBe(bindings.length)
  })

  it('formats tooltip hints for macOS and Windows', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    expect(shortcutHint('Mod+Shift+K')).toBe('⌘⇧K')
    vi.stubGlobal('navigator', { platform: 'Win32' })
    expect(shortcutHint('Mod+Shift+K')).toBe('Ctrl+Shift+K')
  })
})

describe('shortcutFromKeyboardEvent', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('records the plain modifier+letter case', () => {
    stubMac()
    expect(shortcutFromKeyboardEvent(keyEvent({ code: 'KeyB', key: 'b', metaKey: true }))).toBe(
      'Mod+B',
    )
  })

  it('reads the unshifted physical key for Shift+punctuation instead of the OS-composed symbol', () => {
    stubMac()
    // A real Shift+/ keydown reports `key: "?"`; recording that literally
    // would make `isSafeShortcut` reject it (its charset only covers the
    // unshifted punctuation), silently blocking the whole combo.
    expect(
      shortcutFromKeyboardEvent(
        keyEvent({ code: 'Slash', key: '?', metaKey: true, shiftKey: true }),
      ),
    ).toBe('Mod+Shift+/')
  })

  it('reads the unshifted digit for Shift+digit instead of the OS-composed symbol', () => {
    stubMac()
    expect(
      shortcutFromKeyboardEvent(
        keyEvent({ code: 'Digit1', key: '!', metaKey: true, shiftKey: true }),
      ),
    ).toBe('Mod+Shift+1')
  })

  it('reads the physical key for a Mac Option-only combo instead of the composed accent character', () => {
    stubMac()
    // Option+S alone reports `key: "ß"` on macOS (Cmd held would suppress
    // this composition, but a bare Alt-only binding is allowed by
    // isSafeShortcut, so it must still be recordable).
    expect(shortcutFromKeyboardEvent(keyEvent({ code: 'KeyS', key: 'ß', altKey: true }))).toBe(
      'Alt+S',
    )
  })

  it('every combo it can produce for a letter/digit/punctuation key passes isSafeShortcut', () => {
    stubMac()
    const codes = ['KeyK', 'Digit5', 'Comma', 'Slash', 'BracketLeft']
    for (const code of codes) {
      const binding = shortcutFromKeyboardEvent(
        keyEvent({ code, key: code, metaKey: true, shiftKey: true }),
      )
      expect(binding).not.toBeNull()
      expect(isSafeShortcut(binding!)).toBe(true)
    }
  })
})
