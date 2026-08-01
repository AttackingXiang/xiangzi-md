import { createStateBridge } from './bridgeFactory'

export interface ToolbarActiveState {
  bold: boolean
  italic: boolean
  strike: boolean
  inlineCode: boolean
  link: boolean
  headingLevel: number | null // 1-6 or null
  blockquote: boolean
  codeBlock: boolean
  bulletList: boolean
  orderedList: boolean
  taskList: boolean
  canUndo: boolean
  canRedo: boolean
}

export const DEFAULT_TOOLBAR_ACTIVE_STATE: ToolbarActiveState = {
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  link: false,
  headingLevel: null,
  blockquote: false,
  codeBlock: false,
  bulletList: false,
  orderedList: false,
  taskList: false,
  canUndo: false,
  canRedo: false,
}

type Listener = (state: ToolbarActiveState) => void

const bridge = createStateBridge<ToolbarActiveState>(DEFAULT_TOOLBAR_ACTIVE_STATE)

// Only one consumer (the toolbar) ever holds this slot, and it replaces
// wholesale rather than adding a subscriber — mirror that on top of the
// (multi-subscriber) shared store instead of exposing bridge.subscribe raw.
let unsubscribe: (() => void) | null = null

export const toolbarStateBridge = {
  setListener(fn: Listener | null): void {
    unsubscribe?.()
    unsubscribe = fn ? bridge.subscribe(fn) : null
  },
  notify(state: ToolbarActiveState): void {
    bridge.setState(state)
  },
  // Domain reset (editor went away, blank out the toolbar) — not the same as
  // test hygiene, so it deliberately doesn't touch the listener slot above.
  // setListener(null) already gives tests the same teardown production uses.
  reset(): void {
    bridge.setState(DEFAULT_TOOLBAR_ACTIVE_STATE)
  },
}
