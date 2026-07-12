import { useEffect } from 'react'
import {
  SHORTCUT_DEFINITIONS,
  effectiveShortcut,
  effectiveShortcutMap,
  shortcutFromKeyboardEvent,
  type ShortcutAction,
} from '../lib/shortcuts'

export function useAppShortcuts(
  overrides: Record<string, string>,
  dispatch: (action: ShortcutAction) => void,
): void {
  useEffect(() => {
    const activeBindings = effectiveShortcutMap(overrides)
    const replacedDefaults = new Set(
      SHORTCUT_DEFINITIONS.filter(
        (definition) => effectiveShortcut(overrides, definition.id) !== definition.defaultBinding,
      ).map((definition) => definition.defaultBinding),
    )

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing || event.repeat) return
      if (event.target instanceof Element && event.target.closest('[data-shortcut-recorder]'))
        return
      const binding = shortcutFromKeyboardEvent(event)
      if (!binding) return
      const action = activeBindings.get(binding)
      if (action) {
        event.preventDefault()
        event.stopPropagation()
        dispatch(action)
        return
      }
      // A changed shortcut must also disable its old binding before Milkdown or
      // a browser default sees it.
      if (replacedDefaults.has(binding)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dispatch, overrides])
}
