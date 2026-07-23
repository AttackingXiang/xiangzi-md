/** DOM and pinning geometry shared by the fenced-code runtime. Keeping these
 * layout helpers separate makes the scroll plugin responsible for orchestration
 * rather than also owning low-level DOM traversal and measurement math. */

export function createCodeScrollbarElement(): HTMLElement {
  const scrollbar = document.createElement('span')
  scrollbar.className = 'xmd-cm-code-scrollbar'
  scrollbar.style.top = '-9999px'
  scrollbar.tabIndex = -1
  scrollbar.setAttribute('role', 'scrollbar')
  scrollbar.setAttribute('aria-label', 'Code block horizontal scroll')
  scrollbar.setAttribute('aria-orientation', 'horizontal')
  scrollbar.setAttribute('aria-valuemin', '0')
  scrollbar.setAttribute('aria-hidden', 'true')
  return scrollbar
}

export interface MountedCodeBlock {
  lines: HTMLElement[]
  contents: HTMLElement[]
}

export function mountedCodeBlockAt(element: HTMLElement): MountedCodeBlock {
  let first = element.closest<HTMLElement>('.cm-line.xmd-cm-code-line')
  while (
    first?.previousElementSibling instanceof HTMLElement &&
    first.previousElementSibling.classList.contains('xmd-cm-code-line')
  ) {
    first = first.previousElementSibling
  }
  const lines: HTMLElement[] = []
  let current: Element | null = first
  while (current instanceof HTMLElement && current.classList.contains('xmd-cm-code-line')) {
    lines.push(current)
    current = current.nextElementSibling
  }
  return {
    lines,
    contents: lines.flatMap((item) =>
      Array.from(item.querySelectorAll<HTMLElement>('.xmd-cm-code-line-content')),
    ),
  }
}

function textDescendants(node: Node, result: Text[] = []): Text[] {
  if (node instanceof Text && node.data.length > 0) result.push(node)
  for (const child of Array.from(node.childNodes)) textDescendants(child, result)
  return result
}

export function codeContentCaretX(content: HTMLElement, lineOffset: number): number | null {
  const textNodes = textDescendants(content)
  if (textNodes.length === 0) return null
  let remaining = Math.max(0, lineOffset)
  const range = document.createRange()
  try {
    for (const text of textNodes) {
      if (remaining === 0) {
        range.setStart(text, 0)
        range.setEnd(text, 1)
        return range.getBoundingClientRect().left
      }
      if (remaining <= text.data.length) {
        range.setStart(text, remaining - 1)
        range.setEnd(text, remaining)
        return range.getBoundingClientRect().right
      }
      remaining -= text.data.length
    }
    const lastText = textNodes.at(-1)
    if (!lastText) return null
    range.setStart(lastText, lastText.data.length - 1)
    range.setEnd(lastText, lastText.data.length)
    return range.getBoundingClientRect().right
  } catch {
    return null
  }
}

export const CODE_CONTROLS_HEIGHT = 28
export const CODE_CONTROLS_INSIDE_TOP = 10
export const CODE_SCROLLBAR_HEIGHT = 5
export const CODE_SCROLLBAR_MARGIN = 3
export const CODE_SCROLLBAR_INSET = 16

const CODE_CONTROLS_INSIDE_ENTER_GAP = 16
const CODE_CONTROLS_INSIDE_EXIT_GAP = 8

/** Decide whether the first row has enough unused space for the controls.
 * Re-entering the card requires a little more space than staying there, so
 * typing around the threshold cannot make the controls jump on every key. */
export function codeControlsFitInside(
  availableWidth: number,
  controlsWidth: number,
  currentlyInside: boolean,
): boolean {
  const safetyGap = currentlyInside ? CODE_CONTROLS_INSIDE_EXIT_GAP : CODE_CONTROLS_INSIDE_ENTER_GAP
  return availableWidth >= controlsWidth + safetyGap
}

interface HorizontalRect {
  left: number
  width: number
}

export interface CodeBlockOverlayHorizontalGeometry {
  controlsAnchorLeft: number
  scrollbarLeft: number
  trackWidth: number
}

/** Convert the rendered code-card box into scrollDOM content coordinates.
 *
 * The editor's `.cm-content` rectangle includes its page padding, while code
 * cards fill only the content box inside that padding. Overlay controls must
 * therefore use a mounted code row as their horizontal reference instead of
 * the editor container, or they drift into the page gutter as padding/zoom
 * changes. */
export function codeBlockOverlayHorizontalGeometry(
  blockRect: HorizontalRect,
  scrollRect: Pick<HorizontalRect, 'left'>,
  scrollLeft: number,
  scaleX: number,
): CodeBlockOverlayHorizontalGeometry {
  const scale = Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1
  const blockLeft = (blockRect.left - scrollRect.left) / scale + scrollLeft
  const blockWidth = blockRect.width / scale
  return {
    // The controls tab shares the card's right border. Keeping the old 10px
    // inset leaves an awkward ledge between the tab and the rounded corner.
    controlsAnchorLeft: blockLeft + blockWidth,
    scrollbarLeft: blockLeft + CODE_SCROLLBAR_INSET,
    trackWidth: Math.max(0, blockWidth - 2 * CODE_SCROLLBAR_INSET),
  }
}

export interface OverlayPinGeometry {
  blockTop: number
  blockBottom: number
  viewportTop: number
  viewportBottom: number
}

export function pinnedOverlayTop(
  edge: 'block-start' | 'block-end',
  geometry: OverlayPinGeometry,
  height: number,
  margin: number,
): number | null {
  const { blockTop, blockBottom, viewportTop, viewportBottom } = geometry
  if (blockBottom <= viewportTop || blockTop >= viewportBottom) return null
  if (edge === 'block-start') {
    let top = Math.max(blockTop + margin, viewportTop + margin)
    top = Math.min(top, blockBottom - margin - height)
    return Math.max(top, blockTop)
  }
  let top = Math.min(blockBottom - margin - height, viewportBottom - margin - height)
  top = Math.max(top, blockTop + margin)
  return Math.min(top, blockBottom - height)
}

/** Place the active code controls either in the card's first row or as a tab
 * joined to its top-right edge. When the block top has scrolled away, both
 * placements pin to the visible part of the card instead of disappearing. */
export function codeControlsTop(
  geometry: OverlayPinGeometry,
  inside = false,
  height = CODE_CONTROLS_HEIGHT,
): number | null {
  const { blockTop, blockBottom, viewportTop, viewportBottom } = geometry
  if (blockBottom <= viewportTop || blockTop >= viewportBottom) return null
  if (inside) {
    return pinnedOverlayTop('block-start', geometry, height, CODE_CONTROLS_INSIDE_TOP)
  }
  const earTop = blockTop - height + 1
  if (earTop >= viewportTop) return earTop
  return Math.max(blockTop, Math.min(viewportTop, blockBottom - height))
}
