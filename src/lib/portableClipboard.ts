const INLINE_SEMANTIC_ELEMENTS = [
  ['.xmd-cm-strong', 'strong'],
  ['.xmd-cm-emphasis', 'em'],
  ['.xmd-cm-strikethrough', 'del'],
  ['.xmd-cm-inline-code', 'code'],
] as const

const BLOCK_WIDGET_SELECTOR = [
  '.xmd-cm-table-preview',
  '.xmd-cm-image-preview.is-block',
  '.xmd-cm-math-block',
  '.xmd-cm-mermaid-block',
].join(',')

function replaceTag(element: HTMLElement, tagName: string): HTMLElement {
  const replacement = element.ownerDocument.createElement(tagName)
  replacement.append(...Array.from(element.childNodes))
  element.replaceWith(replacement)
  return replacement
}

function portableHref(value: string): string | null {
  const href = value.trim()
  return /^(?:https?:|mailto:|#|\/|\.\.?\/)/i.test(href) ? href : null
}

function materializeLinks(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.xmd-cm-link[data-xmd-href]').forEach((element) => {
    const href = portableHref(element.dataset.xmdHref ?? '')
    if (!href) return
    const anchor = replaceTag(element, 'a') as HTMLAnchorElement
    anchor.href = href
  })

  root.querySelectorAll<HTMLElement>('.xmd-cm-table-inline-link').forEach((element) => {
    const suffix = element.dataset.xmdSuffix ?? ''
    const href = portableHref(/^\]\((\S+?)(?:\s+["'].*)?\)$/.exec(suffix)?.[1] ?? '')
    if (!href) return
    const anchor = replaceTag(element, 'a') as HTMLAnchorElement
    anchor.href = href
  })
}

function materializeInlineFormatting(root: HTMLElement): void {
  for (const [selector, tagName] of INLINE_SEMANTIC_ELEMENTS) {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      const replacement = replaceTag(element, tagName)
      if (tagName === 'code') {
        replacement.style.cssText =
          'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f2f3f5;padding:0.08em 0.28em;border-radius:4px'
      }
    })
  }
}

function materializeImagesAndTables(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.xmd-cm-image-preview').forEach((preview) => {
    const image = preview.querySelector<HTMLImageElement>('img')
    if (image) preview.replaceWith(image)
  })
  root.querySelectorAll<HTMLElement>('.xmd-cm-table-preview').forEach((preview) => {
    const table = preview.querySelector<HTMLTableElement>('table')
    if (!table) return
    table.style.borderCollapse = 'collapse'
    table.querySelectorAll<HTMLElement>('th, td').forEach((cell) => {
      cell.style.border = '1px solid #d0d7de'
      cell.style.padding = '6px 10px'
    })
    preview.replaceWith(table)
  })
}

function materializeCodeBlocks(root: HTMLElement): void {
  let current: HTMLPreElement | null = null
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || !child.classList.contains('xmd-cm-code-line')) {
      if (!(child instanceof HTMLElement) || !child.classList.contains('xmd-cm-code-fence-line')) {
        current = null
      }
      continue
    }
    if (!current) {
      current = child.ownerDocument.createElement('pre')
      current.style.cssText =
        'white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;padding:12px;border-radius:6px'
      current.append(child.ownerDocument.createElement('code'))
      child.before(current)
    }
    const code = current.querySelector('code')!
    if (code.childNodes.length > 0) code.append('\n')
    code.append(child.textContent ?? '')
    child.remove()
  }
  root
    .querySelectorAll<HTMLElement>('.cm-line.xmd-cm-code-fence-line')
    .forEach((line) => line.remove())
}

function materializeHeadingsAndRules(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.cm-line.xmd-cm-heading').forEach((line) => {
    const level = [1, 2, 3, 4, 5, 6].find((candidate) =>
      line.classList.contains(`xmd-cm-heading-${candidate}`),
    )
    if (!level) return
    const heading = replaceTag(line, `h${level}`)
    heading.style.cssText = `font-weight:700;font-size:${[2, 1.6, 1.3, 1.15, 1, 0.9][level - 1]}em`
  })
  root.querySelectorAll<HTMLElement>('.cm-line.xmd-cm-horizontal-rule').forEach((line) => {
    line.replaceWith(line.ownerDocument.createElement('hr'))
  })
}

