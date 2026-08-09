import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISIBLE_TEXT_EXTENSIONS,
  isKnownTextFile,
  isMarkdownFile,
  MARKDOWN_EXTENSIONS,
  OPENABLE_DOCUMENT_EXTENSIONS,
  saveDialogExtensions,
} from './fileCapabilities'

function rustExtensions(constant: string): string[] {
  const source = readFileSync(
    new URL('../../src-tauri/src/infrastructure/file_capabilities.rs', import.meta.url),
    'utf8',
  )
  const body = source.match(new RegExp(`const ${constant}: &\\[&str\\] = &\\[(.*?)\\];`, 's'))?.[1]
  if (!body) throw new Error(`Rust file capability constant not found: ${constant}`)
  return Array.from(body.matchAll(/"([^"]+)"/g), (match) => match[1])
}

describe('file capability manifest', () => {
  it('drives Markdown and text opening from the same extension set', () => {
    expect(isMarkdownFile('README.MDX')).toBe(true)
    expect(isKnownTextFile('config.JSON')).toBe(true)
    expect(isKnownTextFile('LICENSE')).toBe(true)
    expect(isKnownTextFile('.env')).toBe(false)
    expect(isKnownTextFile('photo.png')).toBe(false)
    expect(OPENABLE_DOCUMENT_EXTENSIONS).toContain('tsx')
    expect(DEFAULT_VISIBLE_TEXT_EXTENSIONS).toContain('log')
  })

  it('preserves the current Save As type without forcing an extension', () => {
    expect(saveDialogExtensions('notes.MD')).toEqual(['md'])
    expect(saveDialogExtensions('LICENSE')).toEqual([])
  })

  it('keeps the frontend and native manifests in lockstep', () => {
    expect(rustExtensions('MARKDOWN_EXTENSIONS')).toEqual([...MARKDOWN_EXTENSIONS])
    expect(rustExtensions('TEXT_EXTENSIONS')).toEqual(DEFAULT_VISIBLE_TEXT_EXTENSIONS)
  })
})
