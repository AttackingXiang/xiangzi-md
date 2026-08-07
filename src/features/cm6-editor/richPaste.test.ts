import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { prepareMarkdownPaste } from './richPaste'

function stateAt(doc: string, position: number): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(position),
    extensions: [markdown()],
  })
}

function applyPaste(state: EditorState, pasted: string): EditorState {
  const plan = prepareMarkdownPaste(state, pasted)
  return state.update({ changes: plan.changes, selection: plan.selection }).state
}

describe('Markdown code-block paste', () => {
  it('marks an empty text code block when the pasted snippet is recognized', () => {
    const doc = '```\n\n```'
    const state = stateAt(doc, doc.indexOf('\n\n') + 1)
    const plan = prepareMarkdownPaste(state, 'const value = 1')

    expect(plan.detectedLanguage).toBe('JavaScript')
    expect(applyPaste(state, 'const value = 1').doc.toString()).toBe(
      '```javascript\nconst value = 1\n```',
    )
  })

  it('keeps text when the snippet is not recognized', () => {
    const doc = '```\n\n```'
    const state = stateAt(doc, doc.indexOf('\n\n') + 1)

    expect(prepareMarkdownPaste(state, 'A short note.').detectedLanguage).toBeNull()
    expect(applyPaste(state, 'A short note.').doc.toString()).toBe('```\nA short note.\n```')
  })

  it('does not replace an existing code-block language', () => {
    const doc = '```python\n\n```'
    const state = stateAt(doc, doc.indexOf('\n\n') + 1)

    expect(prepareMarkdownPaste(state, 'const value = 1').detectedLanguage).toBeNull()
    expect(applyPaste(state, 'const value = 1').doc.toString()).toBe(
      '```python\nconst value = 1\n```',
    )
  })

  it('also detects a language when the empty block is explicitly text', () => {
    const doc = '```text\n\n```'
    const state = stateAt(doc, doc.indexOf('\n\n') + 1)

    expect(applyPaste(state, 'SELECT id FROM users;').doc.toString()).toBe(
      '```sql\nSELECT id FROM users;\n```',
    )
  })
})
