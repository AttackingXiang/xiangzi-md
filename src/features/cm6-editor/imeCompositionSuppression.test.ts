// @vitest-environment happy-dom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { GFM } from '@lezer/markdown'
import { describe, expect, it } from 'vitest'
import { markdownLivePreview } from './livePreview'

/**
 * A real IME composition is native browser state CM6 never sees as a
 * document change until the user commits it — so a decoration rebuild can
 * happen *during* composition for reasons unrelated to it (a selection
 * update, a viewport pass), and if that rebuild touches the same line the
 * browser is mid-composition on, some engines drop the native composition
 * silently. `paint` (livePreview.ts) and `hiddenRangesEngine`
 * (core/hiddenRanges.ts) both skip that rebuild — remapping positions
 * instead — for as long as `view.compositionStarted` is true.
 *
 * These tests only cover what's mechanically verifiable here: that document
 * content stays correct through a composition-time edit and catches up
 * correctly once composition ends. They do NOT reproduce the reported
 * disappearing-text symptom itself — Chromium (this suite's environment)
 * already preserves the relevant DOM node identity across an ordinary
 * rebuild regardless of this guard, so the symptom likely comes from
 * WKWebView-specific composition/contentEditable interaction (the desktop
 * app's real engine) that this test environment can't reproduce. Verify
 * that case by hand in the app.
 */
function createView(doc: string): EditorView {
  const parent = document.createElement('div')
  document.body.append(parent)
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: GFM }), markdownLivePreview()],
    }),
    parent,
  })
}

describe('markdownLivePreview: document content stays correct across composition-time edits', () => {
  it('keeps a mid-composition edit in the document', () => {
    const view = createView('## he')
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    view.dispatch({ changes: { from: 5, insert: 'llo' } })
    expect(view.state.doc.toString()).toBe('## hello')
    view.destroy()
  })

  it('rebuilds correctly once composition ends', () => {
    const view = createView('## he')
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
    view.dispatch({ changes: { from: 5, insert: 'l' } })
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { data: 'l' }))
    // Composition's own commit is itself a doc-changing transaction in a
    // real session; simulate that final commit landing after `compositionend`.
    view.dispatch({ changes: { from: 6, insert: 'lo' } })

    expect(view.state.doc.toString()).toBe('## hello')
    const line = view.contentDOM.querySelector('.cm-line.xmd-cm-heading')
    expect(line?.querySelector('.xmd-cm-preserved-hidden-source')).not.toBeNull()
    view.destroy()
  })
})
