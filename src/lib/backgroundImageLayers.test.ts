import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 背景图片能不能透出来，取决于 html 与正文之间的每一层容器背景是否都跟着
// --bg-image-shade 变透明——之前 .editor-area 独立铺了一层不透明 var(--bg)，
// 图片再怎么调都透不上来，且这个 bug 在 CSS 里悄无声息、不会报错。这里把
// "html 到编辑器正文之间的关键容器都必须引用 --bg-image-shade" 固化成测试，
// 避免以后新加一层不透明背景又把图片盖住。
const LAYERS = [
  {
    file: '../styles/slices/foundation.css',
    selector: 'html',
  },
  {
    file: '../styles/slices/workspace.css',
    selector: '.tabbar',
  },
  {
    file: '../styles/slices/workspace.css',
    selector: '.editor-area',
  },
  {
    file: '../styles/slices/sidebar.css',
    selector: '.sidebar',
  },
  {
    file: '../styles/slices/editor-typography.css',
    selector: '.wysiwyg-editor .milkdown',
  },
  {
    file: '../styles/slices/workspace.css',
    selector: '.source-editor',
  },
  {
    file: '../styles/slices/workspace.css',
    selector: '.outline',
  },
]

function readCss(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf-8')
}

function extractBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.[\]]/g, (c) => `\\${c}`)
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`selector not found: ${selector}`)
  return match[1]
}

describe('background image layers stay transparent-capable', () => {
  it.each(LAYERS)('$selector references --bg-image-shade or --bg-image', ({ file, selector }) => {
    const css = readCss(file)
    const block = extractBlock(css, selector)
    expect(block).toMatch(/--bg-image(-shade)?/)
  })
})
