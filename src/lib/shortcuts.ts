import shortcutsJson from '../../shared/shortcuts.json'

export type ShortcutCategory = 'file' | 'navigation' | 'format'

export type ShortcutAction =
  | 'new-file'
  | 'open-file'
  | 'open-folder'
  | 'save'
  | 'save-as'
  | 'close-tab'
  | 'find'
  | 'search-in-folder'
  | 'find-next'
  | 'find-previous'
  | 'select-all'
  | 'paste-plain'
  | 'command-palette'
  | 'toggle-sidebar'
  | 'toggle-outline'
  | 'toggle-source'
  | 'toggle-focus'
  | 'toggle-typewriter'
  | 'toggle-selection-toolbar'
  | 'toggle-toolbar'
  | 'toggle-reading'
  | 'open-settings'
  | 'show-shortcuts'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'paragraph'
  | 'promote-heading'
  | 'demote-heading'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inline-code'
  | 'insert-link'
  | 'quote'
  | 'code-block'
  | 'insert-table'
  | 'bullet-list'
  | 'ordered-list'
  | 'task-list'

export interface ShortcutDefinition {
  id: ShortcutAction
  category: ShortcutCategory
  labelZh: string
  labelEn: string
  defaultBinding: string
  macDefaultBinding?: string
}

export const SHORTCUT_DEFINITIONS: readonly ShortcutDefinition[] = (
  shortcutsJson as { shortcuts: ShortcutDefinition[] }
).shortcuts

const definitionById = new Map(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition]),
)

export function isShortcutAction(value: string): value is ShortcutAction {
  return definitionById.has(value as ShortcutAction)
}

export function effectiveShortcut(
  overrides: Record<string, string>,
  action: ShortcutAction,
): string {
  const definition = definitionById.get(action)
  return overrides[action] || defaultShortcutBinding(definition)
}

export function defaultShortcutBinding(definition: ShortcutDefinition | undefined): string {
  if (!definition) return ''
  return /mac/i.test(navigator.platform) && definition.macDefaultBinding
    ? definition.macDefaultBinding
    : definition.defaultBinding
}

export function effectiveShortcutMap(
  overrides: Record<string, string>,
): Map<string, ShortcutAction> {
  const result = new Map<string, ShortcutAction>()
  for (const definition of SHORTCUT_DEFINITIONS) {
    const binding = effectiveShortcut(overrides, definition.id)
    if (binding) result.set(binding, definition.id)
  }
  return result
}

function normalizedKey(key: string): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  const aliases: Record<string, string> = {
    Esc: 'Escape',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
  }
  return aliases[key] || key
}

/** `event.code` values for the unshifted punctuation `isSafeShortcut` accepts. */
const PUNCTUATION_CODES: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Equal: '=',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Backquote: '`',
}

/**
 * The physical key (`event.code`), immune to OS/layout composition —
 * `event.key` already reflects what Shift or (on macOS, with no Cmd held)
 * Option turns a key into: Shift+/ reports key `"?"`, and Option+S alone
 * reports `"ß"`. Recording the base key from the physical position instead
 * means the same physical combo is always recorded and matched consistently
 * regardless of what the layout composed, and keeps every Shift/Option
 * combination within `isSafeShortcut`'s existing unshifted charset instead
 * of silently rejecting about half of them.
 */
function baseKeyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  return PUNCTUATION_CODES[code] ?? null
}

export function shortcutFromKeyboardEvent(
  event: KeyboardEvent | React.KeyboardEvent,
): string | null {
  const key = baseKeyFromCode(event.code) ?? normalizedKey(event.key)
  if (!key) return null
  const parts: string[] = []
  const isMac = /mac/i.test(navigator.platform)
  if ((isMac && event.metaKey) || (!isMac && event.ctrlKey)) parts.push('Mod')
  if ((isMac && event.ctrlKey) || (!isMac && event.metaKey)) parts.push('Control')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

export function isSafeShortcut(binding: string): boolean {
  if (!binding || binding.length > 64) return false
  const parts = binding.split('+')
  if (parts.some((part) => !part)) return false
  const key = parts.at(-1) ?? ''
  const modifiers = new Set(parts.slice(0, -1))
  if ([...modifiers].some((part) => !['Mod', 'Control', 'Alt', 'Shift'].includes(part)))
    return false
  const functionKey = /^F([1-9]|1[0-2])$/.test(key)
  if (!functionKey && !modifiers.has('Mod') && !modifiers.has('Control') && !modifiers.has('Alt'))
    return false
  return /^[A-Z0-9]$|^[,./;='`\[\]\\-]$|^(Space|Enter|Escape|Tab|Backspace|Delete|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-2]))$/.test(
    key,
  )
}

export function displayShortcut(binding: string): string[] {
  const isMac = /mac/i.test(navigator.platform)
  const display: Record<string, string> = isMac
    ? {
        Mod: '⌘',
        Control: '⌃',
        Alt: '⌥',
        Shift: '⇧',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
      }
    : {
        Mod: 'Ctrl',
        Control: 'Win',
        Alt: 'Alt',
        Shift: 'Shift',
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
      }
  return binding.split('+').map((part) => display[part] || part)
}

/** Compact, platform-correct shortcut text for tooltips and context menus. */
export function shortcutHint(binding: string): string {
  const parts = displayShortcut(binding)
  return /mac/i.test(navigator.platform) ? parts.join('') : parts.join('+')
}