function listKind(line: HTMLElement): { tag: 'ol' | 'ul'; depth: number } {
  const marker = line.querySelector<HTMLElement>('.xmd-cm-list-marker')
  const depth = Number.parseInt(marker?.style.getPropertyValue('--xmd-list-depth') ?? '0', 10)
  return {
    tag: /^\d/.test(marker?.textContent?.trim() ?? '') ? 'ol' : 'ul',
    depth: Number.isFinite(depth) ? Math.max(0, depth) : 0,
  }
}

function materializeLists(root: HTMLElement): void {
  let current: HTMLOListElement | HTMLUListElement | null = null
  let currentKey = ''
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || !child.classList.contains('xmd-cm-list-line')) {
      current = null
      currentKey = ''
      continue
    }
    const { tag, depth } = listKind(child)
    const key = `${tag}:${depth}`
    if (!current || currentKey !== key) {
      current = child.ownerDocument.createElement(tag)
      if (depth > 0) current.style.marginLeft = `${depth * 1.5}em`
      child.before(current)
      currentKey = key
    }
    child.querySelector('.xmd-cm-list-marker')?.remove()
    const task = child.querySelector<HTMLElement>('.xmd-cm-task-checkbox')
    if (task) {
      task.replaceWith(task.getAttribute('aria-checked') === 'true' ? '☑ ' : '☐ ')
    }
    const item = child.ownerDocument.createElement('li')
    item.append(...Array.from(child.childNodes))
    current.append(item)
    child.remove()
  }
}

function materializeBlockquotes(root: HTMLElement): void {
  let current: HTMLQuoteElement | null = null
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || !child.classList.contains('xmd-cm-blockquote')) {
      current = null
      continue
    }
    if (!current) {
      current = child.ownerDocument.createElement('blockquote')
      current.style.cssText = 'border-left:3px solid #d0d7de;margin-left:0;padding-left:12px'
      child.before(current)
    } else {
      current.append(child.ownerDocument.createElement('br'))
    }
    current.append(...Array.from(child.childNodes))
    child.remove()
  }
}

function materializeParagraphs(root: HTMLElement): void {
  let current: HTMLParagraphElement | null = null
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || !child.classList.contains('xmd-cm-paragraph')) {
      current = null
      continue
    }
    if (!current || child.classList.contains('xmd-cm-paragraph-first')) {
      current = child.ownerDocument.createElement('p')
      child.before(current)
    } else {
      current.append(child.ownerDocument.createElement('br'))
    }
    current.append(...Array.from(child.childNodes))
    const last = child.classList.contains('xmd-cm-paragraph-last')
    child.remove()
    if (last) current = null
  }
}

function materializeRemainingLines(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(':scope > .cm-line').forEach((line) => {
    if (line.querySelector(BLOCK_WIDGET_SELECTOR)) {
      line.replaceWith(...Array.from(line.childNodes))
      return
    }
    replaceTag(line, 'p')
  })
}

function stripEditorOnlySpans(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('span').forEach((span) => {
    if (span.closest('.katex, .xmd-cm-math, .xmd-cm-mermaid-block, svg')) return
    if (span.hasAttribute('style')) {
      span.removeAttribute('class')
      return
    }
    span.replaceWith(...Array.from(span.childNodes))
  })
}

/** Convert CM6's class-driven preview DOM into compact, portable clipboard HTML. */
export function materializePortableClipboard(root: HTMLElement): void {
  materializeLinks(root)
  materializeInlineFormatting(root)
  materializeImagesAndTables(root)
  materializeCodeBlocks(root)
  materializeHeadingsAndRules(root)
  materializeLists(root)
  materializeBlockquotes(root)
  materializeParagraphs(root)
  materializeRemainingLines(root)
  stripEditorOnlySpans(root)
}

function portableText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof HTMLElement)) {
    return Array.from(node.childNodes, portableText).join('')
  }
  if (node instanceof HTMLImageElement) return node.alt
  if (node.tagName === 'BR') return '\n'
  if (node.tagName === 'TABLE') {
    return Array.from(node.querySelectorAll('tr'), (row) =>
      Array.from(row.querySelectorAll(':scope > th, :scope > td'), portableText).join('\t'),
    ).join('\n')
  }
  if (node.tagName === 'UL' || node.tagName === 'OL') {
    const ordered = node.tagName === 'OL'
    return Array.from(node.children)
      .filter((child) => child.tagName === 'LI')
      .map((item, index) => `${ordered ? `${index + 1}.` : '•'} ${portableText(item)}`)
      .join('\n')
  }
  const content = Array.from(node.childNodes, portableText).join('')
  return ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'HR'].includes(
    node.tagName,
  )
    ? `${content}\n`
    : content
}

export function portableClipboardText(root: HTMLElement): string {
  return portableText(root)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
