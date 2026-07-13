import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { findVisibleMarkdownImages, isRemoteImageSource, parseMarkdownImage } from './imagePreview'

describe('Markdown image preview parsing', () => {
  it('parses standard images, optional titles and angle-bracket sources', () => {
    expect(parseMarkdownImage('![alt](images/a.png "title")')).toEqual({
      alt: 'alt',
      src: 'images/a.png',
    })
    expect(parseMarkdownImage('![a](<folder/my image.png>)')).toEqual({
      alt: 'a',
      src: 'folder/my image.png',
    })
    expect(parseMarkdownImage('![a\\]b](image(2).png)')).toEqual({
      alt: 'a]b',
      src: 'image(2).png',
    })
  })

  it('rejects malformed and reference-style images', () => {
    expect(parseMarkdownImage('![alt][reference]')).toBeNull()
    expect(parseMarkdownImage('not an image')).toBeNull()
  })

  it('classifies only network URLs as remote', () => {
    expect(isRemoteImageSource('https://example.com/a.png')).toBe(true)
    expect(isRemoteImageSource('//example.com/a.png')).toBe(true)
    expect(isRemoteImageSource('/local/a.png')).toBe(false)
    expect(isRemoteImageSource('asset://localhost/a.png')).toBe(false)
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
