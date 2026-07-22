function svgDataUrl(svg: SVGElement): string {
  const markup = new XMLSerializer().serializeToString(svg)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
}

/** Returns the image source represented by a double-clicked editor preview. */
export function editorZoomSource(target: Element): string | null {
  const image =
    target instanceof HTMLImageElement
      ? target
      : target.closest('[data-xmd-image]')?.querySelector<HTMLImageElement>('img')
  if (image) return image.currentSrc || image.src || null

  const mermaid = target.closest('.xmd-cm-mermaid-content')?.querySelector<SVGElement>('svg')
  return mermaid ? svgDataUrl(mermaid) : null
}
