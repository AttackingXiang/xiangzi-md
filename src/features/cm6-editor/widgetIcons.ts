const SVG_NS = 'http://www.w3.org/2000/svg'

type IconPath =
  | { tag: 'path'; d: string }
  | { tag: 'circle'; cx: string; cy: string; r: string }
  | { tag: 'rect'; x: string; y: string; width: string; height: string; rx?: string; ry?: string }

function buildIcon(paths: readonly IconPath[], size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  for (const path of paths) {
    const element = document.createElementNS(SVG_NS, path.tag)
    if (path.tag === 'path') element.setAttribute('d', path.d)
    else if (path.tag === 'circle') {
      element.setAttribute('cx', path.cx)
      element.setAttribute('cy', path.cy)
      element.setAttribute('r', path.r)
    } else {
      element.setAttribute('x', path.x)
      element.setAttribute('y', path.y)
      element.setAttribute('width', path.width)
      element.setAttribute('height', path.height)
      if (path.rx) element.setAttribute('rx', path.rx)
      if (path.ry) element.setAttribute('ry', path.ry)
    }
    svg.append(element)
  }
  return svg
}

/** lucide-react "code-xml" (aka Code2) — matches the source-mode icon used in StatusBar.tsx. */
export function codeIcon(size = 14): SVGSVGElement {
  return buildIcon(
    [
      { tag: 'path', d: 'm18 16 4-4-4-4' },
      { tag: 'path', d: 'm6 8-4 4 4 4' },
      { tag: 'path', d: 'm14.5 4-5 16' },
    ],
    size,
  )
}

/** lucide-react "eye" — matches the preview-mode icon used in StatusBar.tsx. */
export function eyeIcon(size = 14): SVGSVGElement {
  return buildIcon(
    [
      {
        tag: 'path',
        d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
      },
      { tag: 'circle', cx: '12', cy: '12', r: '3' },
    ],
    size,
  )
}

/** lucide-react "copy". */
export function copyIcon(size = 14): SVGSVGElement {
  return buildIcon(
    [
      { tag: 'rect', width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' },
      { tag: 'path', d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' },
    ],
    size,
  )
}

/** lucide-react "check" — brief success confirmation after a copy action. */
export function checkIcon(size = 14): SVGSVGElement {
  return buildIcon([{ tag: 'path', d: 'M20 6 9 17l-5-5' }], size)
}
