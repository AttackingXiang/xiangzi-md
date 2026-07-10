import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('slash menu selection styles', () => {
  it('does not give native pointer hover the keyboard selection appearance', () => {
    const css = readFileSync(new URL('../styles/slices/drafts-crepe.css', import.meta.url), 'utf8')
    const itemHoverRule = /\.menu-group li:hover\s*(?:svg)?\s*\{/g
    expect(css.match(itemHoverRule)).toBeNull()
  })
})
