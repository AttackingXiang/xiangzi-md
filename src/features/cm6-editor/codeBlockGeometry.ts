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

const DEFAULT_CODE_CONTROLS_GUTTER = 176
const CODE_CONTROLS_GUTTER_MARGIN = 8

export function resolveCodeControlsGutter(header: HTMLElement): number {
  const cssValue = Number.parseFloat(
    getComputedStyle(header).getPropertyValue('--xmd-code-controls-gutter'),
  )
  const reserved =
    Number.isFinite(cssValue) && cssValue > 0 ? cssValue : DEFAULT_CODE_CONTROLS_GUTTER
  const measured = header.getBoundingClientRect().width + CODE_CONTROLS_GUTTER_MARGIN
  return Math.max(reserved, measured)
}

export const CODE_CONTROLS_HEIGHT = 28
export const CODE_CONTROLS_MARGIN = 10
export const CODE_CONTROLS_INSET = 10
export const CODE_SCROLLBAR_HEIGHT = 5
export const CODE_SCROLLBAR_MARGIN = 3
export const CODE_SCROLLBAR_INSET = 16

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
