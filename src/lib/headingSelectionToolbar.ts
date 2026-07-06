import { $prose } from '@milkdown/kit/utils'
import type { ResolvedPos } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { headingLevelFromState } from './editorCommands'

type Direction = 'promote' | 'demote'

function selectionTouchesCodeBlock(state: EditorState): boolean {
  const { selection } = state
  const isInsideCodeBlock = ($pos: ResolvedPos): boolean => {
    for (let current = $pos.depth; current > 0; current -= 1) {
      if ($pos.node(current).type.name === 'code_block') return true
    }
    return false
  }

  if (isInsideCodeBlock(selection.$from) || isInsideCodeBlock(selection.$to)) return true

  let touchesCodeBlock = false
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.type.name === 'code_block') touchesCodeBlock = true
    return !touchesCodeBlock
  })
  return touchesCodeBlock
}

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
  const toolbar = root.querySelector<HTMLElement>('.milkdown-toolbar')
  if (toolbar) {
    const hideForCodeBlock = selectionTouchesCodeBlock(state)
    toolbar.hidden = hideForCodeBlock
    // Crepe declares an explicit display mode for the toolbar, which can win
    // over the browser's built-in `[hidden]` rule. An inline important value
    // guarantees that code selections stay clear; remove it for normal text so
    // Crepe remains responsible for showing and positioning the toolbar.
    if (hideForCodeBlock) toolbar.style.setProperty('display', 'none', 'important')
    else toolbar.style.removeProperty('display')
  }

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
