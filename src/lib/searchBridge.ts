import {
  getSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search'
import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'

/** Whether the active Markdown editor can serve the shared find/replace UI. */
export function hasEditor(): boolean {
  return cm6ActiveViewBridge.get() !== null
}

/** Whether replace commands may mutate the active editor. */
export function canReplaceInEditor(): boolean {
  const view = cm6ActiveViewBridge.get()
  return view !== null && !view.state.readOnly
}

/** Wait for a lazily mounted Markdown editor without polling or fixed delays. */
export function onEditorAvailable(listener: () => void): () => void {
  return cm6ActiveViewBridge.subscribe((view) => {
    if (view) listener()
  })
}

export function subscribeEditorAvailability(listener: (available: boolean) => void): () => void {
  return cm6ActiveViewBridge.subscribe((view) => listener(view !== null))
}

function setQuery(text: string, replace: string): EditorView | null {
  const view = cm6ActiveViewBridge.get()
  if (!view) return null
  const query = new SearchQuery({ search: text, replace, caseSensitive: false, literal: true })
  if (!query.valid) {
    view.dispatch({ effects: setSearchQuery.of(query) })
    return null
  }
  view.dispatch({
    effects: setSearchQuery.of(query),
  })
  return view
}

function currentSearchView(): EditorView | null {
  const view = cm6ActiveViewBridge.get()
  return view && getSearchQuery(view.state).valid ? view : null
}

export function searchFind(text: string, replace = ''): boolean {
  const view = setQuery(text, replace)
  return view ? findNext(view) : false
}

export function searchNext(): boolean {
  const view = currentSearchView()
  return view ? findNext(view) : false
}

export function searchPrev(): boolean {
  const view = currentSearchView()
  return view ? findPrevious(view) : false
}

export function searchReplace(text: string, replace: string): boolean {
  const view = setQuery(text, replace)
  return view ? replaceNext(view) : false
}

export function searchReplaceAll(text: string, replace: string): boolean {
  const view = setQuery(text, replace)
  return view ? replaceAll(view) : false
}

export function searchClear(): boolean {
  const view = cm6ActiveViewBridge.get()
  if (!view) return false
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) })
  return true
}

export interface SearchMatchRange {
  from: number
  to: number
}

function stabilizeSearchScroll(view: EditorView, selection: EditorSelection): void {
  if (typeof requestAnimationFrame !== 'function') return
  const document = view.state.doc
  let frames = 4
  const afterLayout = (): void => {
    frames -= 1
    if (frames > 0) {
      requestAnimationFrame(afterLayout)
      return
    }
    if (
      cm6ActiveViewBridge.get() !== view ||
      view.state.doc !== document ||
      !view.state.selection.eq(selection)
    )
      return
    view.dispatch({
      effects: EditorView.scrollIntoView(selection.main, { y: 'center', yMargin: 32 }),
    })
  }
  requestAnimationFrame(afterLayout)
}

/**
 * Resolve a folder-search occurrence without dispatching every preceding match.
 * The optional line hint reconciles backend/frontend Unicode case-folding
 * differences and older search results that did not include an occurrence.
 */
export function findSearchMatch(
  state: EditorState,
  query: SearchQuery,
  localOccurrence = 0,
  lineNumber?: number,
): SearchMatchRange | null {
  if (!query.valid) return null
  if (lineNumber !== undefined && Number.isFinite(lineNumber)) {
    const line = state.doc.line(Math.max(1, Math.min(state.doc.lines, Math.trunc(lineNumber))))
    const lineCursor = query.getCursor(state, line.from, line.to)
    const lineMatch = lineCursor.next()
    if (!lineMatch.done) return { from: lineMatch.value.from, to: lineMatch.value.to }
  }

  const occurrence =
    Number.isFinite(localOccurrence) && localOccurrence > 0 ? Math.trunc(localOccurrence) : 0
  const cursor = query.getCursor(state, 0, state.doc.length)
  let match: SearchMatchRange | null = null
  for (let index = 0; index <= occurrence; index += 1) {
    const next = cursor.next()
    if (next.done) {
      match = null
      break
    }
    match = { from: next.value.from, to: next.value.to }
  }

  return match
}

/** Select a known occurrence after folder-search navigation opens the document. */
export function searchMountedEditor(
  text: string,
  localOccurrence = 0,
  lineNumber?: number,
): boolean {
  const view = cm6ActiveViewBridge.get()
  if (!view) return false
  const query = new SearchQuery({ search: text, caseSensitive: false, literal: true })
  if (!query.valid) {
    view.dispatch({ effects: setSearchQuery.of(query) })
    return false
  }
  const match = findSearchMatch(view.state, query, localOccurrence, lineNumber)
  if (!match) {
    view.dispatch({ effects: setSearchQuery.of(query) })
    return false
  }
  const selection = EditorSelection.single(match.from, match.to)
  view.dispatch({
    selection,
    effects: [
      setSearchQuery.of(query),
      EditorView.scrollIntoView(selection.main, { y: 'center', yMargin: 32 }),
    ],
    userEvent: 'select.search',
  })
  // MarkdownEditor restores stored scroll positions for its first three
  // layout frames. Reassert only the scroll effect afterwards, and only if the
  // target selection/document are still current.
  stabilizeSearchScroll(view, selection)
  return true
}
