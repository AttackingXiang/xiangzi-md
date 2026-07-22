import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isTableCellFormattingShortcut,
  routeTableCellShortcut,
  shouldDeferSelectAllToFocusedEditor,
} from './useAppShortcuts'
import { tableCellCommandBridge } from '../lib/tableCellCommandBridge'

class ElementStub {
  private readonly editable = {}
  private readonly markdownRoot = {}
  private readonly markdownContent = {}

  constructor(private readonly kind: 'markdown' | 'nested' | 'source' | 'other-editor' | 'plain') {}

  closest(selector: string): object | null {
    if (selector === 'input, textarea') return null
    if (selector === '[contenteditable="true"]') {
      if (this.kind === 'markdown') return this.markdownContent
      if (['nested', 'source', 'other-editor'].includes(this.kind)) return this.editable
      return null
    }
    if (selector === '.xmd-cm-editor.is-live-preview') {
      return this.kind === 'markdown' || this.kind === 'nested' ? this.markdownRoot : null
    }
    if (selector === '.xmd-cm-editor.is-live-preview .cm-content[contenteditable="true"]') {
      return this.kind === 'markdown' || this.kind === 'nested' ? this.markdownContent : null
    }
    return null
  }
}

describe('application shortcut focus routing', () => {
  afterEach(() => vi.unstubAllGlobals())
  afterEach(() => tableCellCommandBridge.reset())

  it('routes the Markdown root through the document command for code-block scoping', () => {
    vi.stubGlobal('Element', ElementStub)
    expect(
      shouldDeferSelectAllToFocusedEditor(new ElementStub('markdown') as unknown as EventTarget),
    ).toBe(false)
  })

  it('leaves nested table cells and unrelated editors to their native select-all', () => {
    vi.stubGlobal('Element', ElementStub)
    expect(
      shouldDeferSelectAllToFocusedEditor(new ElementStub('nested') as unknown as EventTarget),
    ).toBe(true)
    expect(
      shouldDeferSelectAllToFocusedEditor(
        new ElementStub('other-editor') as unknown as EventTarget,
      ),
    ).toBe(true)
    expect(
      shouldDeferSelectAllToFocusedEditor(new ElementStub('source') as unknown as EventTarget),
    ).toBe(true)
  })

  it('dispatches document select-all when focus is outside an editable control', () => {
    vi.stubGlobal('Element', ElementStub)
    expect(
      shouldDeferSelectAllToFocusedEditor(new ElementStub('plain') as unknown as EventTarget),
    ).toBe(false)
    expect(shouldDeferSelectAllToFocusedEditor(null)).toBe(false)
  })

  it('classifies every block and inline formatting shortcut for table-cell interception', () => {
    expect(isTableCellFormattingShortcut('bold')).toBe(true)
    expect(isTableCellFormattingShortcut('heading-3')).toBe(true)
    expect(isTableCellFormattingShortcut('code-block')).toBe(true)
    expect(isTableCellFormattingShortcut('save')).toBe(false)
    expect(isTableCellFormattingShortcut('find')).toBe(false)
  })

  it('routes table-cell inline commands locally and blocks every block-level command', () => {
    class NodeStub {}
    vi.stubGlobal('Node', NodeStub)
    const element = Object.assign(new NodeStub(), {
      contains: () => false,
    }) as unknown as HTMLElement
    tableCellCommandBridge.activate({
      element,
      runInline: vi.fn(() => true),
      selectAll: vi.fn(),
      readState: () => ({
        hasSelection: true,
        bold: false,
        italic: false,
        strike: false,
        inlineCode: false,
      }),
    })

    expect(routeTableCellShortcut('bold', element, 'Mod+B')).toEqual({
      kind: 'inline',
      format: 'bold',
    })
    expect(routeTableCellShortcut('heading-2', element, 'Mod+2')).toEqual({ kind: 'blocked' })
    expect(routeTableCellShortcut('code-block', element, 'Mod+Alt+C')).toEqual({ kind: 'blocked' })
    expect(routeTableCellShortcut('select-all', element, 'Mod+A')).toEqual({ kind: 'native' })
    expect(routeTableCellShortcut('save', element, 'Mod+S')).toEqual({ kind: 'outer' })
  })

  it('only defers select-all to the native handler for the literal Mod+A combo', () => {
    class NodeStub {}
    vi.stubGlobal('Node', NodeStub)
    const element = Object.assign(new NodeStub(), {
      contains: () => false,
    }) as unknown as HTMLElement
    tableCellCommandBridge.activate({
      element,
      runInline: vi.fn(() => true),
      selectAll: vi.fn(),
      readState: () => ({
        hasSelection: true,
        bold: false,
        italic: false,
        strike: false,
        inlineCode: false,
      }),
    })

    // A customized select-all binding has no browser/OS handler to fall
    // back to inside a table cell, so it must still reach the app dispatch.
    expect(routeTableCellShortcut('select-all', element, 'Mod+Shift+A')).toEqual({ kind: 'outer' })
  })
})
