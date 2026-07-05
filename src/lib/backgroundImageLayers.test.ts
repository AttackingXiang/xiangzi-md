import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 背景图由 .app 承载，标题栏与工作区各叠一次相同的可读性表面；工作区内部
// 各区域必须透明，
// 否则正文、侧栏和状态栏会再次叠色，重新出现“预览区多一层”的视觉断层。
const TRANSPARENT_LAYERS = [
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
  it('keeps the image and shared surface token on the app root', () => {
    const foundation = readCss('../styles/slices/foundation.css')
    expect(extractBlock(foundation, '.app')).toMatch(/--bg-image/)
    expect(extractBlock(foundation, '.app')).toMatch(/--bg-image-shade/)
    expect(extractBlock(foundation, '.workspace-shell')).toMatch(/--workspace-surface/)
  })

  it.each(TRANSPARENT_LAYERS)('$selector stays transparent', ({ file, selector }) => {
    const css = readCss(file)
    const block = extractBlock(css, selector)
    expect(block).toMatch(/background:\s*transparent/)
  })

  it('keeps the custom title bar on the same app surface', () => {
    const css = readCss('../styles/slices/titlebar.css')
    expect(extractBlock(css, '.titlebar')).toMatch(/background:\s*var\(--workspace-surface\)/)
  })

  it('keeps the sidebar height chain constrained so the tree scrolls on both axes', () => {
    const css = readCss('../styles/slices/sidebar.css')
    expect(extractBlock(css, '.sidebar-wrap')).toMatch(/min-height:\s*0/)
    expect(extractBlock(css, '.sidebar-wrap')).toMatch(/overflow:\s*hidden/)
    expect(extractBlock(css, '.sidebar')).toMatch(/min-height:\s*0/)
    expect(extractBlock(css, '.sidebar')).toMatch(/overflow:\s*hidden/)

    const body = extractBlock(css, '.sidebar-body')
    expect(body).toMatch(/flex:\s*1 1 0/)
    expect(body).toMatch(/height:\s*0/)
    expect(body).toMatch(/overflow:\s*auto/)
  })
})
