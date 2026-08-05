// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { DEFAULT_ACADEMIC_LAYOUT } from '../platform/contracts'
import { academicPreviewCssVars, renderAcademicPreviewHtml } from './academicPreview'

describe('academicPreviewCssVars', () => {
  it('passes pt/mm straight through and line-height as a bare multiplier', () => {
    const vars = academicPreviewCssVars(DEFAULT_ACADEMIC_LAYOUT)
    // CSS 原生支持 pt/mm，且 line-height 不带单位时本来就是"当前字号的倍数"，
    // 跟 Word 的倍数行距是同一个概念——这两个值不需要任何换算，直接透传。
    expect(vars['--ap-body-size']).toBe('12pt')
    expect(vars['--ap-line-height']).toBe('1.5')
    expect(vars['--ap-indent']).toBe('2em')
    expect(vars['--ap-margin']).toBe('25mm')
    expect(vars['--ap-title-size']).toBe('18pt')
    expect(vars['--ap-h1-size']).toBe('16pt')
  })

  it('derives page width from the paper size', () => {
    expect(academicPreviewCssVars(DEFAULT_ACADEMIC_LAYOUT)['--ap-page-width']).toBe('210mm')
    expect(
      academicPreviewCssVars({ ...DEFAULT_ACADEMIC_LAYOUT, paper: 'letter' })['--ap-page-width'],
    ).toBe('215.9mm')
  })
})

describe('renderAcademicPreviewHtml', () => {
  it('marks the paragraph right after a heading as the first paragraph, and later ones as body', () => {
    const html = renderAcademicPreviewHtml('# 标题\n\n第一段。\n\n第二段。\n')
    const first = html.indexOf('class="ap-first-paragraph"')
    const body = html.indexOf('class="ap-body"')
    expect(first).toBeGreaterThan(-1)
    expect(body).toBeGreaterThan(first)
  })

  it('treats the very start of the document like it follows a heading', () => {
    const html = renderAcademicPreviewHtml('开头就是正文，没有标题。\n')
    expect(html).toContain('class="ap-first-paragraph"')
  })

  it('resumes indentation after a non-paragraph block interrupts the heading', () => {
    // 引用/表格/列表打断之后，紧接的段落不算"小节起始段"，应该按普通正文缩进。
    const html = renderAcademicPreviewHtml('# 标题\n\n> 引用\n\n之后的段落。\n')
    const afterQuote = html.slice(html.indexOf('</blockquote>'))
    expect(afterQuote).toContain('class="ap-body"')
  })

  it('promotes headings and demotes the bibliography heading level correctly', () => {
    const html = renderAcademicPreviewHtml(
      '# 引言\n\n正文。\n\n## 参考文献\n\n[1] 示例。\n\n## 附录\n\n附录正文。\n',
    )
    expect(html).toContain('<h2 class="ap-heading-2">参考文献</h2>')
    const bibIndex = html.indexOf('参考文献')
    const citeIndex = html.indexOf('[1] 示例')
    const appendixIndex = html.indexOf('附录')
    expect(citeIndex).toBeGreaterThan(bibIndex)
    expect(appendixIndex).toBeGreaterThan(citeIndex)
    // 引用条目落在参考文献样式里……
    expect(html.slice(bibIndex, appendixIndex)).toContain('class="ap-bibliography"')
    // ……附录标题之后的正文恢复成普通段落，不再套用参考文献样式。
    expect(html.slice(appendixIndex)).not.toContain('ap-bibliography')
  })

  it('keeps numbered-citation brackets literal instead of eating them as a link', () => {
    // 不转义的话，CommonMark 会把 "[1]" 解析成一个没有目标的引用链接，
    // 渲染时只剩标签文字——编号会无声消失，这是 GB/T 7714/IEEE 引用格式
    // 最常见的写法，值得单独锁死。
    const html = renderAcademicPreviewHtml('[1] 示例作者. 示例标题. 期刊, 2024.\n')
    expect(html).toContain('[1] 示例作者')
    expect(html).not.toContain('<a ')
  })

  it('recognizes English bibliography headings too', () => {
    const html = renderAcademicPreviewHtml('# Intro\n\nBody.\n\n## References\n\n[1] A ref.\n')
    expect(html.slice(html.indexOf('References'))).toContain('class="ap-bibliography"')
  })

  it('treats the paragraph right below a table as its caption', () => {
    const html = renderAcademicPreviewHtml(
      '| a |\n| --- |\n| 1 |\n\n表 1：说明文字\n\n后续正文。\n',
    )
    const afterTable = html.slice(html.indexOf('</table>'))
    expect(afterTable).toContain('class="ap-caption"')
    // 标题之后再往下的段落恢复成普通正文，"caption"状态不该一直延续。
    expect(afterTable.indexOf('class="ap-body"')).toBeGreaterThan(afterTable.indexOf('ap-caption'))
  })

  it('strips the clipboard-serializer inline styles so the preview stylesheet controls appearance', () => {
    const html = renderAcademicPreviewHtml('# 标题\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    expect(html).not.toContain('style=')
  })

  it('replaces images with a text placeholder instead of loading them', () => {
    const html = renderAcademicPreviewHtml('![示意图](./assets/diagram.png)\n')
    expect(html).not.toContain('<img')
    expect(html).toContain('[示意图]')
  })

  it('renders the frontmatter title as a title block and drops the frontmatter from the body', () => {
    const html = renderAcademicPreviewHtml('---\ntitle: 我的论文\n---\n\n# 引言\n\n正文。\n')
    expect(html).toContain('<p class="ap-title">我的论文</p>')
    expect(html).not.toContain('title: 我的论文')
  })

  it('has no title block when the document has no frontmatter title', () => {
    const html = renderAcademicPreviewHtml('# 引言\n\n正文。\n')
    expect(html).not.toContain('ap-title')
  })
})
