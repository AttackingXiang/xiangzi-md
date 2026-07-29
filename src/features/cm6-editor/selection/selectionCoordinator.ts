import { Facet, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import { currentDesktopPlatform } from '../../../lib/platform'
import { isTauriRuntime } from '../../../platform'
import { selectionIntersectsFencedCode } from '../codeBlockDetection'
import type { PreviewRange } from '../core/types'
import { selectionIntent } from './selectionIntent'

export const NATIVE_LINE_SELECTION_CLASS = 'xmd-cm-native-line-selection'
export const NATIVE_CODE_SELECTION_CLASS = 'xmd-cm-native-code-selection'
export const NATIVE_SELECTION_CLASS = 'xmd-cm-native-selection'

export type SelectionSurface = 'document' | 'table-cell'
export type SelectionPresentation = 'cm6' | 'native-line' | 'native-code' | 'native-table'

export interface SelectionCoordinatorSnapshot {
  pointerActive: boolean
  surface: SelectionSurface
}

const DEFAULT_SNAPSHOT: SelectionCoordinatorSnapshot = {
  pointerActive: false,
  surface: 'document',
}

export const setPointerSelectionActive = StateEffect.define<boolean>()
export const setSelectionSurface = StateEffect.define<SelectionSurface>()

export const selectionCoordinatorState = StateField.define<SelectionCoordinatorSnapshot>({
  create: () => DEFAULT_SNAPSHOT,
  update(value, transaction) {
    let pointerActive = value.pointerActive
    let surface = value.surface
    for (const effect of transaction.effects) {
      if (effect.is(setPointerSelectionActive)) pointerActive = effect.value
      if (effect.is(setSelectionSurface)) surface = effect.value
    }
    return pointerActive === value.pointerActive && surface === value.surface
      ? value
      : { pointerActive, surface }
  },
})

/** Live preview opts into native selection fallbacks; source mode remains CM6-only. */
export const nativeSelectionPresentationEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

export interface SelectionCoordinatorObserver {
  onPointerSelectionEnd?: (view: EditorView, canceled: boolean) => void
}

export const selectionCoordinatorObserver = Facet.define<SelectionCoordinatorObserver>()

export function selectionSnapshot(state: EditorState): SelectionCoordinatorSnapshot {
  return state.field(selectionCoordinatorState, false) ?? DEFAULT_SNAPSHOT
}

export function isPointerSelectionActive(state: EditorState): boolean {
  return selectionSnapshot(state).pointerActive
}

export function isSinglePhysicalLineSelection(state: EditorState): boolean {
  if (state.selection.ranges.length !== 1) return false
  const range = state.selection.main
  return !range.empty && state.doc.lineAt(range.from).number === state.doc.lineAt(range.to).number
}

/**
 * A single mounted range can use the browser's Range painter. Anything that
 * needs CM6 virtualization or secondary selections stays on drawSelection().
 */
export function shouldUseNativeSelectionPainting(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  preferViewportNativeSelection = false,
): boolean {
  if (isSinglePhysicalLineSelection(state)) return true
  if (state.selection.ranges.length !== 1) return false
  const range = state.selection.main
  if (range.empty) return false
  if (!preferViewportNativeSelection) return false
  const firstVisible = visibleRanges[0]
  const lastVisible = visibleRanges[visibleRanges.length - 1]
  return Boolean(
    firstVisible && lastVisible && firstVisible.from <= range.from && lastVisible.to >= range.to,
  )
}

export interface SelectionPresentationContext {
  focused: boolean
  enabled: boolean
  preferViewportNativeSelection: boolean
  surface: SelectionSurface
}

export function selectionPresentationFor(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  context: SelectionPresentationContext,
): SelectionPresentation {
  if (!context.focused || !context.enabled) return 'cm6'
  if (context.surface === 'table-cell') return 'native-table'
  if (selectionIntersectsFencedCode(state)) return 'native-code'
  return shouldUseNativeSelectionPainting(
    state,
    visibleRanges,
    context.preferViewportNativeSelection,
  )
    ? 'native-line'
    : 'cm6'
}

export function enterTableSelectionSurface(view: EditorView): void {
  const range = view.state.selection.main
  view.dispatch({
    selection: range.empty ? undefined : { anchor: range.head },
    effects: setSelectionSurface.of('table-cell'),
    annotations: selectionIntent.of('surface-sync'),
  })
}

export function leaveTableSelectionSurface(view: EditorView): void {
  if (selectionSnapshot(view.state).surface === 'document') return
  view.dispatch({
    effects: setSelectionSurface.of('document'),
    annotations: selectionIntent.of('surface-sync'),
  })
}

class SelectionCoordinatorPlugin {
  private pointerFinishFrame = 0
  private destroyed = false
  private readonly preferViewportNativeSelection =
    isTauriRuntime() && currentDesktopPlatform() === 'macos'

  constructor(readonly view: EditorView) {
    view.contentDOM.addEventListener('pointerdown', this.onPointerDown, true)
    view.contentDOM.addEventListener('focus', this.onFocusChange)
    view.contentDOM.addEventListener('blur', this.onFocusChange)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerCancel)
    window.addEventListener('mouseup', this.onMouseUp)
    this.syncPresentation()
  }

  update(): void {
    this.syncPresentation()
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.pointerFinishFrame)
    this.view.contentDOM.removeEventListener('pointerdown', this.onPointerDown, true)
    this.view.contentDOM.removeEventListener('focus', this.onFocusChange)
    this.view.contentDOM.removeEventListener('blur', this.onFocusChange)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerCancel)
    window.removeEventListener('mouseup', this.onMouseUp)
    this.view.dom.classList.remove(NATIVE_LINE_SELECTION_CLASS, NATIVE_CODE_SELECTION_CLASS)
    this.view.dom.classList.remove(NATIVE_SELECTION_CLASS)
  }

  private readonly onFocusChange = (): void => this.syncPresentation()

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      event.target.closest('.xmd-cm-table-cell') ||
      !this.view.contentDOM.contains(event.target)
    ) {
      return
    }
    cancelAnimationFrame(this.pointerFinishFrame)
    this.pointerFinishFrame = 0
    if (selectionSnapshot(this.view.state).pointerActive) return
    this.view.dispatch({
      effects: setPointerSelectionActive.of(true),
      annotations: selectionIntent.of('pointer'),
    })
  }

  private readonly onPointerUp = (): void => this.finishPointerSelection(false)
  private readonly onPointerCancel = (): void => this.finishPointerSelection(true)
  private readonly onMouseUp = (): void => this.finishPointerSelection(false)

  private finishPointerSelection(canceled: boolean): void {
    if (!selectionSnapshot(this.view.state).pointerActive) return
    cancelAnimationFrame(this.pointerFinishFrame)
    const finish = (): void => {
      this.pointerFinishFrame = 0
      if (this.destroyed || !selectionSnapshot(this.view.state).pointerActive) return
      this.view.dispatch({
        effects: setPointerSelectionActive.of(false),
        annotations: selectionIntent.of('pointer'),
      })
      for (const observer of this.view.state.facet(selectionCoordinatorObserver)) {
        observer.onPointerSelectionEnd?.(this.view, canceled)
      }
    }
    if (canceled) finish()
    else this.pointerFinishFrame = requestAnimationFrame(finish)
  }

  private syncPresentation(): void {
    const presentation = selectionPresentationFor(this.view.state, this.view.visibleRanges, {
      focused: this.view.hasFocus,
      enabled: this.view.state.facet(nativeSelectionPresentationEnabled),
      preferViewportNativeSelection: this.preferViewportNativeSelection,
      surface: selectionSnapshot(this.view.state).surface,
    })
    this.view.dom.classList.toggle(NATIVE_LINE_SELECTION_CLASS, presentation === 'native-line')
    this.view.dom.classList.toggle(NATIVE_CODE_SELECTION_CLASS, presentation === 'native-code')
    this.view.dom.classList.toggle(NATIVE_SELECTION_CLASS, presentation !== 'cm6')
  }
}

/** One editor-owned selection state machine and painting-policy coordinator. */
export function selectionCoordinator(): Extension {
  return [
    selectionCoordinatorState,
    ViewPlugin.define((view) => new SelectionCoordinatorPlugin(view)),
  ]
}
