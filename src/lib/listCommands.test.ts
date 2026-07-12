import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { listStyleFromState, toggleListStyleCommand, type ListStyle } from './listCommands'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: { group: 'block', content: 'inline*' },
    bullet_list: { group: 'block', content: 'list_item+', attrs: { spread: { default: false } } },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { order: { default: 1 }, spread: { default: false } },
    },
    list_item: {
      content: 'paragraph block*',
      attrs: {
        checked: { default: null },
        label: { default: '•' },
        listType: { default: 'bullet' },
        spread: { default: true },
      },
    },
  },
})

function listState(style: ListStyle): EditorState {
  const item = schema.node(
    'list_item',
    {
      checked: style === 'task' ? false : null,
      label: style === 'ordered' ? '1.' : '•',
      listType: style === 'ordered' ? 'ordered' : 'bullet',
    },
    [schema.node('paragraph', null, [schema.text('Item')])],
  )
  const list = schema.node(style === 'ordered' ? 'ordered_list' : 'bullet_list', null, [item])
  const doc = schema.node('doc', null, [list])
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3) })
}

function switchTo(state: EditorState, style: ListStyle): EditorState {
  const before = state.selection.from
  let next = state
  expect(
    toggleListStyleCommand(style)(state, (transaction) => {
      next = state.apply(transaction)
    }),
  ).toBe(true)
  expect(next.selection.from).toBe(before)
  return next
}

describe('toggleListStyleCommand', () => {
  for (const from of ['bullet', 'ordered', 'task'] as const) {
    for (const to of ['bullet', 'ordered', 'task'] as const) {
      if (from === to) continue
      it(`switches ${from} to ${to} without moving the cursor`, () => {
        const state = switchTo(listState(from), to)
        expect(listStyleFromState(state)).toBe(to)
        const item = state.doc.firstChild?.firstChild
        expect(item?.attrs.listType).toBe(to === 'ordered' ? 'ordered' : 'bullet')
        expect(item?.attrs.checked).toBe(to === 'task' ? false : null)
      })
    }
  }
})
