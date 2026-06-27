import {
  SearchQuery,
  setSearchState,
  findNext,
  findPrev,
  replaceNext,
  replaceAll,
} from 'prosemirror-search'
import { editorBridge } from './editorBridge'

/** 当前是否有可用的所见即所得编辑器（用于决定走 PM 搜索还是源码原生查找） */
export function hasEditor(): boolean {
  return !!editorBridge.get()
}

/** 把当前激活的匹配滚动到视口中央（ProseMirror 自带滚动在 flex 容器里不够可靠） */
function scrollActiveIntoView(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector('.ProseMirror-active-search-match')
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

function setQuery(text: string, replace: string): boolean {
  const view = editorBridge.get()
  if (!view) return false
  const query = new SearchQuery({ search: text, replace, caseSensitive: false })
  view.dispatch(setSearchState(view.state.tr, query))
  return true
}

/** 设置查询并跳到下一个匹配 */
export function searchFind(text: string, replace = ''): void {
  if (!setQuery(text, replace)) return
  const view = editorBridge.get()
  if (view) {
    findNext(view.state, view.dispatch)
    scrollActiveIntoView()
  }
}

export function searchNext(): void {
  const view = editorBridge.get()
  // 不调用 view.focus()：保持焦点在查找框，避免回车落到编辑器替换选中文本
  if (view) {
    findNext(view.state, view.dispatch)
    scrollActiveIntoView()
  }
}

export function searchPrev(): void {
  const view = editorBridge.get()
  if (view) {
    findPrev(view.state, view.dispatch)
    scrollActiveIntoView()
  }
}

export function searchReplace(text: string, replace: string): void {
  if (!setQuery(text, replace)) return
  const view = editorBridge.get()
  if (view) replaceNext(view.state, view.dispatch)
}

export function searchReplaceAll(text: string, replace: string): void {
  if (!setQuery(text, replace)) return
  const view = editorBridge.get()
  if (view) replaceAll(view.state, view.dispatch)
}

/** 关闭查找时清除高亮 */
export function searchClear(): void {
  const view = editorBridge.get()
  if (!view) return
  view.dispatch(setSearchState(view.state.tr, new SearchQuery({ search: '' })))
}
