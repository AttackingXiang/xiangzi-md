import { history, undoDepth } from '@codemirror/commands'
import { search, SearchQuery } from '@codemirror/search'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'
import {
  canReplaceInEditor,
  findSearchMatch,
  onEditorAvailable,
  searchFind,
  searchMountedEditor,
  searchNext,
  searchReplaceAll,
} from './searchBridge'

function stateView(doc: string): { view: EditorView; state: () => EditorState } {
  let current = EditorState.create({ doc, extensions: [search(), history()] })
  const view = {
    get state() {
      return current
    },
    dispatch(spec: TransactionSpec) {
      current = current.update(spec).state
    },
    root: { activeElement: null },
  } as unknown as EditorView
  return { view, state: () => current }
}

describe('CM6 shared search bridge', () => {
  afterEach(() => {
    cm6ActiveViewBridge.clear()
    vi.unstubAllGlobals()
  })

  it('finds literal, case-insensitive Unicode occurrences deterministically', () => {
    const state = EditorState.create({ doc: 'École [x]\nécole [x]\nE\u0301COLE' })
    const query = new SearchQuery({ search: 'école', caseSensitive: false, literal: true })

    expect(findSearchMatch(state, query, 0)).toEqual({ from: 0, to: 5 })
    expect(findSearchMatch(state, query, 1)).toEqual({ from: 10, to: 15 })
    expect(findSearchMatch(state, new SearchQuery({ search: '[x]', literal: true }), 1)).toEqual({
      from: 16,
      to: 19,
    })
  })

  it('uses a line hint when an occurrence is stale or out of range', () => {
    const state = EditorState.create({ doc: 'match\nother\nMATCH here' })
    const query = new SearchQuery({ search: 'match', caseSensitive: false, literal: true })

    expect(findSearchMatch(state, query, 99, 3)).toEqual({ from: 12, to: 17 })
  })

  it('selects a mounted-document occurrence in one transaction', () => {
    const harness = stateView('same first\nsame second\nsame third')
    cm6ActiveViewBridge.register(harness.view)
    harness.view.dispatch({ selection: EditorSelection.cursor(harness.state().doc.length) })

    expect(searchMountedEditor('same', 2, 3)).toBe(true)
    expect(harness.state().selection.main).toMatchObject({ from: 23, to: 27 })
  })

  it('does not open or advance an invalid empty query', () => {
    const harness = stateView('content')
    cm6ActiveViewBridge.register(harness.view)

    expect(searchMountedEditor('content')).toBe(true)
    const selectedMatch = harness.state().selection
    expect(searchFind('')).toBe(false)
    expect(searchNext()).toBe(false)
    expect(searchMountedEditor('', 0)).toBe(false)
    expect(harness.state().selection.eq(selectedMatch)).toBe(true)
  })

  it('replaces all matches as one undoable source transaction', () => {
    const harness = stateView('Alpha alpha ALPHA')
    cm6ActiveViewBridge.register(harness.view)

    expect(searchReplaceAll('alpha', 'β')).toBe(true)
    expect(harness.state().doc.toString()).toBe('β β β')
    expect(undoDepth(harness.state())).toBe(1)
  })

  it('reports replacement as unavailable for a read-only editor', () => {
    let current = EditorState.create({
      doc: 'read only',
      extensions: [search(), EditorState.readOnly.of(true)],
    })
    const view = {
      get state() {
        return current
      },
      dispatch(spec: TransactionSpec) {
        current = current.update(spec).state
      },
      root: { activeElement: null },
    } as unknown as EditorView
    cm6ActiveViewBridge.register(view)

    expect(canReplaceInEditor()).toBe(false)
    expect(searchReplaceAll('read', 'write')).toBe(false)
    expect(current.doc.toString()).toBe('read only')
  })

  it('delivers a pending search when a lazy editor mounts', () => {
    let calls = 0
    const unsubscribe = onEditorAvailable(() => {
      calls += 1
    })
    const harness = stateView('mounted later')

    cm6ActiveViewBridge.register(harness.view)
    unsubscribe()
    cm6ActiveViewBridge.clear()
    cm6ActiveViewBridge.register(harness.view)

    expect(calls).toBe(1)
  })

  it('reasserts only scrolling after mount-time layout restoration settles', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    let current = EditorState.create({ doc: 'target', extensions: search() })
    let dispatches = 0
    const view = {
      get state() {
        return current
      },
      dispatch(spec: TransactionSpec) {
        dispatches += 1
        current = current.update(spec).state
      },
      root: { activeElement: null },
    } as unknown as EditorView
    cm6ActiveViewBridge.register(view)

    expect(searchMountedEditor('target')).toBe(true)
    for (let frame = 0; frame < 4; frame += 1) frames.shift()?.(frame)

    expect(dispatches).toBe(2)
  })
})
