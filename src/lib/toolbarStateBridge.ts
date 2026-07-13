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
let _listener: Listener | null = null
let _lastState: ToolbarActiveState = DEFAULT_TOOLBAR_ACTIVE_STATE

export const toolbarStateBridge = {
  setListener(fn: Listener | null): void {
    _listener = fn
    if (fn) fn(_lastState)
  },
  notify(state: ToolbarActiveState): void {
    _lastState = state
    _listener?.(state)
  },
  reset(): void {
    _lastState = DEFAULT_TOOLBAR_ACTIVE_STATE
    _listener?.(DEFAULT_TOOLBAR_ACTIVE_STATE)
  },
}
