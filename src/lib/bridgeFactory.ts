/**
 * CM6 widgets render outside the React tree, so several features reach across
 * that boundary with a hand-rolled module-level pub/sub singleton ("bridge").
 * They fall into two recurring shapes:
 *
 * - request/response: the CM6 side calls a single handler that the React side
 *   installs while mounted (table picker, link prompt, table zoom, ...).
 * - observable state: the CM6 side publishes a value that any number of React
 *   subscribers read (highlighter mode, toolbar active state, ...).
 *
 * Bridges with extra shape (an owned resource, a rich state object with
 * commands, or logic that just happens to route through a singleton) are left
 * hand-written on purpose — forcing them through one of these factories would
 * hide, not remove, their real complexity.
 */

/** A handler registered by the React side of a request/response bridge. */
type RequestHandler<Args extends unknown[]> = (...args: Args) => void

export interface RequestBridge<Args extends unknown[]> {
  /** Installs (or, passing null, uninstalls) the handler that serves requests. */
  setHandler(this: void, handler: RequestHandler<Args> | null): void
  /** Fires a request. Silently dropped if no handler is registered (warns in dev). */
  request(this: void, ...args: Args): void
  /** Clears the handler. For tests only — production code unregisters via setHandler(null). */
  reset(this: void): void
}

/**
 * Creates a single-handler request/response bridge. `name` only shows up in
 * the dev-mode warning, to say which bridge dropped a call.
 *
 * Methods are declared `this: void` (rather than relying on `this`) so a
 * bridge module can re-export them directly — e.g. `openSearch: bridge.request`
 * — without eslint's unbound-method rule flagging the detached reference.
 */
export function createRequestBridge<Args extends unknown[]>(name: string): RequestBridge<Args> {
  let handler: RequestHandler<Args> | null = null

  return {
    setHandler(next: RequestHandler<Args> | null): void {
      handler = next
    },
    request(...args: Args): void {
      if (!handler) {
        // A silent drop here is a registration-order race (the CM6 widget fired
        // before/after its React owner was mounted) with no other diagnostics.
        if (import.meta.env.DEV) {
          console.warn(`[${name}] request() called with no handler registered`)
        }
        return
      }
      handler(...args)
    },
    reset(): void {
      handler = null
    },
  }
}

type StateListener<T> = (state: T) => void

export interface StateBridgeOptions<T> {
  /** Skip notifying subscribers when the next value is equivalent to the current one. */
  isEqual?: (a: T, b: T) => boolean
}

export interface StateBridge<T> {
  getState(this: void): T
  /** Replaces the state and notifies subscribers (subject to `isEqual`). */
  setState(this: void, next: T): void
  /** Adds a subscriber, calling it once immediately with the current state. */
  subscribe(this: void, listener: StateListener<T>): () => void
  /** Drops all subscribers and restores the initial value. For tests only. */
  reset(this: void): void
}

/** Creates a multi-subscriber observable-state bridge. */
export function createStateBridge<T>(
  initial: T,
  options: StateBridgeOptions<T> = {},
): StateBridge<T> {
  const { isEqual } = options
  let state = initial
  const listeners = new Set<StateListener<T>>()

  return {
    getState(): T {
      return state
    },
    setState(next: T): void {
      if (isEqual?.(state, next)) return
      state = next
      // Snapshot: a listener unsubscribing mid-notify must not skip a sibling.
      for (const listener of [...listeners]) listener(state)
    },
    subscribe(listener: StateListener<T>): () => void {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    reset(): void {
      listeners.clear()
      state = initial
    },
  }
}
