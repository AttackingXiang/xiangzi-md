import { describe, expect, it } from 'vitest'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import {
  headingLevelFromState,
  shiftedHeadingLevel,
  shouldClearHeadingOnBackspace,
} from './editorCommands'

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

const backspace = {
  key: 'Backspace',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
}

function stateAt(block: 'heading' | 'paragraph', offset: number): EditorState {
  const node = schema.node(block, block === 'heading' ? { level: 6 } : null, [
    schema.text('Heading'),
  ])
  const doc = schema.node('doc', null, [node])
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, 1 + offset),
  })
}

describe('shiftedHeadingLevel', () => {
  it('promotes and demotes headings within H1-H6', () => {
    expect(shiftedHeadingLevel(3, 'promote')).toBe(2)
    expect(shiftedHeadingLevel(3, 'demote')).toBe(4)
  })

  it('keeps heading levels inside the supported range', () => {
    expect(shiftedHeadingLevel(1, 'promote')).toBe(1)
    expect(shiftedHeadingLevel(6, 'demote')).toBe(6)
  })
})

describe('shouldClearHeadingOnBackspace', () => {
  it('clears any heading level with one plain Backspace at the block start', () => {
    const state = stateAt('heading', 0)
    expect(headingLevelFromState(state)).toBe(6)
    expect(shouldClearHeadingOnBackspace(state, backspace)).toBe(true)
  })

  it('leaves normal deletion and modified shortcuts to the editor', () => {
    expect(shouldClearHeadingOnBackspace(stateAt('heading', 1), backspace)).toBe(false)
    expect(shouldClearHeadingOnBackspace(stateAt('paragraph', 0), backspace)).toBe(false)
    expect(
      shouldClearHeadingOnBackspace(stateAt('heading', 0), {
        ...backspace,
        altKey: true,
      }),
    ).toBe(false)
  })
})
