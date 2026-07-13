import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import {
  decodeMarkdownDestination,
  markdownReferenceDefinitions,
  normalizeMarkdownReferenceLabel,
  resolveMarkdownReference,
} from './markdownReferences'

function stateFor(doc: string): EditorState {
  return EditorState.create({ doc, extensions: markdown({ extensions: GFM }) })
}

describe('Markdown reference definitions', () => {
  it('normalizes case, whitespace, escapes and entities', () => {
    expect(normalizeMarkdownReferenceLabel(' Foo\\*  BAR&amp; ')).toBe('foo* bar&')
    expect(decodeMarkdownDestination('<assets/my image.png>')).toBe('assets/my image.png')
  })

  it('indexes the first definition and decodes destination/title text', () => {
    const state = stateFor(
      ['[Foo  Bar]: <assets/my image.png> "A &amp; B"', '[foo bar]: ignored.png'].join('\n'),
    )
    const definition = markdownReferenceDefinitions(state).get('foo bar')

    expect(definition).toMatchObject({
      destination: 'assets/my image.png',
      title: 'A & B',
    })
  })

  it('resolves full, collapsed and shortcut labels through one index', () => {
    const state = stateFor('[Target]: image.png')
    expect(resolveMarkdownReference(state, 'target', 'alt')?.destination).toBe('image.png')
    expect(resolveMarkdownReference(state, '', 'TARGET')?.destination).toBe('image.png')
    expect(resolveMarkdownReference(state, null, 'Target')?.destination).toBe('image.png')
  })
})
