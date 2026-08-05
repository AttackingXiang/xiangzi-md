import type { AcademicLayout, PaperSize } from '../platform/contracts'
import { DEFAULT_CLIPBOARD_FORMATTING } from './clipboardFormatting'
import { markdownToPortableHtml } from './markdownClipboard'
import { parseMarkdownFrontmatter } from '../features/tags/frontmatter'

/**
 * 论文排版设置页的"实时预览"：把用户正在编辑的真实文档渲染成一份近似的
 * 排版效果，随每次调整参数即时刷新。
 *
 * 这不是要在浏览器里像素级复刻 Word 的排版引擎——那需要一个真正的版式
 * 渲染器。这里换了个便宜得多、但对"调参数、看变化"这个任务同样有效的
 * 思路：把 Markdown 转成打了语义 class 的 HTML，样式表用 CSS 原生的 pt/mm/em
 * 单位，直接对应 Word 里的磅/毫米/字符——不需要任何换算，浏览器自己把
 * pt 换算成屏幕像素。字号、行距、缩进、页边距四个最常被调的参数，观感和
 * 真实 Word 渲染是一致的；无法在这里体现的（分页、页眉页脚的真实排布、
 * 三线表的确切线宽）留给「在 Word 中预览」按钮，那条路径导出的是货真价实
 * 会被 pandoc 处理的 docx。
 */

const PAPER_WIDTH_MM: Record<PaperSize, number> = {
  a4: 210,
  letter: 215.9,
}

/**
 * 把排版参数换算成一组 CSS 自定义属性，通过内联 `style` 挂在预览容器上；
 * academic-preview.css 里的规则读取这些变量。
 *
 * 与 Rust 那份换算刻意不同：那边要精确对应 OOXML 的半磅/缇整数单位，这里
 * CSS 原生支持 pt/mm，而行距在 CSS 里本来就是"当前字号的倍数"（`line-height`
 * 不带单位时的语义），跟 Word 的"倍数行距"是同一个概念，不需要任何转换。
 */
export function academicPreviewCssVars(layout: AcademicLayout): Record<string, string> {
  const [h1, h2, h3, h4, h5, h6] = layout.headingFontPt
  return {
    '--ap-page-width': `${PAPER_WIDTH_MM[layout.paper]}mm`,
    '--ap-margin': `${layout.marginMm}mm`,
    '--ap-body-size': `${layout.bodyFontPt}pt`,
    '--ap-line-height': `${layout.bodyLineHeight}`,
    '--ap-indent': `${layout.firstLineIndentChars}em`,
    '--ap-title-size': `${layout.titleFontPt}pt`,
    '--ap-h1-size': `${h1}pt`,
    '--ap-h2-size': `${h2}pt`,
    '--ap-h3-size': `${h3}pt`,
    '--ap-h4-size': `${h4}pt`,
    '--ap-h5-size': `${h5}pt`,
    '--ap-h6-size': `${h6}pt`,
    '--ap-caption-size': `${layout.captionFontPt}pt`,
    '--ap-bib-size': `${layout.bibliographyFontPt}pt`,
  }
}

/** 常见的"参考文献"标题写法；命中后，直到下一个同级或更高级标题为止的
 * 段落都按参考文献样式渲染。这是一个近似——真正的 pandoc 参考文献列表
 * 来自 citeproc 处理引用文献库，不是从标题文字猜的，但大多数人手写的
 * 参考文献就是"一个标题 + 一堆段落"，这个启发式对这类写法是准确的。 */
const BIBLIOGRAPHY_HEADINGS = new Set([
  '参考文献',
  '引用文献',
  'references',
  'bibliography',
  'works cited',
])

function isBibliographyHeading(text: string): boolean {
  return BIBLIOGRAPHY_HEADINGS.has(text.trim().toLowerCase())
}

/**
 * GB/T 7714 / IEEE 风格的编号引用（行首「[1] 作者……」）在 CommonMark 里会被
 * 解析成一个没有目标的"快捷引用链接"，渲染时只留下标签文字、丢掉方括号——
 * 这是标准 Markdown 行为，但对写惯这种引用格式的人（尤其是中文学术写作）
 * 来说，编号无声消失会被当成预览坏了。转义成 `\[1\]` 让它保持字面量。
 *
 * 只在这个预览模块里做，不改 markdownToPortableHtml 本身：那个函数被剪贴板
 * 复制功能共用，如果那边也有同样的观感问题，值得单独审查，不该在这里顺带改。
 */
function escapeNumberedCitationBrackets(markdown: string): string {
  return markdown.replace(/^(\s{0,3})\[(\d{1,3})\]/gm, '$1\\[$2\\]')
}

/**
 * 把 Markdown 渲染成带论文排版语义 class 的 HTML 片段。
 *
 * 复用 markdownToPortableHtml 而不是重写一个解析器：它已经正确处理了
 * GFM 表格、任务列表、安全的链接协议、转义等一整套细节。这里只做两件事：
 * 剥掉它为剪贴板场景写死的行内样式（字号是 em 相对值、表格是浅灰细线，
 * 都跟论文排版无关），再按"标题之后的第一段/参考文献标题之后"这类位置
 * 规则贴上语义 class。
 */
