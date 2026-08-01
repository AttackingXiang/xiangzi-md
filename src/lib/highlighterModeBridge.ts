import { createStateBridge } from './bridgeFactory'

export interface HighlighterModeState {
  active: boolean
  color: string
}

const bridge = createStateBridge<HighlighterModeState>(
  { active: false, color: '#fde047' },
  { isEqual: (a, b) => a.active === b.active && a.color === b.color },
)

let lastKnownDefaultColor: string | null = null

/** Shared, document-agnostic state for the pointer-driven highlighter tool. */
export const highlighterModeBridge = {
  getState: bridge.getState,

  activate(): void {
    bridge.setState({ ...bridge.getState(), active: true })
  },

  deactivate(): void {
    bridge.setState({ ...bridge.getState(), active: false })
  },

  toggle(): void {
    const state = bridge.getState()
    bridge.setState({ ...state, active: !state.active })
  },

  selectColor(color: string, activate = true): void {
    bridge.setState({ active: activate, color })
  },

  /**
   * Seeds/refreshes the color from the user's settings default. Unlike
   * selectColor, this only takes effect while the current color still
   * matches the previously known default, so it won't clobber a color the
   * user actively picked in this session — including across remounts of
   * the component that calls it (e.g. toggling source/reading mode).
   */
  syncDefaultColor(defaultColor: string): void {
    const state = bridge.getState()
    const followsDefault = lastKnownDefaultColor === null || state.color === lastKnownDefaultColor
    lastKnownDefaultColor = defaultColor
    if (followsDefault) {
      bridge.setState({ ...state, color: defaultColor })
    }
  },

  subscribe: bridge.subscribe,

  /** Drops all subscribers and restores defaults. For tests only. */
  reset(): void {
    bridge.reset()
    lastKnownDefaultColor = null
  },
}
