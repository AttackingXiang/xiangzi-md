import { history } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { computeCm6ToolbarState } from './toolbarState'

function stateAt(doc: string, needle: string, offset = 0): EditorState {
  const position = doc.indexOf(needle)
  if (position < 0) throw new Error(`Missing test needle: ${needle}`)
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(position + offset),
    extensions: [markdown(), history()],
  })
}

describe('CM6 toolbar state', () => {
  it('derives inline Markdown marks around the cursor', () => {
    const doc = '**bold** *italic* ~~strike~~ `code` [link](https://example.com)'
    expect(computeCm6ToolbarState(stateAt(doc, 'bold', 2)).bold).toBe(true)
    expect(computeCm6ToolbarState(stateAt(doc, 'italic', 3)).italic).toBe(true)
    expect(computeCm6ToolbarState(stateAt(doc, 'strike', 3)).strike).toBe(true)
    expect(computeCm6ToolbarState(stateAt(doc, 'code', 2)).inlineCode).toBe(true)
    expect(computeCm6ToolbarState(stateAt(doc, 'link', 2)).link).toBe(true)
  })

  it('derives heading, quote and list context', () => {
    expect(computeCm6ToolbarState(stateAt('### Heading', 'Heading')).headingLevel).toBe(3)
    expect(computeCm6ToolbarState(stateAt('> quote', 'quote')).blockquote).toBe(true)
    expect(computeCm6ToolbarState(stateAt('- bullet', 'bullet')).bulletList).toBe(true)
    expect(computeCm6ToolbarState(stateAt('2. ordered', 'ordered')).orderedList).toBe(true)
    expect(computeCm6ToolbarState(stateAt('  - [x] task', 'task')).taskList).toBe(true)
  })

  it('derives fenced code context', () => {
    const state = stateAt('```ts\nconst value = 1\n```', 'value')
    expect(computeCm6ToolbarState(state).codeBlock).toBe(true)
  })

  it('derives history availability from CM6 history', () => {
    const initial = EditorState.create({ doc: 'a', extensions: [markdown(), history()] })
    const changed = initial.update({ changes: { from: 1, insert: 'b' } }).state
    expect(computeCm6ToolbarState(initial).canUndo).toBe(false)
    expect(computeCm6ToolbarState(changed).canUndo).toBe(true)
  })
})
