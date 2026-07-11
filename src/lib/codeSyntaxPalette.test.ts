import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CODE_PALETTE_CSS_VARS, type ThemeName } from './codeSyntaxPalette'

// foundation.css is the single source of truth for every theme's colors (see
// codeSyntaxPalette.ts doc comment). This test makes sure adding a theme block
// there can't silently miss a variable that the other 5 themes define — a
// typo or omission here would otherwise only surface as a wrong color deep in
// a specific theme, easy to miss in review.
const foundationCssPath = fileURLToPath(new URL('../styles/slices/foundation.css', import.meta.url))
const css = readFileSync(foundationCssPath, 'utf-8')

const THEME_SELECTORS: Record<ThemeName, string> = {
  light: ':root',
  dark: "[data-theme='dark']",
  warm: "[data-theme='warm']",
  mint: "[data-theme='mint']",
  blue: "[data-theme='blue']",
  summer: "[data-theme='summer']",
  sakura: "[data-theme='sakura']",
}

function extractBlock(selector: string): string {
  const escaped = selector.replace(/[[\]']/g, (c) => `\\${c}`)
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`selector not found in foundation.css: ${selector}`)
  return match[1]
}

function readVar(block: string, cssVar: string): string | null {
  const match = block.match(new RegExp(`--${cssVar}:\\s*([^;]+);`))
  return match ? match[1].trim() : null
}

// 静态代码块卡片专用色板（见 foundation.css 顶部注释），与语法色板并列，
// 同样要求 6 个主题各自补齐一份，否则新主题的代码块会漏用旧主题背景色。
const CODE_CARD_VARS = [
  'code-card-bg',
  'code-card-border',
  'code-header-bg',
  'code-lang-color',
  'code-lang-hover-color',
  'code-btn-color',
  'code-btn-hover-color',
  'code-btn-hover-bg',
  'code-text',
  'code-selection-bg',
  'code-inline-text',
]

// Mermaid 流程图节点配色，见 mermaidPreview.ts 的 mermaidThemeVariables()。
const DIAGRAM_VARS = ['diagram-node-bg', 'diagram-node-border']

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\))$/i

const themeNames = Object.keys(THEME_SELECTORS) as ThemeName[]

describe('foundation.css theme palettes', () => {
  it.each(themeNames)('%s defines every semantic code syntax variable', (theme) => {
    const block = extractBlock(THEME_SELECTORS[theme])
    for (const cssVar of Object.values(CODE_PALETTE_CSS_VARS)) {
      const value = readVar(block, cssVar)
      expect(value, `--${cssVar} missing in ${THEME_SELECTORS[theme]}`).not.toBeNull()
      expect(value).toMatch(COLOR_VALUE)
    }
  })

  it.each(themeNames)('%s defines every code card variable', (theme) => {
    const block = extractBlock(THEME_SELECTORS[theme])
    for (const cssVar of CODE_CARD_VARS) {
      const value = readVar(block, cssVar)
      expect(value, `--${cssVar} missing in ${THEME_SELECTORS[theme]}`).not.toBeNull()
      expect(value).toMatch(COLOR_VALUE)
    }
  })

  it.each(themeNames)('%s defines the mermaid diagram node colors', (theme) => {
    const block = extractBlock(THEME_SELECTORS[theme])
    for (const cssVar of DIAGRAM_VARS) {
      const value = readVar(block, cssVar)
      expect(value, `--${cssVar} missing in ${THEME_SELECTORS[theme]}`).not.toBeNull()
      expect(value).toMatch(COLOR_VALUE)
    }
  })
})
