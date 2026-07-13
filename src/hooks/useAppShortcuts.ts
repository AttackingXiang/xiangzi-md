import { useEffect } from 'react'
import {
  SHORTCUT_DEFINITIONS,
  effectiveShortcut,
  effectiveShortcutMap,
  shortcutFromKeyboardEvent,
  type ShortcutAction,
} from '../lib/shortcuts'
import { tableCellCommandBridge, type TableCellInlineFormat } from '../lib/tableCellCommandBridge'

const TABLE_CELL_FORMAT_ACTIONS = new Set<ShortcutAction>(
  SHORTCUT_DEFINITIONS.filter(({ category }) => category === 'format').map(({ id }) => id),
)
const TABLE_CELL_INLINE_ACTIONS: Partial<Record<ShortcutAction, TableCellInlineFormat>> = {
  bold: 'bold',
  italic: 'italic',
  'inline-code': 'inlineCode',
}

export function isTableCellFormattingShortcut(action: ShortcutAction): boolean {
  return TABLE_CELL_FORMAT_ACTIONS.has(action)
}

export type TableCellShortcutRoute =
  | { kind: 'outer' }
  | { kind: 'native' }
  | { kind: 'blocked' }
  | { kind: 'inline'; format: TableCellInlineFormat }

export function routeTableCellShortcut(
  action: ShortcutAction,
  target: EventTarget | null,
): TableCellShortcutRoute {
  if (!tableCellCommandBridge.ownsTarget(target)) return { kind: 'outer' }
  if (action === 'select-all') return { kind: 'native' }
  if (!isTableCellFormattingShortcut(action)) return { kind: 'outer' }
  const format = TABLE_CELL_INLINE_ACTIONS[action]
  return format ? { kind: 'inline', format } : { kind: 'blocked' }
}

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
        const tableRoute = routeTableCellShortcut(action, event.target)
        if (tableRoute.kind !== 'outer') {
          if (tableRoute.kind === 'native') return
          if (tableRoute.kind === 'inline' || tableRoute.kind === 'blocked') {
            event.preventDefault()
            event.stopPropagation()
            if (tableRoute.kind === 'inline') tableCellCommandBridge.runInline(tableRoute.format)
            return
          }
        }
        if (action === 'select-all' && shouldDeferSelectAllToFocusedEditor(event.target)) return
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

/** Native/embedded editors own Cmd/Ctrl+A; the app shortcut is only a fallback. */
export function shouldDeferSelectAllToFocusedEditor(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('input, textarea')) return true
  const editable = target.closest('[contenteditable="true"]')
  if (!editable) return false
  const markdownRoot = target.closest('.xmd-cm-editor.is-live-preview')
  const markdownContent = target.closest(
    '.xmd-cm-editor.is-live-preview .cm-content[contenteditable="true"]',
  )
  // The outer Markdown CM6 is routed through clipboardCmd so fenced-code
  // select-all can stay block-local. Nested table cells and other editors keep
  // their native selection scope.
  return !markdownRoot || editable !== markdownContent
}
