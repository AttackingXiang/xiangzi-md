import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  ImagePreviewWidget,
  findVisibleMarkdownImages,
  imagePreviewMaxWidth,
  isRemoteImageSource,
  isSafeImageSource,
  parseMarkdownImage,
  parseMarkdownReferenceImage,
} from './imagePreview'

describe('Markdown image preview parsing', () => {
  it('parses standard images, optional titles and angle-bracket sources', () => {
    expect(parseMarkdownImage('![alt](images/a.png "title")')).toEqual({
      alt: 'alt',
      src: 'images/a.png',
      title: 'title',
    })
    expect(parseMarkdownImage('![a](<folder/my image.png>)')).toEqual({
      alt: 'a',
      src: 'folder/my image.png',
    })
    expect(parseMarkdownImage('![a\\]b](image(2).png)')).toEqual({
      alt: 'a]b',
      src: 'image(2).png',
    })
    expect(parseMarkdownImage("![a](<assets/a\\>b.png> 'caption')")).toEqual({
      alt: 'a',
      src: 'assets/a>b.png',
      title: 'caption',
    })
  })

  it('rejects malformed and reference-style images', () => {
    expect(parseMarkdownImage('![alt][reference]')).toBeNull()
    expect(parseMarkdownImage('not an image')).toBeNull()
  })

  it.each([
    ['![visible alt][asset]\n\n[asset]: <images/my image.png> "caption"', 'visible alt'],
    ['![asset][]\n\n[asset]: image.png', 'asset'],
    ['![asset]\n\n[asset]: image.png', 'asset'],
  ])('resolves reference-style image %s', (doc, alt) => {
    const state = EditorState.create({ doc, extensions: markdown() })
    let imageNode = syntaxTree(state).topNode.firstChild?.firstChild
    while (imageNode && imageNode.name !== 'Image') imageNode = imageNode.nextSibling

    expect(imageNode && parseMarkdownReferenceImage(state, imageNode)).toEqual({
      alt,
      src: doc.includes('my image') ? 'images/my image.png' : 'image.png',
      ...(doc.includes('caption') ? { title: 'caption' } : {}),
    })
  })

  it('classifies only network URLs as remote', () => {
    expect(isRemoteImageSource('https://example.com/a.png')).toBe(true)
    expect(isRemoteImageSource('//example.com/a.png')).toBe(true)
    expect(isRemoteImageSource('/local/a.png')).toBe(false)
    expect(isRemoteImageSource('asset://localhost/a.png')).toBe(false)
  })

  it('allows image-safe sources and rejects active or malformed protocols', () => {
    expect(isSafeImageSource('assets/a.png')).toBe(true)
    expect(isSafeImageSource('https://example.com/a.png')).toBe(true)
    expect(isSafeImageSource('asset://localhost/a.png')).toBe(true)
    expect(isSafeImageSource('C:\\vault\\assets\\a.png')).toBe(true)
    expect(isSafeImageSource('data:image/png;base64,AA==')).toBe(true)
    expect(isSafeImageSource('data:text/html,<script>')).toBe(false)
    expect(isSafeImageSource('javascript:alert(1)')).toBe(false)
    expect(isSafeImageSource('a.png\nnext')).toBe(false)
  })

  it('treats a zero maximum width setting as unrestricted', () => {
    expect(imagePreviewMaxWidth(0)).toBe('100%')
    expect(imagePreviewMaxWidth(-1)).toBe('100%')
    expect(imagePreviewMaxWidth(640)).toBe('640px')
    expect(imagePreviewMaxWidth('75vw')).toBe('75vw')
  })
})

describe('visible Markdown image discovery', () => {
  const doc = ['![first](a.png)', '', 'paragraph ![inline](b.png) text', '', '![last](c.png)'].join(
    '\n',
  )
  const state = EditorState.create({ doc, extensions: markdown() })

  it('distinguishes block and inline images', () => {
    const matches = findVisibleMarkdownImages(state, [{ from: 0, to: state.doc.length }], 0)
    expect(matches.map(({ src, block }) => ({ src, block }))).toEqual([
      { src: 'a.png', block: true },
      { src: 'b.png', block: false },
      { src: 'c.png', block: true },
    ])
  })

  it('limits parsing to visible ranges when buffering is disabled', () => {
    const firstLine = state.doc.line(1)
    expect(
      findVisibleMarkdownImages(state, [{ from: firstLine.from, to: firstLine.to }], 0),
    ).toHaveLength(1)
  })
})

describe('image preview interaction', () => {
  it('keeps pointer interaction inside the preview', () => {
    const widget = new ImagePreviewWidget(
      { from: 0, to: 15, alt: 'sample', src: 'a.png', block: true },
      'data:image/png;base64,AA==',
      '100%',
      120,
    )
    expect(widget.ignoreEvent()).toBe(true)
  })

  it('does not reuse an interactive widget after its source range moves', () => {
    const first = new ImagePreviewWidget(
      { from: 0, to: 15, alt: 'sample', src: 'a.png', block: true },
      'data:image/png;base64,AA==',
      '100%',
      120,
    )
    const moved = new ImagePreviewWidget(
      { from: 5, to: 20, alt: 'sample', src: 'a.png', block: true },
      'data:image/png;base64,AA==',
      '100%',
      120,
    )
    expect(first.eq(moved)).toBe(false)
  })
})
