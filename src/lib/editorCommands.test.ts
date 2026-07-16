import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { GFM } from '@lezer/markdown'
import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'
import { fencedCodeContentRange } from '../features/cm6-editor/codeBlockPreview'
import {
  editorCmd,
  hasWysiwyg,
  normalizeLinkHref,
  selectAllScope,
  shiftedHeadingLevel,
} from './editorCommands'
import { tableCellCommandBridge } from './tableCellCommandBridge'

describe('CM6 editor command adapter', () => {
  afterEach(() => cm6ActiveViewBridge.clear())
  afterEach(() => tableCellCommandBridge.reset())
  it('clamps heading promotion and demotion', () => {
    expect(shiftedHeadingLevel(3, 'promote')).toBe(2)
    expect(shiftedHeadingLevel(3, 'demote')).toBe(4)
    expect(shiftedHeadingLevel(1, 'promote')).toBe(1)
    expect(shiftedHeadingLevel(6, 'demote')).toBe(6)
  })

  it('normalizes safe links and rejects executable protocols', () => {
    expect(normalizeLinkHref('example.com')).toBe('https://example.com')
    expect(normalizeLinkHref('mailto:test@example.com')).toBe('mailto:test@example.com')
    expect(normalizeLinkHref('#section')).toBe('#section')
    expect(normalizeLinkHref('../notes/test.md')).toBe('../notes/test.md')
    expect(normalizeLinkHref('//example.com/path')).toBe('https://example.com/path')
    expect(normalizeLinkHref(' javascript:alert(1) ')).toBeNull()
    expect(normalizeLinkHref('data:text/html,test')).toBeNull()
    expect(normalizeLinkHref('https://example.com\njavascript:alert(1)')).toBeNull()
    expect(normalizeLinkHref('   ')).toBeNull()
  })

  it('scopes select-all to fenced code content when the caret is inside a code block', () => {
    const doc = 'before\n```ts\nconst x = 1\n```\nafter'
    const extensions = [markdown({ base: markdownLanguage, extensions: GFM })]
    const insideCode = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf('x')),
      extensions,
    })
    expect(selectAllScope(insideCode)).toEqual({
      from: doc.indexOf('const'),
      to: doc.lastIndexOf('\n```'),
    })

    const outsideCode = EditorState.create({
      doc,
      selection: EditorSelection.cursor(2),
      extensions,
    })
    expect(selectAllScope(outsideCode)).toEqual({ from: 0, to: doc.length })

    const readingMode = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf('x')),
      extensions: [...extensions, EditorState.readOnly.of(true)],
    })
    expect(selectAllScope(readingMode)).toEqual({ from: 0, to: doc.length })
  })

  it('agrees with the CM6 Mod-a keymap query for a fence indented 4 spaces under a list item', () => {
    // `selectAllScope` used to re-derive fence boundaries with its own tree
    // walk plus a `^( {0,3})(`{3,}|~{3,})[ \t]*$` closing-fence regex, which
    // misjudges a fence nested under a list item (that fence legitimately
    // has 4+ leading spaces — see `readFencedCode`'s doc comment in
    // codeBlockPreview.ts). It must now resolve through the same
    // `fencedCodeContentRange` query the editor's own `Mod-a` keymap uses,
    // so both entry points can never disagree on what gets selected.
    const doc = '- item\n\n    ```js\n    const x = 1\n    ```\n'
    const extensions = [markdown({ base: markdownLanguage, extensions: GFM })]
    const cursor = doc.indexOf('const x')
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions,
    })

    const viaKeymapQuery = fencedCodeContentRange(state, cursor)
    expect(viaKeymapQuery).not.toBeNull()
    expect(selectAllScope(state)).toEqual(viaKeymapQuery)
    expect(state.doc.sliceString(viaKeymapQuery!.from, viaKeymapQuery!.to)).toContain('const x = 1')
  })

  it('does not expose formatting actions while the active editor is read-only', () => {
    const editable = EditorState.create({ doc: 'editable' })
    cm6ActiveViewBridge.register({ state: editable } as EditorView)
    expect(hasWysiwyg()).toBe(true)

    const readOnly = EditorState.create({
      doc: 'read-only',
      extensions: [EditorState.readOnly.of(true)],
    })
    cm6ActiveViewBridge.register({ state: readOnly } as EditorView)
    expect(hasWysiwyg()).toBe(false)
  })

  it('never applies toolbar commands to the stale outer CM selection while a table cell is active', () => {
    let state = EditorState.create({
      doc: '# stale outer selection',
      selection: EditorSelection.cursor(2),
      extensions: [markdown({ base: markdownLanguage, extensions: GFM })],
    })
    const outerView = {
      get state() {
        return state
      },
      dispatch(transaction: Transaction) {
        state = transaction.state
      },
      focus: vi.fn(),
    } as unknown as EditorView
    cm6ActiveViewBridge.register(outerView)
    const runInline = vi.fn(() => true)
    tableCellCommandBridge.activate({
      element: {} as HTMLElement,
      runInline,
      selectAll: vi.fn(),
      readState: () => ({
        hasSelection: true,
        bold: false,
        italic: false,
        strike: false,
        inlineCode: false,
      }),
    })

    editorCmd.heading(2)
    editorCmd.bulletList()
    editorCmd.codeBlock()
    editorCmd.undo()
    editorCmd.bold()

    expect(state.doc.toString()).toBe('# stale outer selection')
    expect(runInline).toHaveBeenCalledOnce()
    expect(runInline).toHaveBeenCalledWith('bold')
  })
})
