// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { materializePortableClipboard, portableClipboardText } from './portableClipboard'

function materialize(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  materializePortableClipboard(root)
  return root
}

describe('materializePortableClipboard', () => {
  it('converts heading lines to semantic hN elements with inline sizing', () => {
    const root = materialize('<div class="cm-line xmd-cm-heading xmd-cm-heading-2">Title</div>')
    const heading = root.querySelector('h2')
    expect(heading?.textContent).toBe('Title')
    expect(heading?.getAttribute('style')).toContain('font-weight: 700')
  })

  it('converts a horizontal rule line to an <hr>', () => {
    const root = materialize('<div class="cm-line xmd-cm-horizontal-rule"></div>')
    expect(root.querySelector('hr')).not.toBeNull()
  })

  it('turns a link span with a valid href into an anchor', () => {
    const root = materialize(
      '<span class="xmd-cm-link" data-xmd-href="https://example.com">click</span>',
    )
    const anchor = root.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.com')
    expect(anchor?.textContent).toBe('click')
  })

  it('leaves a link span alone when the href is not safe', () => {
    const root = materialize(
      '<span class="xmd-cm-link" data-xmd-href="javascript:alert(1)">bad</span>',
    )
    expect(root.querySelector('a')).toBeNull()
  })

  it('resolves a table inline link suffix into an anchor', () => {
    const root = document.createElement('div')
    const span = document.createElement('span')
    span.className = 'xmd-cm-table-inline-link'
    span.dataset.xmdSuffix = '](/docs)'
    span.textContent = 'text'
    root.append(span)
    materializePortableClipboard(root)
    const anchor = root.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('/docs')
  })

  it('materializes inline strong/emphasis/strikethrough/code spans', () => {
    const root = materialize(
      '<span class="xmd-cm-strong">b</span>' +
        '<span class="xmd-cm-emphasis">i</span>' +
        '<span class="xmd-cm-strikethrough">s</span>' +
        '<span class="xmd-cm-inline-code">c</span>',
    )
    expect(root.querySelector('strong')?.textContent).toBe('b')
    expect(root.querySelector('em')?.textContent).toBe('i')
    expect(root.querySelector('del')?.textContent).toBe('s')
    const code = root.querySelector('code')
    expect(code?.textContent).toBe('c')
    expect(code?.getAttribute('style')).toContain('background: #f2f3f5')
  })

  it('unwraps an image preview to its inner <img>', () => {
    const root = materialize('<span class="xmd-cm-image-preview"><img src="a.png" alt="a"></span>')
    expect(root.querySelector('.xmd-cm-image-preview')).toBeNull()
    expect(root.querySelector('img')?.getAttribute('src')).toBe('a.png')
  })

  it('unwraps a table preview to its inner <table> with borders applied', () => {
    const root = materialize(
      '<div class="xmd-cm-table-preview"><table><tr><th>H</th></tr><tr><td>D</td></tr></table></div>',
    )
    const table = root.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.style.borderCollapse).toBe('collapse')
    expect(table?.querySelector('th')?.style.border).toBe('1px solid #d0d7de')
  })

  it('merges consecutive code-line rows into one <pre><code> block', () => {
    const root = materialize(
      '<div class="cm-line xmd-cm-code-fence-line"></div>' +
        '<div class="cm-line xmd-cm-code-line">line one</div>' +
        '<div class="cm-line xmd-cm-code-line">line two</div>' +
        '<div class="cm-line xmd-cm-code-fence-line"></div>',
    )
    const code = root.querySelector('pre > code')
    expect(code?.textContent).toBe('line one\nline two')
    expect(root.querySelector('.xmd-cm-code-fence-line')).toBeNull()
  })

  it('groups list lines by ordered/unordered kind and nesting depth', () => {
    const root = materialize(
      '<div class="cm-line xmd-cm-list-line">' +
        '<span class="xmd-cm-list-marker" style="--xmd-list-depth:0">•</span>first</div>' +
        '<div class="cm-line xmd-cm-list-line">' +
        '<span class="xmd-cm-list-marker" style="--xmd-list-depth:0">1.</span>second</div>',
    )
    const ul = root.querySelector('ul')
    const ol = root.querySelector('ol')
    expect(ul?.querySelector('li')?.textContent).toBe('first')
    expect(ol?.querySelector('li')?.textContent).toBe('second')
  })

  it('renders a checked task marker as a checked box and drops the widget', () => {
    const root = materialize(
      '<div class="cm-line xmd-cm-list-line">' +
        '<span class="xmd-cm-list-marker" style="--xmd-list-depth:0">•</span>' +
        '<span class="xmd-cm-task-checkbox" aria-checked="true"></span>done</div>',
    )
    expect(root.querySelector('li')?.textContent).toBe('☑ done')
  })

  it('renders an unchecked task marker as an empty box', () => {
    const root = materialize(
      '<div class="cm-line xmd-cm-list-line">' +
        '<span class="xmd-cm-list-marker" style="--xmd-list-depth:0">•</span>' +
        '<span class="xmd-cm-task-checkbox" aria-checked="false"></span>todo</div>',
    )
    expect(root.querySelector('li')?.textContent).toBe('☐ todo')
  })

  it('joins multi-line blockquotes into one <blockquote> with <br> separators', () => {
    const root = materialize(
      '<div class="cm-line xmd-cm-blockquote">first</div>' +
        '<div class="cm-line xmd-cm-blockquote">second</div>',
    )
    const quote = root.querySelector('blockquote')
    expect(quote?.querySelectorAll('br')).toHaveLength(1)
    expect(quote?.textContent).toBe('firstsecond')
  })

  it('joins a soft-wrapped paragraph into one <p> using the first/last markers', () => {
    const root = materialize(
      '<div class="cm-line xmd-cm-paragraph xmd-cm-paragraph-first">first</div>' +
        '<div class="cm-line xmd-cm-paragraph xmd-cm-paragraph-last">second</div>',
    )
    const paragraphs = root.querySelectorAll('p')
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].querySelectorAll('br')).toHaveLength(1)
  })

  it('starts a new paragraph once a "first" marker reappears', () => {
    const root = materialize(
      '<div class="cm-line xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last">a</div>' +
        '<div class="cm-line xmd-cm-paragraph xmd-cm-paragraph-first xmd-cm-paragraph-last">b</div>',
    )
    expect(root.querySelectorAll('p')).toHaveLength(2)
  })

  it('wraps an unrecognized top-level line in a plain <p>', () => {
    const root = materialize('<div class="cm-line">plain</div>')
    expect(root.querySelector('p')?.textContent).toBe('plain')
  })

  it('unwraps a remaining line that only contains a block widget', () => {
    const root = materialize('<div class="cm-line"><div class="xmd-cm-math-block">x=1</div></div>')
    expect(root.querySelector('.xmd-cm-math-block')).not.toBeNull()
    expect(root.querySelector('p')).toBeNull()
  })

  it('drops the class but keeps the style on a span with inline styling', () => {
    const root = materialize('<span class="xmd-cm-inline-color" style="color:red">x</span>')
    const span = root.querySelector('span')
    expect(span?.getAttribute('class')).toBeNull()
    expect(span?.getAttribute('style')).toBe('color:red')
  })

  it('unwraps a bare styling-free span, keeping its text', () => {
    const root = materialize('<span class="xmd-cm-marker">x</span>')
    expect(root.querySelector('span')).toBeNull()
    expect(root.textContent).toBe('x')
  })

  it('preserves spans inside katex/mermaid/svg content even without inline style', () => {
    const root = materialize('<span class="katex"><span>x</span></span>')
    expect(root.querySelectorAll('span')).toHaveLength(2)
  })
})

describe('portableClipboardText', () => {
  it('renders an image as its alt text', () => {
    const root = document.createElement('div')
    root.innerHTML = '<img src="a.png" alt="a photo">'
    expect(portableClipboardText(root)).toBe('a photo')
  })

  it('renders a table as tab/newline separated cells', () => {
    const root = document.createElement('div')
    root.innerHTML = '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    expect(portableClipboardText(root)).toBe('A\tB\n1\t2')
  })

  it('renders unordered and ordered lists with bullets/numbers', () => {
    const root = document.createElement('div')
    root.innerHTML = '<ul><li>a</li><li>b</li></ul>'
    expect(portableClipboardText(root)).toBe('• a\n• b')
    root.innerHTML = '<ol><li>a</li><li>b</li></ol>'
    expect(portableClipboardText(root)).toBe('1. a\n2. b')
  })

  it('separates block-level elements with trailing newlines and collapses excess blank lines', () => {
    const root = document.createElement('div')
    root.innerHTML = '<h1>Title</h1><p>one</p><p><br><br><br></p><p>two</p>'
    expect(portableClipboardText(root)).toBe('Title\none\n\ntwo')
  })
})
