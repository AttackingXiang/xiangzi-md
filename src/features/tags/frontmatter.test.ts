import { describe, expect, it } from 'vitest'
import {
  documentMetaFromMarkdown,
  extractInlineTags,
  parseMarkdownFrontmatter,
  replaceMarkdownBody,
  setFrontmatterTags,
} from './frontmatter'

describe('frontmatter tags', () => {
  it('reads inline and block tag lists (old inline-array format stays readable)', () => {
    expect(
      parseMarkdownFrontmatter('---\ntags: [claude, "claude-code", 参考]\n---\n# Title').tags,
    ).toEqual(['claude', 'claude-code', '参考'])
    expect(parseMarkdownFrontmatter('---\ntags:\n  - alpha\n  - beta\n---\nText').tags).toEqual([
      'alpha',
      'beta',
    ])
  })

  it('reads the singular "tag" key as an alias for "tags" (Obsidian accepts both)', () => {
    expect(parseMarkdownFrontmatter('---\ntag: solo\n---\nText').tags).toEqual(['solo'])
    expect(parseMarkdownFrontmatter('---\ntag:\n  - alpha\n  - beta\n---\nText').tags).toEqual([
      'alpha',
      'beta',
    ])
  })

  it('ignores a trailing YAML comment on an inline or block tags line', () => {
    expect(
      parseMarkdownFrontmatter('---\ntags: [work, urgent] # reviewed 2026\n---\nText').tags,
    ).toEqual(['work', 'urgent'])
    expect(
      parseMarkdownFrontmatter('---\ntags:\n  - work # primary\n  - urgent\n---\nText').tags,
    ).toEqual(['work', 'urgent'])
  })

  it('does not treat a non-YAML --- delimited block as frontmatter', () => {
    // A leading thematic-break-bounded block with no "key: value" line
    // (e.g. an intro/divider some templates use) must not be silently
    // stripped from the WYSIWYG body just because it matches the same
    // "---...---" shape as real frontmatter.
    const doc = '---\nQuick summary\n---\nActual body content.'
    const parsed = parseMarkdownFrontmatter(doc)
    expect(parsed.raw).toBeNull()
    expect(parsed.body).toBe(doc)
    expect(parsed.tags).toEqual([])
  })

  it('writes tags as an Obsidian-style block list, not the old inline array', () => {
    const source = '---\ntitle: Demo\ntags:\n  - old\nowner: xiangzi\n---\n# Demo\nBody'
    const next = setFrontmatterTags(source, ['new', '参考'])
    expect(next).toContain('title: Demo')
    expect(next).toContain('owner: xiangzi')
    expect(next).toContain('tags:\n  - "new"\n  - "参考"')
    expect(parseMarkdownFrontmatter(next).body).toBe('# Demo\nBody')
    // 写出来的块状列表本身也要能被自己的解析器读回去（自举）。
    expect(parseMarkdownFrontmatter(next).tags).toEqual(['new', '参考'])
  })

  it('writes an empty tags: [] when clearing all tags', () => {
    const source = '---\ntags:\n  - old\n---\n# Demo\nBody'
    const next = setFrontmatterTags(source, [])
    expect(next).toContain('tags: []')
    expect(parseMarkdownFrontmatter(next).tags).toEqual([])
  })

  it('creates frontmatter and preserves it when WYSIWYG replaces the body', () => {
    const original = '# Hello\nBody'
    const withTags = setFrontmatterTags(original, ['hello'])
    expect(withTags).toBe('---\ntags:\n  - "hello"\n---\n# Hello\nBody')
    // Round-tripping through parseMarkdownFrontmatter must reproduce the
    // original body exactly — a stray extra newline here would persist to
    // disk and show up as an extra empty paragraph next time the file opens.
    expect(parseMarkdownFrontmatter(withTags).body).toBe(original)
    expect(replaceMarkdownBody(withTags, '# Changed')).toContain(
      'tags:\n  - "hello"\n---\n# Changed',
    )
  })

  it('adding a tag to a document with no frontmatter is idempotent under re-adding', () => {
    // Regression guard: adding a second tag should not accumulate stray
    // blank lines from the first add.
    const first = setFrontmatterTags('# Hello\nBody', ['hello'])
    const second = setFrontmatterTags(first, ['hello', 'world'])
    expect(parseMarkdownFrontmatter(second).body).toBe('# Hello\nBody')
  })

  it('builds searchable document metadata', () => {
    const meta = documentMetaFromMarkdown(
      '/notes/demo.md',
      'demo.md',
      '---\ntags: [one]\n---\n# Visible title\nUseful **summary** text.',
      1_700_000_000_000_000_000,
    )
    expect(meta.title).toBe('Visible title')
    expect(meta.excerpt).toContain('Useful summary text.')
    expect(meta.tags).toEqual(['one'])
    expect(meta.updatedAt).toBe(1_700_000_000_000)
  })
})

describe('inline #tags in the document body', () => {
  it('extracts an Obsidian-style hashtag at line start or after whitespace', () => {
    expect(extractInlineTags('#urgent this note needs attention')).toEqual(['urgent'])
    expect(extractInlineTags('see the #work-item for details')).toEqual(['work-item'])
    expect(extractInlineTags('支持中文 #参考 标签')).toEqual(['参考'])
  })

  it('does not confuse a heading "# Title" with a tag (needs no space after #)', () => {
    expect(extractInlineTags('# Title\n\nBody text')).toEqual([])
    expect(extractInlineTags('## Subheading')).toEqual([])
  })

  it('does not match "#" glued to the middle of a word', () => {
    expect(extractInlineTags('#tag1 is real, but C#tag2 is glued to a word')).toEqual(['tag1'])
    expect(extractInlineTags('a#b')).toEqual([])
  })

  it('excludes purely numeric hashtags (issue numbers, not tags)', () => {
    expect(extractInlineTags('fixed in #123')).toEqual([])
  })

  it('ignores tags inside fenced code blocks and inline code spans', () => {
    expect(extractInlineTags('```bash\n#!/bin/bash\necho #notatag\n```\n\nreal #tag here')).toEqual(
      ['tag'],
    )
    expect(extractInlineTags('use `#include` in C, but #real is a tag')).toEqual(['real'])
  })

  it('merges into documentMetaFromMarkdown tags alongside frontmatter tags', () => {
    const meta = documentMetaFromMarkdown(
      '/notes/demo.md',
      'demo.md',
      '---\ntags: [one]\n---\n# Title\n\nBody mentions #two and #one again.',
      1_700_000_000_000_000_000,
    )
    expect(meta.tags).toEqual(['one', 'two'])
  })
})
