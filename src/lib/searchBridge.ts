import {
  SearchQuery,
  findNext,
  findPrevious,
  replaceAll,
  replaceNext,
  setSearchQuery,
} from '@codemirror/search'
import { cm6ActiveViewBridge } from '../features/cm6-editor/activeViewBridge'

/** Whether the active Markdown editor can serve the shared find/replace UI. */
export function hasEditor(): boolean {
  return cm6ActiveViewBridge.get() !== null
}

function setQuery(text: string, replace: string): boolean {
  const view = cm6ActiveViewBridge.get()
  if (!view) return false
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({ search: text, replace, caseSensitive: false, literal: true }),
    ),
  })
  return true
}

export function searchFind(text: string, replace = ''): void {
  if (!setQuery(text, replace)) return
  const view = cm6ActiveViewBridge.get()
  if (view) findNext(view)
}

export function searchNext(): void {
  const view = cm6ActiveViewBridge.get()
  if (view) findNext(view)
}

export function searchPrev(): void {
  const view = cm6ActiveViewBridge.get()
  if (view) findPrevious(view)
}

export function searchReplace(text: string, replace: string): void {
  if (!setQuery(text, replace)) return
  const view = cm6ActiveViewBridge.get()
  if (view) replaceNext(view)
}

export function searchReplaceAll(text: string, replace: string): void {
  if (!setQuery(text, replace)) return
  const view = cm6ActiveViewBridge.get()
  if (view) replaceAll(view)
}

export function searchClear(): void {
  const view = cm6ActiveViewBridge.get()
  if (!view) return
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) })
}

/** Select a known occurrence after folder-search navigation opens the document. */
export function searchMountedEditor(text: string, localOccurrence = 0): void {
  if (!setQuery(text, '')) return
  const view = cm6ActiveViewBridge.get()
  if (!view) return
  for (let index = 0; index <= localOccurrence; index += 1) findNext(view)
}
