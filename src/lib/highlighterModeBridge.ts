export interface HighlighterModeState {
  active: boolean
  color: string
}

type Listener = (state: HighlighterModeState) => void

let state: HighlighterModeState = { active: false, color: '#fde047' }
const listeners = new Set<Listener>()
let lastKnownDefaultColor: string | null = null

function publish(next: HighlighterModeState): void {
  if (state.active === next.active && state.color === next.color) return
  state = next
  for (const listener of [...listeners]) listener(state)
}

/** Shared, document-agnostic state for the pointer-driven highlighter tool. */
export const highlighterModeBridge = {
  getState(): HighlighterModeState {
    return state
  },

  activate(): void {
    publish({ ...state, active: true })
  },

  deactivate(): void {
    publish({ ...state, active: false })
  },

  toggle(): void {
    publish({ ...state, active: !state.active })
  },

  selectColor(color: string, activate = true): void {
    publish({ active: activate ? true : state.active, color })
  },

  /**
   * Seeds/refreshes the color from the user's settings default. Unlike
   * selectColor, this only takes effect while the current color still
   * matches the previously known default, so it won't clobber a color the
   * user actively picked in this session — including across remounts of
   * the component that calls it (e.g. toggling source/reading mode).
   */
  syncDefaultColor(defaultColor: string): void {
    const followsDefault = lastKnownDefaultColor === null || state.color === lastKnownDefaultColor
    lastKnownDefaultColor = defaultColor
    if (followsDefault) {
      publish({ ...state, color: defaultColor })
    }
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(state)
    return () => listeners.delete(listener)
  },
}
