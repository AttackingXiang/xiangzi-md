import type { EditorState } from '@codemirror/state'
import { createStateBridge } from './bridgeFactory'

export interface DocumentCursor {
  line: number
  col: number
  /** 多光标数量，1 表示单光标。 */
  selections: number
  /** 选中的字符数，0 表示只有光标。 */
  selected: number
}

/**
 * Markdown 编辑器的光标位置。
 *
 * 走桥而不是提升到 App state：光标每次移动都要更新，放进 App 会让整棵树
 * 跟着重渲染，而这里只有状态栏关心。状态栏自己订阅，代价止步于它。
 */
const bridge = createStateBridge<DocumentCursor | null>(null, {
  isEqual: (a, b) =>
    a === b ||
    (a !== null &&
      b !== null &&
      a.line === b.line &&
      a.col === b.col &&
      a.selections === b.selections &&
      a.selected === b.selected),
})

export function documentCursorFromState(state: EditorState): DocumentCursor {
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)
  return {
    line: line.number,
    col: range.head - line.from + 1,
    selections: state.selection.ranges.length,
    selected: state.selection.ranges.reduce((total, r) => total + (r.to - r.from), 0),
  }
}

export const documentCursorBridge = {
  publish: (state: EditorState): void => bridge.setState(documentCursorFromState(state)),
  clear: (): void => bridge.setState(null),
  getState: bridge.getState,
  subscribe: bridge.subscribe,
}
