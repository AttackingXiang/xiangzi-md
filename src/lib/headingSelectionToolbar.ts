import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { headingLevelFromState } from './editorCommands'

type Direction = 'promote' | 'demote'

function syncButton(
  root: HTMLElement,
  direction: Direction,
  level: number | null,
): HTMLButtonElement | null {
  const icon = root.querySelector<SVGElement>(`[data-heading-shift="${direction}"]`)
  const button = icon?.closest<HTMLButtonElement>('button') ?? null
  if (!button) return null

  const unavailable = level === null || (direction === 'promote' ? level <= 1 : level >= 6)
  button.hidden = level === null
  button.disabled = unavailable
  button.setAttribute('aria-disabled', String(unavailable))
  return button
}

/** Keep Crepe's static toolbar extension in sync with the live heading selection. */
export function syncHeadingSelectionToolbar(root: HTMLElement, state: EditorState): void {
  const level = headingLevelFromState(state)
  const promote = syncButton(root, 'promote', level)
  syncButton(root, 'demote', level)

  const divider = promote?.previousElementSibling
  if (divider?.classList.contains('divider')) (divider as HTMLElement).hidden = level === null
}

export const headingSelectionToolbarPlugin = $prose(
  () =>
    new Plugin({
      key: new PluginKey('xmd-heading-selection-toolbar'),
      view(view: EditorView) {
        let frame: number | null = null
        const root = view.dom.closest<HTMLElement>('.editor-scroll') ?? view.dom.parentElement
        const schedule = (nextView: EditorView): void => {
          if (frame !== null) cancelAnimationFrame(frame)
          frame = requestAnimationFrame(() => {
            frame = null
            if (root) syncHeadingSelectionToolbar(root, nextView.state)
          })
        }
        schedule(view)
        return {
          update: schedule,
          destroy() {
            if (frame !== null) cancelAnimationFrame(frame)
          },
        }
      },
    }),
)
