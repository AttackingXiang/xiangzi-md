// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { EditorView, keymap, runScopeHandlers } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import { markdownLivePreview } from './livePreview'

/**
 * A hard break is stored as `\` + newline with the backslash hidden (see
 * `collectHiddenRanges`'s `HardBreak` case). The caret's natural end-of-line
 * rest sits *after* that hidden backslash, right before the real newline, so
 * anything typed there lands between the backslash and the newline. Typing a
 * literal backslash there must neither drop an existing forced break nor
 * silently create a new one — every backslash the user wants to see is stored
 * as an escaped pair `\\`, so what the user types is what the user sees, one
 * glyph per keystroke, deleted one glyph at a time.
 */
function createView(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: GFM }),
        markdownLivePreview(),
        keymap.of(defaultKeymap),
      ],
    }),
    parent,
  })
}

/** The text CM6 actually paints, i.e. with hidden source removed. */
function rendered(view: EditorView): string {
  return view.contentDOM.textContent ?? ''
}

/** Insert `text` at the current caret with an input user-event, as typing does. */
function type(view: EditorView, text: string): void {
  const at = view.state.selection.main.head
  view.dispatch({
    changes: { from: at, to: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: 'input.type',
  })
}

function backspace(view: EditorView): void {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor')
}

function forwardDelete(view: EditorView): void {
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Delete' }), 'editor')
}

describe('markdownLivePreview: typing between a hard break\'s hidden backslash and its newline', () => {
  it('redirects an ordinary typed character in front of the backslash, keeping the break', () => {
    const view = createView('a\\\nb')
    // Position 2 sits between the backslash (index 1) and the newline (index 2).
    view.dispatch({ changes: { from: 2, to: 2, insert: '/' }, userEvent: 'input.type' })
    expect(view.state.doc.toString()).toBe('a/\\\nb')
    view.destroy()
  })

  it('leaves an ordinary insertion elsewhere alone', () => {
    const view = createView('a\\\nb')
    view.dispatch({ changes: { from: 0, to: 0, insert: 'x' }, userEvent: 'input.type' })
    expect(view.state.doc.toString()).toBe('xa\\\nb')
    view.destroy()
  })

  it('does not touch a plain escaped character typed elsewhere', () => {
    const view = createView('a\\*b')
    view.dispatch({ changes: { from: 4, to: 4, insert: 'c' }, userEvent: 'input.type' })
    expect(view.state.doc.toString()).toBe('a\\*bc')
    view.destroy()
  })

  it('stores a typed backslash as an escaped pair so the hard break survives', () => {
    const view = createView('a\\\nb')
    view.dispatch({ changes: { from: 2, to: 2, insert: '\\' }, userEvent: 'input.type' })
    // `a` + escaped literal backslash (`\\`) + the hard break's own backslash
    // + newline + `b`. An even run in front of the newline would pair off and
    // drop the break; the odd run keeps it a hard break and renders one
    // literal backslash for the user.
    expect(view.state.doc.toString()).toBe('a\\\\\\\nb')
    view.destroy()
  })

  it('keeps typing backslashes one-for-one at the boundary', () => {
    const view = createView('a\\\nb')
    view.dispatch({ selection: { anchor: 2 } })
    type(view, '\\') // a \\ \ \n b   -> 1 visible backslash
    expect(view.state.doc.toString()).toBe('a\\\\\\\nb')
    type(view, '\\') // a \\\\ \ \n b -> 2 visible backslashes
    expect(view.state.doc.toString()).toBe('a\\\\\\\\\\\nb')
    type(view, '\\') // 3 visible backslashes
    expect(view.state.doc.toString()).toBe('a\\\\\\\\\\\\\\\nb')
    view.destroy()
  })

  it('deletes those backslashes one-for-one, then relaxes the bare hard break', () => {
    const view = createView('a\\\nb')
    view.dispatch({ selection: { anchor: 2 } })
    type(view, '\\')
    type(view, '\\')
    expect(view.state.doc.toString()).toBe('a\\\\\\\\\\\nb') // 2 visible
    expect(rendered(view)).toBe('a\\\\b')

    backspace(view)
    expect(view.state.doc.toString()).toBe('a\\\\\\\nb') // 1 visible
    expect(rendered(view)).toBe('a\\b')
    backspace(view)
    expect(view.state.doc.toString()).toBe('a\\\nb') // bare hard break, break intact
    expect(rendered(view)).toBe('ab')
    backspace(view) // no longer a dead key: the forced break relaxes to a wrap
    expect(view.state.doc.toString()).toBe('a\nb')
    view.destroy()
  })

  it('leaves a backslash typed at a line end inside code exactly as typed', () => {
    for (const [doc, needle] of [
      ['```\nlet x\n```\n', 'let x'], // fenced code
      ['a `code` b', 'code'], // inline code
      ['p\n\n    code\nq\n', 'code'], // indented code block
    ] as const) {
      const view = createView(doc)
      const at = doc.indexOf(needle) + needle.length
      view.dispatch({ selection: { anchor: at } })
      type(view, '\\')
      expect(view.state.doc.toString()).toBe(doc.slice(0, at) + '\\' + doc.slice(at))
      view.destroy()
    }
  })

  it('a backslash typed at a plain line end stays a visible literal, not a new hard break', () => {
    const view = createView('a\nb')
    view.dispatch({ selection: { anchor: 1 } }) // end of "a", before the newline
    type(view, '\\')
    // Stored as an escaped pair, rendered as one glyph — and crucially the
    // line is still `a\nb` + escape, never a `\` + `\n` hard break.
    expect(view.state.doc.toString()).toBe('a\\\\\nb')
    expect(rendered(view)).toBe('a\\b')

    type(view, '\\')
    expect(rendered(view)).toBe('a\\\\b')
    backspace(view)
    expect(rendered(view)).toBe('a\\b')
    backspace(view)
    expect(view.state.doc.toString()).toBe('a\nb') // fully removed, nothing stuck
    view.destroy()
  })

  it('leaves a backslash typed inside a $$ math block as LaTeX, not an escape pair', () => {
    const view = createView('$$\na = b\nc = d\n$$\n')
    const at = view.state.doc.toString().indexOf('a = b') + 'a = b'.length
    view.dispatch({ selection: { anchor: at } })
    type(view, '\\')
    expect(view.state.doc.toString()).toBe('$$\na = b\\\nc = d\n$$\n') // one `\`
    type(view, '\\')
    expect(view.state.doc.toString()).toBe('$$\na = b\\\\\nc = d\n$$\n') // LaTeX `\\`
    view.destroy()
  })

  it('handles a backslash typed at a line end that is neither line 1 nor the last line', () => {
    const view = createView('title\n\npara one\nmore text')
    const at = view.state.doc.toString().indexOf('para one') + 'para one'.length
    view.dispatch({ selection: { anchor: at } })
    type(view, '\\')
    // One visible backslash, still two lines, no hidden hard break created.
    expect(view.state.doc.toString()).toBe('title\n\npara one\\\\\nmore text')
    expect(rendered(view)).toContain('para one\\')
    expect(rendered(view)).toContain('more text')
    view.destroy()
  })

  it('relaxes a real Shift-Enter hard break with forward Delete from in front of it', () => {
    const view = createView('alpha\nbeta')
    view.dispatch({ selection: { anchor: 5 } }) // end of "alpha"
    // Build a genuine hard break the way Shift-Enter does: `\` + `\n`.
    view.dispatch({ changes: { from: 5, to: 6, insert: '\\\n' }, userEvent: 'input' })
    expect(view.state.doc.toString()).toBe('alpha\\\nbeta')
    view.dispatch({ selection: { anchor: 5 } }) // in front of the hidden `\`
    forwardDelete(view)
    expect(view.state.doc.toString()).toBe('alpha\nbeta') // forced break relaxed
    view.destroy()
  })
})
