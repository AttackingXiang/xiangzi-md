import { markdown } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import {
  ImagePreviewWidget,
  cachedImageDimensions,
  collectImageHiddenRanges,
  findVisibleMarkdownImages,
  imagePreviewMaxWidth,
  isRemoteImageSource,
  isSafeImageSource,
  markdownImagePreview,
  parseMarkdownImage,
  parseMarkdownReferenceImage,
  rememberImageDimensions,
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
    expect(isSafeImageSource('xmd://localhost/%2Fnotes%2Fa.png')).toBe(true)
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

  it('reuses measured image dimensions for proportional placeholders', () => {
    const url = 'xmd://localhost/%2Fnotes%2Fcached-image.png'
    rememberImageDimensions(url, { width: 1280, height: 720 })
    expect(cachedImageDimensions(url)).toEqual({ width: 1280, height: 720 })
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

  it('registers each rendered image span through the core hidden-range engine', () => {
    const ranges = collectImageHiddenRanges(state, [{ from: 0, to: state.doc.length }], {
      bufferChars: 0,
    })
    expect(ranges).toEqual([
      { from: 0, to: '![first](a.png)'.length, presentation: 'external' },
      {
        from: doc.indexOf('![inline]'),
        to: doc.indexOf(' text'),
        presentation: 'external',
      },
      { from: doc.indexOf('![last]'), to: doc.length, presentation: 'external' },
    ])
    // Invariant 3 (core/README.md): the only atomicRanges provider is the
    // aggregated one installed by hiddenRangesEngine() in markdownLivePreview.
    const withExtension = EditorState.create({
      doc,
      extensions: [markdown(), markdownImagePreview({ resolveSrc: (src) => src })],
    })
    expect(withExtension.facet(EditorView.atomicRanges)).toHaveLength(0)
  })

  it('keeps sources that fall back to Markdown text editable rather than atomic', () => {
    const fallbackDoc = ['![bad](javascript:alert(1))', '', '![remote](https://a.com/a.png)'].join(
      '\n',
    )
    const fallbackState = EditorState.create({ doc: fallbackDoc, extensions: markdown() })
    expect(
      collectImageHiddenRanges(fallbackState, [{ from: 0, to: fallbackDoc.length }], {
        bufferChars: 0,
      }),
    ).toHaveLength(0)
    expect(
      collectImageHiddenRanges(fallbackState, [{ from: 0, to: fallbackDoc.length }], {
        bufferChars: 0,
        allowRemote: true,
      }),
    ).toEqual([
      {
        from: fallbackDoc.indexOf('![remote]'),
        to: fallbackDoc.length,
        presentation: 'external',
      },
    ])
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
