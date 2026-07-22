// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { editorZoomSource } from './editorZoom'

describe('editorZoomSource', () => {
  it('keeps resolving ordinary image previews', () => {
    const preview = document.createElement('span')
    preview.dataset.xmdImage = ''
    const image = document.createElement('img')
    image.src = 'https://example.com/diagram.png'
    preview.append(image)

    expect(editorZoomSource(preview)).toBe(image.src)
  })

  it('turns a rendered Mermaid SVG into a lightbox source', () => {
    const content = document.createElement('div')
    content.className = 'xmd-cm-mermaid-content'
    content.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><path d="M0 0h20"/></svg>'
    const path = content.querySelector('path')!

    const source = editorZoomSource(path)

    expect(source).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(source!.split(',', 2)[1])).toContain('viewBox="0 0 20 10"')
  })

  it('ignores unrelated editor content', () => {
    expect(editorZoomSource(document.createElement('p'))).toBeNull()
  })
})
