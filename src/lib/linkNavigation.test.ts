import { describe, expect, it } from 'vitest'
import {
  headingOffsetForAnchor,
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

  it('keeps Markdown targets inside the active document directory', () => {
    expect(resolveRelativeMarkdownLink('notes/next%20page.md#part', '/vault/docs/current.md')).toEqual({
      kind: 'markdown',
      path: '/vault/docs/notes/next page.md',
      anchor: 'part',
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
    expect(resolveRelativeMarkdownLink('https://example.com/a.md', '/vault/docs/current.md')).toBeNull()
    expect(resolveRelativeMarkdownLink('%ZZ.md', '/vault/docs/current.md')).toBeNull()
    expect(resolveRelativeMarkdownLink('image.png', '/vault/docs/current.md')).toBeNull()
  })
})
