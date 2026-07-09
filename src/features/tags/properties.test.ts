import { describe, expect, it } from 'vitest'
import {
  coerceValue,
  propertiesFromMarkdown,
  serializeProperties,
  setFrontmatterProperties,
  type DocumentProperty,
} from './properties'
import { parseMarkdownFrontmatter } from './frontmatter'

const SAMPLE = `---
title: Claude Artifacts（工件预览）
tags:
  - claude
  - artifacts
  - 原型
aliases:
  - claude artifacts
  - claude工件
---
# 正文标题

内容。
`

describe('propertiesFromMarkdown', () => {
  it('parses title / tags / aliases in document order with inferred types', () => {
    const props = propertiesFromMarkdown(SAMPLE)
    expect(props.map((p) => [p.key, p.type])).toEqual([
      ['title', 'text'],
      ['tags', 'list'],
      ['aliases', 'list'],
    ])
    expect(props[0].value).toBe('Claude Artifacts（工件预览）')
    expect(props[1].value).toEqual(['claude', 'artifacts', '原型'])
    expect(props[2].value).toEqual(['claude artifacts', 'claude工件'])
  })

  it('infers number / checkbox / date / datetime types', () => {
    const md = `---
count: 3
done: true
created: 2024-06-01
at: 2024-06-01T10:30
note: hello
---
body`
    const byKey = Object.fromEntries(propertiesFromMarkdown(md).map((p) => [p.key, p]))
    expect(byKey.count).toMatchObject({ type: 'number', value: 3 })
    expect(byKey.done).toMatchObject({ type: 'checkbox', value: true })
    expect(byKey.created).toMatchObject({ type: 'date', value: '2024-06-01' })
    expect(byKey.at).toMatchObject({ type: 'datetime' })
    expect(byKey.note).toMatchObject({ type: 'text', value: 'hello' })
  })

  it('forces tags/aliases to list even when written as a single scalar', () => {
    const props = propertiesFromMarkdown('---\ntags: solo\n---\nbody')
    expect(props[0]).toMatchObject({ key: 'tags', type: 'list', value: ['solo'] })
  })

  it('returns [] when there is no frontmatter or it is not a mapping', () => {
    expect(propertiesFromMarkdown('# just a heading')).toEqual([])
    expect(propertiesFromMarkdown('---\n- a\n- b\n---\nx')).toEqual([])
  })

  it('flags nested/complex values as complex and preserves them read-only', () => {
    const md = `---
title: X
meta:
  author: bob
  year: 2024
---
body`
    const props = propertiesFromMarkdown(md)
    const meta = props.find((p) => p.key === 'meta')
    expect(meta).toMatchObject({ key: 'meta', complex: true })
    expect(meta?.raw).toEqual({ author: 'bob', year: 2024 })
  })

  it('never destroys a complex value when another property is edited', () => {
    const md = `---
title: X
meta:
  author: bob
---
body`
    const props = propertiesFromMarkdown(md)
    const edited = props.map((p) => (p.key === 'title' ? { ...p, value: 'Y' } : p))
    const out = setFrontmatterProperties(md, edited)
    expect(out).toContain('title: Y')
    expect(out).toContain('author: bob')
    // 复杂值原样回读
    expect(propertiesFromMarkdown(out).find((p) => p.key === 'meta')?.raw).toEqual({
      author: 'bob',
    })
  })
})

describe('serializeProperties / setFrontmatterProperties', () => {
  it('round-trips the sample without dropping fields', () => {
    const props = propertiesFromMarkdown(SAMPLE)
    const next = setFrontmatterProperties(SAMPLE, props)
    const reparsed = propertiesFromMarkdown(next)
    expect(reparsed).toEqual(props)
    // 正文原样保留
    expect(parseMarkdownFrontmatter(next).body).toBe(parseMarkdownFrontmatter(SAMPLE).body)
  })

  it('writes tags as an Obsidian-style block sequence', () => {
    const yaml = serializeProperties([{ key: 'tags', type: 'list', value: ['a', 'b'] }])
    expect(yaml).toBe('tags:\n  - a\n  - b')
  })

  it('creates a frontmatter block when the document had none', () => {
    const out = setFrontmatterProperties('# Title\n\nbody', [
      { key: 'title', type: 'text', value: 'T' },
    ])
    expect(out).toBe('---\ntitle: T\n---\n# Title\n\nbody')
  })

  it('removes the frontmatter block when all properties are cleared', () => {
    const out = setFrontmatterProperties(SAMPLE, [])
    expect(out.startsWith('---')).toBe(false)
    expect(out).toBe(parseMarkdownFrontmatter(SAMPLE).body)
  })

  it('skips unnamed (empty-key) rows and empty list items', () => {
    const props: DocumentProperty[] = [
      { key: '', type: 'text', value: 'orphan' },
      { key: 'tags', type: 'list', value: ['', 'kept'] },
    ]
    expect(serializeProperties(props)).toBe('tags:\n  - kept')
  })

  it('renders empty text values as a blank value, not the literal null', () => {
    const yaml = serializeProperties([{ key: 'summary', type: 'text', value: null }])
    expect(yaml).toBe('summary:')
  })

  it('preserves CRLF newlines when present', () => {
    const crlf = '---\r\ntitle: A\r\n---\r\nbody'
    const out = setFrontmatterProperties(crlf, propertiesFromMarkdown(crlf))
    expect(out).toContain('\r\n')
  })
})

describe('coerceValue', () => {
  it('converts between list and text', () => {
    expect(coerceValue(['a', 'b'], 'text')).toBe('a, b')
    expect(coerceValue('solo', 'list')).toEqual(['solo'])
  })

  it('parses numbers and falls back to null', () => {
    expect(coerceValue('42', 'number')).toBe(42)
    expect(coerceValue('nope', 'number')).toBeNull()
  })

  it('coerces to checkbox by truthiness', () => {
    expect(coerceValue('x', 'checkbox')).toBe(true)
    expect(coerceValue([], 'checkbox')).toBe(false)
  })
})
