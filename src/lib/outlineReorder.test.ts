import { describe, expect, it, vi } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { editorBridge } from './editorBridge'
import { reorderHeadingSections } from './outlineReorder'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
    },
  },
})

function heading(text: string, level = 1) {
  return schema.node('heading', { level }, schema.text(text))
}

function paragraph(text: string) {
  return schema.node('paragraph', null, schema.text(text))
}

describe('outline reorder', () => {
  it('moves a complete heading section and marks the transaction as a user edit', () => {
    let state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        heading('A'),
        paragraph('A body'),
        heading('B'),
        paragraph('B body'),
      ]),
    })
    const markUserEdit = vi.fn()
    const view = {
      get state() {
        return state
      },
      dispatch(transaction: Parameters<EditorView['dispatch']>[0]) {
        state = state.apply(transaction)
      },
    } as EditorView
    editorBridge.set(view, markUserEdit)

    reorderHeadingSections(0, 1)

    expect(state.doc.toJSON()).toEqual(
      schema
        .node('doc', null, [heading('B'), paragraph('B body'), heading('A'), paragraph('A body')])
        .toJSON(),
    )
    expect(markUserEdit).toHaveBeenCalledOnce()
    editorBridge.set(null)
  })
})