export function renderAcademicPreviewHtml(markdown: string): string {
  const frontmatter = parseMarkdownFrontmatter(markdown)
  const raw = markdownToPortableHtml(
    escapeNumberedCitationBrackets(frontmatter.body),
    DEFAULT_CLIPBOARD_FORMATTING,
  )
  const wrapper = new DOMParser().parseFromString(`<div>${raw}</div>`, 'text/html').body
    .firstElementChild
  if (!wrapper) return ''

  // 文档开头视为紧跟在一个"隐形标题"之后：第一段默认不缩进，这是常见的
  // 排版惯例，也是 pandoc 对文档/小节开头第一段的处理方式。
  let previousWasHeading = true
  let previousWasTable = false
  let inBibliography = false
  let bibliographyLevel = 0

  for (const element of Array.from(wrapper.children)) {
    element.removeAttribute('style')
    element.querySelectorAll('[style]').forEach((child) => child.removeAttribute('style'))

    const headingLevel = /^H([1-6])$/.exec(element.tagName)?.[1]
    if (headingLevel) {
      const level = Number(headingLevel)
      if (isBibliographyHeading(element.textContent ?? '')) {
        inBibliography = true
        bibliographyLevel = level
      } else if (inBibliography && level <= bibliographyLevel) {
        inBibliography = false
      }
      element.classList.add(`ap-heading-${level}`)
      previousWasHeading = true
      previousWasTable = false
      continue
    }

    // 表格正下方紧跟的一段短文字，按中文论文的通行惯例当表格标题处理——
    // 图注同理该出现在图片下方，但预览里图片已经变成占位文字，标出它的
    // "标题"意义不大，这里只覆盖表格这一种最常见的情况。
    if (element.tagName === 'P' && previousWasTable) {
      element.classList.add('ap-caption')
      previousWasHeading = false
      previousWasTable = false
      continue
    }

    applyBodyRole(element, previousWasHeading, inBibliography)
    // <pre>（代码块）、<hr> 等：论文排版参数不覆盖它们，保持默认渲染，但仍要
    // 清掉"上一个是标题"的状态——紧随其后的段落不该被当成小节起始段。
    previousWasHeading = false
    previousWasTable = element.tagName === 'TABLE'
  }

  replaceImagesWithPlaceholders(wrapper)
  return (frontmatter.title ? titleBlockHtml(frontmatter.title) : '') + wrapper.innerHTML
}

function applyBodyRole(
  element: Element,
  previousWasHeading: boolean,
  inBibliography: boolean,
): void {
  switch (element.tagName) {
    case 'P':
      element.classList.add(
        inBibliography ? 'ap-bibliography' : previousWasHeading ? 'ap-first-paragraph' : 'ap-body',
      )
      return
    case 'BLOCKQUOTE':
      element.classList.add('ap-blockquote')
      return
    case 'TABLE':
      element.classList.add('ap-table')
      return
    case 'UL':
    case 'OL':
      element.classList.add('ap-list')
      return
    default:
      return
  }
}

function replaceImagesWithPlaceholders(root: Element): void {
  // 预览环境里图片的相对路径解析不出真实文件，硬渲染只会得到一堆裂图图标，
  // 还可能对外发出网络请求（远程图片）——一个设置面板不该做这些事。
  root.querySelectorAll('img').forEach((img) => {
    const alt = img.getAttribute('alt')?.trim()
    const placeholder = root.ownerDocument.createElement('span')
    placeholder.className = 'ap-image-placeholder'
    placeholder.textContent = `[${alt || '图片'}]`
    img.replaceWith(placeholder)
  })
}

function titleBlockHtml(title: string): string {
  const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<p class="ap-title">${escaped}</p>`
}

/** 没有可预览的真实文档时（未打开文件、当前不是 Markdown）展示的样张，
 * 覆盖每一个可调项对应的排版角色，让用户即使还没写文档也能看到效果。 */
export const ACADEMIC_PREVIEW_SAMPLE = `---
title: 论文标题示例
---

# 引言

这是引言部分的第一段，紧跟在标题之后，按惯例不做首行缩进。

这是第二段正文，展示默认的首行缩进与行距。**加粗**、*斜体*和\`行内代码\`在正文里穿插出现，用来确认这些强调样式不会被排版参数意外覆盖。

## 相关工作

二级标题下的段落同样遵循首段不缩进、后续段落缩进的规则。

> 这是一段引用，用来检查块引用在论文排版下的呈现效果。

| 方法 | 准确率 |
| --- | --- |
| 基线 | 82.3% |
| 本文方法 | 91.7% |

表格标题：不同方法的准确率对比。

## 参考文献

[1] 示例作者. 示例文献标题. 示例期刊, 2024.

[2] Another Author. An Example Reference. Example Journal, 2023.
`
