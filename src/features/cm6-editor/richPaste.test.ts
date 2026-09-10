// @vitest-environment happy-dom
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { clipboardTextForSelection, prepareMarkdownPaste, richMarkdownPaste } from './richPaste'
import { embedMarkdownSourceInClipboardHtml } from '../../lib/markdownPaste'

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
  const literal = String.raw`sample\*\~value!$x#2\@X`

  it('routes a real DOM paste event through the literal boundary', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '```text\n\n```',
        selection: EditorSelection.cursor(8),
        extensions: [markdown(), richMarkdownPaste()],
      }),
    })
    try {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: {
          files: [],
          getData: (type: string) =>
            type === 'text/plain' ? literal : type === 'text/html' ? `<b>${literal}</b>` : '',
        },
      })
      view.contentDOM.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(view.state.doc.toString()).toBe('```text\n' + literal + '\n```')
    } finally {
      view.destroy()
      parent.remove()
    }
  })

  it.each(['```text\n\n```', '~~~text\n\n~~~', '```text\n', '```mermaid\n\n```'])(
    'preserves clipboard characters in a fenced body: %s',
    (doc) => {
      const state = stateAt(doc, doc.indexOf('\n') + 1)
      const pasted = clipboardTextForSelection(state, {
        text: literal,
        html: `<p>${literal}</p>`,
      })!
      expect(pasted).toBe(literal)
      const saved = applyPaste(state, pasted).doc.toString()
      const reopened = stateAt(saved, saved.indexOf('\n') + 1)
      expect(reopened.doc.line(2).text).toBe(literal)
    },
  )

  it.each(['`abc`', '    abc'])('keeps inline and indented code literal: %s', (doc) => {
    expect(
      clipboardTextForSelection(stateAt(doc, doc.indexOf('b')), {
        text: literal,
        html: `<strong>${literal}</strong>`,
      }),
    ).toBe(literal)
  })

  it('does not insert embedded Markdown source into code', () => {
    const html = embedMarkdownSourceInClipboardHtml('<b>visible</b>', '**visible**')
    expect(
      clipboardTextForSelection(stateAt('```\n\n```', 4), {
        text: 'visible',
        html,
      }),
    ).toBe('visible')
    expect(
      clipboardTextForSelection(stateAt('', 0), {
        text: 'visible',
        html,
      }),
    ).toBe('**visible**')
  })

  it('serializes rich paragraphs once but preserves plain clipboard input', () => {
    const state = stateAt('', 0)
    expect(clipboardTextForSelection(state, { text: literal })).toBe(literal)
    expect(clipboardTextForSelection(state, { text: 'bold', html: '<b>bold</b>' })).toBe('**bold**')
  })

  it('preserves whitespace and does not guess text from HTML-only code clipboard', () => {
    const state = stateAt('```text\n\n```', 8)
    const text = '\t a  b\n\nlast\n'
    expect(clipboardTextForSelection(state, { text, html: '<p>a b</p>' })).toBe(text)
    expect(clipboardTextForSelection(state, { text: '', html: '<b>x</b>' })).toBeNull()
  })

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

  it('prefers the language the clipboard declared over the guessed one', () => {
    const doc = '```\n\n```'
    const state = stateAt(doc, doc.indexOf('\n\n') + 1)
    const declared = { value: 'kotlin', label: 'Kotlin' }
    const plan = prepareMarkdownPaste(state, 'const value = 1', declared)

    expect(plan.detectedLanguage).toBe('Kotlin')
    expect(
      state.update({ changes: plan.changes, selection: plan.selection }).state.doc.toString(),
    ).toBe(
      // prettier-ignore
      '```kotlin\nconst value = 1\n```',
    )
  })

  it('ignores a declared language outside an empty code block', () => {
    const doc = 'plain paragraph'
    const state = stateAt(doc, doc.length)

    expect(
      prepareMarkdownPaste(state, 'val x = 1', { value: 'kotlin', label: 'Kotlin' })
        .detectedLanguage,
    ).toBeNull()
  })

  it('also detects a language when the empty block is explicitly text', () => {
    const doc = '```text\n\n```'
    const state = stateAt(doc, doc.indexOf('\n\n') + 1)

    expect(applyPaste(state, 'SELECT id FROM users;').doc.toString()).toBe(
      '```sql\nSELECT id FROM users;\n```',
    )
  })

  it('places the cursor after the pasted text in an already-languaged code block', () => {
    const doc = '```python\n\n```'
    const cursor = doc.indexOf('\n\n') + 1
    const state = stateAt(doc, cursor)
    const pasted = 'const value = 1'

    const result = applyPaste(state, pasted)
    expect(result.selection.main.from).toBe(cursor + pasted.length)
    expect(result.selection.main.empty).toBe(true)
  })

  it('places the cursor after the pasted text in plain paragraph text', () => {
    const doc = 'plain paragraph'
    const state = stateAt(doc, doc.length)
    const pasted = ' more text'

    const result = applyPaste(state, pasted)
    expect(result.selection.main.from).toBe(doc.length + pasted.length)
    expect(result.selection.main.empty).toBe(true)
  })
})
