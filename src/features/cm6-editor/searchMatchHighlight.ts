import { getSearchQuery } from '@codemirror/search'
import { Prec, type EditorState, type Extension, type SelectionRange } from '@codemirror/state'
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'

const activeSearchMatch = Decoration.mark({ class: 'xmd-cm-active-search-match' })

function isExactSearchMatch(state: EditorState, range: SelectionRange): boolean {
  if (range.empty) return false
  const query = getSearchQuery(state)
  if (!query.valid) return false
  const result = query.getCursor(state, range.from, range.to).next()
  return !result.done && result.value.from === range.from && result.value.to === range.to
}

export function activeSearchMatchDecorations(state: EditorState): DecorationSet {
  const ranges = state.selection.ranges
    .filter((range) => isExactSearchMatch(state, range))
    .map((range) => activeSearchMatch.range(range.from, range.to))
  return Decoration.set(ranges, true)
}

function searchSelectionKey(state: EditorState): string {
  const query = getSearchQuery(state)
  const main = state.selection.main
  return `${query.valid ? query.search : ''}:${main.from}:${main.to}`
}

class ActiveSearchMatchPlugin {
  decorations: DecorationSet
  private lastSelectionKey: string
  private focusFrame: number | null = null
  private readonly focusLayer: HTMLDivElement

  constructor(view: EditorView) {
    this.decorations = activeSearchMatchDecorations(view.state)
    this.lastSelectionKey = searchSelectionKey(view.state)
    this.focusLayer = view.scrollDOM.ownerDocument.createElement('div')
    this.focusLayer.className = 'xmd-focus-effect-layer'
    this.focusLayer.setAttribute('aria-hidden', 'true')
    view.scrollDOM.appendChild(this.focusLayer)
    this.scheduleFocus(view)
  }

  update(update: ViewUpdate): void {
    this.decorations = activeSearchMatchDecorations(update.state)
    const nextSelectionKey = searchSelectionKey(update.state)
    const searchTriggered = update.transactions.some((transaction) =>
      transaction.isUserEvent('select.search'),
    )
    if (nextSelectionKey !== this.lastSelectionKey || searchTriggered) {
      this.lastSelectionKey = nextSelectionKey
      this.scheduleFocus(update.view)
    }
  }

  destroy(): void {
    if (this.focusFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.focusFrame)
    }
    this.focusLayer.remove()
  }

  private scheduleFocus(view: EditorView): void {
    if (this.focusFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.focusFrame)
    }

    const applyFocus = (): void => {
      this.focusFrame = null
      this.focusLayer.replaceChildren()

      view.dom
        .querySelectorAll('.xmd-cm-search-target')
        .forEach((element) => element.classList.remove('xmd-cm-search-target'))

      const hasActiveSearchSelection = view.state.selection.ranges.some((range) =>
        isExactSearchMatch(view.state, range),
      )
      if (!hasActiveSearchSelection) return

      const targets = new Set<Element>(
        Array.from(view.dom.querySelectorAll('.xmd-cm-active-search-match')),
      )
      const ranges = view.state.selection.ranges.filter((range) =>
        isExactSearchMatch(view.state, range),
      )
      const sourceTargets = view.dom.querySelectorAll<HTMLElement>(
        '[data-source-from][data-source-to]',
      )
      sourceTargets.forEach((element) => {
        const sourceFrom = Number(element.dataset.sourceFrom)
        const sourceTo = Number(element.dataset.sourceTo)
        if (
          Number.isFinite(sourceFrom) &&
          Number.isFinite(sourceTo) &&
          ranges.some((range) => sourceFrom <= range.from && range.to <= sourceTo)
        ) {
          element.classList.add('xmd-cm-search-target')
          targets.add(element)
        }
      })

      const containerRect = view.scrollDOM.getBoundingClientRect()
      const style = getComputedStyle(view.dom)
      const effect = style.getPropertyValue('--xmd-focus-effect').trim() || 'sparkle'
      if (effect === 'off') return
      const rects = Array.from(targets).flatMap((target) =>
        Array.from(target.getClientRects()).map((rect) => ({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        })),
      )

      if (rects.length === 0) {
        const coords = view.coordsAtPos(view.state.selection.main.from)
        if (coords) {
          rects.push({
            left: coords.left,
            top: coords.top,
            width: Math.max(12, coords.right - coords.left),
            height: coords.bottom - coords.top,
          })
        }
      }

      for (const rect of rects) {
        if (rect.width <= 0 || rect.height <= 0) continue
        const padding = effect === 'confetti' ? 32 : effect === 'shatter' ? 24 : 5
        const effectNode = view.scrollDOM.ownerDocument.createElement('span')
        effectNode.className = 'xmd-focus-effect'
        effectNode.dataset.effect = effect
        effectNode.style.left = `${rect.left - containerRect.left + view.scrollDOM.scrollLeft - padding}px`
        effectNode.style.top = `${rect.top - containerRect.top + view.scrollDOM.scrollTop - padding}px`
        effectNode.style.width = `${rect.width + padding * 2}px`
        effectNode.style.height = `${rect.height + padding * 2}px`
        effectNode.addEventListener('animationend', () => effectNode.remove(), { once: true })
        this.focusLayer.appendChild(effectNode)
      }
    }

    if (typeof requestAnimationFrame === 'function') {
      this.focusFrame = requestAnimationFrame(applyFocus)
    } else {
      applyFocus()
    }
  }
}

/** Paint the active search range above rendered editor surfaces. */
export function activeSearchMatchHighlight(): Extension {
  return Prec.high(
    ViewPlugin.fromClass(ActiveSearchMatchPlugin, {
      decorations: (plugin) => plugin.decorations,
    }),
  )
}
