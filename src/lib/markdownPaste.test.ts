// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { embedMarkdownSourceInClipboardHtml, markdownFromClipboardHtml } from './markdownPaste'

describe('Markdown rich paste', () => {
  it('round-trips the exact embedded Xiangzi Markdown source', () => {
    const source = `---
title: 中文文档
---

# 标题

**粗体**、*斜体* 与 [链接](https://example.com?q=中文)

\`\`\`ts
const value = "保留源码"
\`\`\`
`
    const html = embedMarkdownSourceInClipboardHtml(
      '<h1>标题</h1><p><strong>粗体</strong>、<em>斜体</em></p>',
      source,
    )

    expect(markdownFromClipboardHtml(html)).toBe(source)
  })

  it('converts common rich document structures into editable Markdown', () => {
    const markdown = markdownFromClipboardHtml(`
      <h2>Release Notes</h2>
      <p><strong>Important</strong> and <em>careful</em>, <a href="https://example.com">details</a>.</p>
      <ul>
        <li>First</li>
        <li><input type="checkbox" checked>Done</li>
        <li>Nested<ul><li>Child<ul><li>Grandchild</li></ul></li></ul></li>
      </ul>
      <blockquote><p>Quoted text</p></blockquote>
      <pre><code class="language-ts">const value = 1</code></pre>
      <table>
        <thead><tr><th>Name</th><th>Value</th></tr></thead>
        <tbody><tr><td>A</td><td>B</td></tr></tbody>
      </table>
    `)

    expect(markdown).toContain('## Release Notes')
    expect(markdown).toContain('**Important** and *careful*')
    expect(markdown).toContain('[details](https://example.com)')
    expect(markdown).toContain('- First')
    expect(markdown).toContain('- [x] Done')
    expect(markdown).toContain('- Nested\n  - Child\n    - Grandchild')
    expect(markdown).toContain('> Quoted text')
    expect(markdown).toContain('```ts\nconst value = 1\n```')
    expect(markdown).toContain('| Name | Value |')
    expect(markdown).toContain('| --- | --- |')
  })

  it('preserves safe Word-style inline formatting and ignores hidden or executable content', () => {
    const markdown = markdownFromClipboardHtml(`
      <p>
        <span style="font-weight:700">bold</span>
        <span style="font-style:italic">italic</span>
        <span style="text-decoration:line-through">deleted</span>
        <span style="color:rgb(220, 38, 38)">red</span>
        <span style="background-color:#fde047">marked</span>
        <span style="display:none">hidden</span>
        <a href="javascript:alert(1)">unsafe</a>
      </p>
      <script>alert(1)</script>
    `)

    expect(markdown).toContain('**bold**')
    expect(markdown).toContain('*italic*')
    expect(markdown).toContain('~~deleted~~')
    expect(markdown).toContain('<font color="#dc2626">red</font>')
    expect(markdown).toContain('<mark style="background-color:#fde047">marked</mark>')
    expect(markdown).toContain('unsafe')
    expect(markdown).not.toContain('javascript:')
    expect(markdown).not.toContain('hidden')
    expect(markdown).not.toContain('alert(1)')
  })

  it('recognizes Word heading and list paragraph metadata', () => {
    const markdown = markdownFromClipboardHtml(`
      <p class="MsoHeading2"><b>Word heading</b></p>
      <p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1">
        <span style="mso-list:Ignore">·<span>&nbsp;</span></span>First
      </p>
      <p class="MsoListParagraphCxSpLast" style="mso-list:l0 level2 lfo1">
        <span style="mso-list:Ignore">1.<span>&nbsp;</span></span>Nested
      </p>
    `)

    expect(markdown).toBe('## **Word heading**\n\n- First\n  1. Nested')
  })
})
