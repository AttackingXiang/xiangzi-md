import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { documentCursorBridge, documentCursorFromState } from './documentCursorBridge'

function stateWith(doc: string, ranges: { anchor: number; head?: number }[]): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map((r) => EditorSelection.range(r.anchor, r.head ?? r.anchor)),
    ),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  })
}

describe('documentCursorFromState', () => {
  it('reports 1-based line and column', () => {
    const state = stateWith('first\nsecond', [{ anchor: 8 }])
    expect(documentCursorFromState(state)).toEqual({
      line: 2,
      col: 3,
      selections: 1,
      selected: 0,
    })
  })

  it('counts every cursor and the total selected length', () => {
    const state = stateWith('abcdef', [
      { anchor: 0, head: 2 },
      { anchor: 4, head: 6 },
    ])
    const cursor = documentCursorFromState(state)
    expect(cursor.selections).toBe(2)
    expect(cursor.selected).toBe(4)
  })
})

describe('documentCursorBridge', () => {
  it('does not notify subscribers when the position is unchanged', () => {
    // 光标不动但文档变化的事件很多（geometryChanged 等）。重复通知会让状态栏
    // 白白重渲染，isEqual 就是为此存在的。
    const seen: unknown[] = []
    const unsubscribe = documentCursorBridge.subscribe((cursor) => seen.push(cursor))
    const first = stateWith('abc', [{ anchor: 1 }])

    documentCursorBridge.publish(first)
    documentCursorBridge.publish(stateWith('abc', [{ anchor: 1 }]))
    expect(seen).toHaveLength(2) // 订阅时的初值 + 一次真实变化

    documentCursorBridge.publish(stateWith('abc', [{ anchor: 2 }]))
    expect(seen).toHaveLength(3)

    unsubscribe()
    documentCursorBridge.clear()
  })
})
