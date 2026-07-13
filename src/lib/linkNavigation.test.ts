import { describe, expect, it } from 'vitest'
import {
  headingOffsetForAnchor,
  markdownHeadingContentOffset,
  markdownHeadingText,
  markdownHeadings,
  markdownHeadingSlug,
  resolveRelativeMarkdownLink,
} from './linkNavigation'

describe('relative Markdown link navigation', () => {
  it('resolves anchors and duplicate heading slugs', () => {
    const markdown = '# Hello World\ntext\n# Hello World\n# 中文 标题\n'
    expect(markdownHeadingSlug('Hello, **World**!')).toBe('hello-world')
    expect(headingOffsetForAnchor(markdown, 'hello-world-1')).toBe(19)
    expect(headingOffsetForAnchor(markdown, encodeURIComponent('中文-标题'))).toBe(33)
  })

  it('keeps generated heading ids unique when literal and duplicate suffixes collide', () => {
    const markdown = '# A\n# A-1\n# A\n# A\n'
    expect(headingOffsetForAnchor(markdown, 'a')).toBe(0)
    expect(headingOffsetForAnchor(markdown, 'a-1')).toBe(4)
    expect(headingOffsetForAnchor(markdown, 'a-2')).toBe(10)
    expect(headingOffsetForAnchor(markdown, 'a-3')).toBe(14)
  })

  it('parses indented, empty and Setext headings from the CommonMark tree', () => {
    expect(markdownHeadings('   # Indented\n##\nSetext **Title**\n---\n')).toEqual([
      { level: 1, text: 'Indented', offset: 0 },
      { level: 2, text: '', offset: 14 },
      { level: 2, text: 'Setext Title', offset: 17 },
    ])
  })

  it('resolves unmounted footnote targets, backlinks and Obsidian block ids from source', () => {
    const markdown = [
      'Text with [^Long Note].',
      '',
      '```md',
      '[^fake]: inside code',
      '```',
      '',
      '[^Long Note]: Definition',
      '',
      'Addressable paragraph ^block-id',
    ].join('\n')
    const definitionOffset = markdown.indexOf('[^Long Note]:')

    expect(headingOffsetForAnchor(markdown, 'fn-long-note')).toBe(definitionOffset)
    expect(headingOffsetForAnchor(markdown, 'user-content-fn-long-note')).toBe(definitionOffset)
    expect(headingOffsetForAnchor(markdown, 'fnref-long-note')).toBe(
      markdown.indexOf('[^Long Note]'),
    )
    expect(headingOffsetForAnchor(markdown, '%5Eblock-id')).toBe(
      markdown.indexOf('Addressable paragraph'),
    )
    expect(headingOffsetForAnchor(markdown, 'fn-fake')).toBeNull()
  })

  it('builds anchors from visible inline heading content', () => {
    expect(markdownHeadingText('**Bold** [`Link`](next.md) <kbd>Key</kbd> &amp; More')).toBe(
      'Bold Link Key & More',
    )
    expect(markdownHeadingSlug('**Bold** [`Link`](next.md) <kbd>Key</kbd> &amp; More')).toBe(
      'bold-link-key-more',
    )
    const markdown = '# [安装指南](guide.md)\n# A &amp; B\n'
    expect(headingOffsetForAnchor(markdown, '安装指南')).toBe(0)
    expect(headingOffsetForAnchor(markdown, 'a-b')).toBe(19)
    expect(headingOffsetForAnchor('Setext **Title**\n===\n', 'setext-title')).toBe(0)
    expect(markdownHeadingContentOffset('   # **[Title](next.md)**')).toBe(8)
    expect(markdownHeadingContentOffset('# <kbd>Key</kbd>')).toBe(7)
    expect(markdownHeadingContentOffset('##')).toBeNull()
  })

  it('keeps Markdown targets inside the active document directory', () => {
    expect(
      resolveRelativeMarkdownLink('notes/next%20page.md#part', '/vault/docs/current.md'),
    ).toEqual({
      kind: 'markdown',
      path: '/vault/docs/notes/next page.md',
      anchor: 'part',
    })
    expect(resolveRelativeMarkdownLink('next.md#100%25', '/vault/docs/current.md')).toEqual({
      kind: 'markdown',
      path: '/vault/docs/next.md',
      anchor: '100%25',
    })
    expect(resolveRelativeMarkdownLink('next.md', 'C:\\vault\\current.md')).toEqual({
      kind: 'markdown',
      path: 'C:\\vault\\next.md',
    })
  })

  it('rejects traversal, absolute, malformed and non-Markdown targets', () => {
    expect(resolveRelativeMarkdownLink('../secret.md', '/vault/docs/current.md')).toBeNull()
    expect(resolveRelativeMarkdownLink('%2e%2e/secret.md', '/vault/docs/current.md')).toBeNull()
    expect(resolveRelativeMarkdownLink('/absolute.md', '/vault/docs/current.md')).toBeNull()
    expect(
      resolveRelativeMarkdownLink('https://example.com/a.md', '/vault/docs/current.md'),
    ).toBeNull()
    expect(resolveRelativeMarkdownLink('%ZZ.md', '/vault/docs/current.md')).toBeNull()
    expect(resolveRelativeMarkdownLink('next%00.md', '/vault/docs/current.md')).toBeNull()
    expect(resolveRelativeMarkdownLink('..%20/secret.md', 'C:\\vault\\docs\\current.md')).toBeNull()
    expect(resolveRelativeMarkdownLink('#%00', '/vault/docs/current.md')).toBeNull()
    expect(resolveRelativeMarkdownLink('image.png', '/vault/docs/current.md')).toBeNull()
  })
})
