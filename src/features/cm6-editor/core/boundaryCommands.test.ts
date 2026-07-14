import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  cleanupEmptyMarkdownFormatting,
  headingBoundaryDeletion,
  insertContainerMarkdownHardBreak,
  insertMarkdownHardBreak,
  joinContainerMarkdownBlock,
  listBoundaryDeletion,
  quoteBoundaryDeletion,
  splitContainerMarkdownBlock,
  splitTopLevelMarkdownBlock,
} from './boundaryCommands'

function createState(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  })
}

function deleteAsUser(state: EditorState, from: number, to: number): EditorState {
  const deletion = {
    changes: { from, to },
    annotations: Transaction.userEvent.of('delete.selection'),
  }
  const transaction = state.update(deletion)
  const cleanup = cleanupEmptyMarkdownFormatting(transaction)
  return cleanup ? state.update(deletion, cleanup).state : transaction.state
}

function deleteAtHeadingBoundary(state: EditorState, forward: boolean): EditorState {
  const spec = headingBoundaryDeletion(state, forward)
  return spec ? state.update(spec).state : state
}

function deleteAtListBoundary(state: EditorState, forward: boolean): EditorState {
  const spec = listBoundaryDeletion(state, forward)
  return spec ? state.update(spec).state : state
}

function deleteAtQuoteBoundary(state: EditorState, forward: boolean): EditorState {
  const spec = quoteBoundaryDeletion(state, forward)
  return spec ? state.update(spec).state : state
}

describe('block split/join commands', () => {
  it('splits top-level paragraphs like ProseMirror instead of inserting a soft source line', () => {
    const middle = createState('AlphaBeta', 5)
    const splitMiddle = splitTopLevelMarkdownBlock(middle)
    expect(splitMiddle).not.toBeNull()
    const afterMiddle = middle.update(splitMiddle!).state
    expect(afterMiddle.doc.toString()).toBe('Alpha\n\nBeta')
    expect(afterMiddle.selection.main.head).toBe(7)

    const end = createState('Alpha', 5)
    const splitEnd = splitTopLevelMarkdownBlock(end)
    expect(splitEnd).not.toBeNull()
    const afterEnd = end.update(splitEnd!).state
    expect(afterEnd.doc.toString()).toBe('Alpha\n\n')
    expect(afterEnd.selection.main.head).toBe(6)

    const softLine = createState('Alpha\nBeta', 5)
    const splitSoftLine = splitTopLevelMarkdownBlock(softLine)
    expect(splitSoftLine).not.toBeNull()
    expect(softLine.update(splitSoftLine!).state.doc.toString()).toBe('Alpha\n\nBeta')

    const heading = createState('# AlphaBeta', 7)
    const splitHeading = splitTopLevelMarkdownBlock(heading)
    expect(splitHeading).not.toBeNull()
    expect(heading.update(splitHeading!).state.doc.toString()).toBe('# Alpha\n\nBeta')
  })

  it('writes Shift+Enter as a portable hard break', () => {
    const state = createState('AlphaBeta', 5)
    const hardBreak = insertMarkdownHardBreak(state)
    expect(hardBreak).not.toBeNull()
    expect(state.update(hardBreak!).state.doc.toString()).toBe('Alpha\\\nBeta')
  })

  it('splits and exits quote/list containers as Markdown blocks', () => {
    const list = createState('- first', 7)
    const splitList = splitContainerMarkdownBlock(list)
    expect(splitList).not.toBeNull()
    expect(list.update(splitList!).state.doc.toString()).toBe('- first\n- ')

    const ordered = createState('3. third', 8)
    const splitOrdered = splitContainerMarkdownBlock(ordered)
    expect(splitOrdered).not.toBeNull()
    expect(ordered.update(splitOrdered!).state.doc.toString()).toBe('3. third\n4. ')

    const quote = createState('> quote', 7)
    const splitQuote = splitContainerMarkdownBlock(quote)
    expect(splitQuote).not.toBeNull()
    expect(quote.update(splitQuote!).state.doc.toString()).toBe('> quote\n> ')

    const exitList = splitContainerMarkdownBlock(createState('- ', 2))
    expect(exitList).not.toBeNull()
    expect(createState('- ', 2).update(exitList!).state.doc.toString()).toBe('')

    const exitQuote = splitContainerMarkdownBlock(createState('> ', 2))
    expect(exitQuote).not.toBeNull()
    expect(createState('> ', 2).update(exitQuote!).state.doc.toString()).toBe('')
  })

  it('keeps list and quote containers when Shift+Enter inserts a hard break', () => {
    const list = createState('- first', 7)
    const listBreak = insertContainerMarkdownHardBreak(list)
    expect(listBreak).not.toBeNull()
    expect(list.update(listBreak!).state.doc.toString()).toBe('- first\\\n  ')

    const quote = createState('> quote', 7)
    const quoteBreak = insertContainerMarkdownHardBreak(quote)
    expect(quoteBreak).not.toBeNull()
    expect(quote.update(quoteBreak!).state.doc.toString()).toBe('> quote\\\n> ')
  })

  it('joins adjacent compatible list items and quote paragraphs at their block edge', () => {
    const list = createState('- first\n- second', 7)
    const forward = joinContainerMarkdownBlock(list, true)
    expect(forward).not.toBeNull()
    expect(list.update(forward!).state.doc.toString()).toBe('- firstsecond')

    const backwardList = createState('- first\n- second', 10)
    const backward = joinContainerMarkdownBlock(backwardList, false)
    expect(backward).not.toBeNull()
    expect(backwardList.update(backward!).state.doc.toString()).toBe('- firstsecond')

    const quote = createState('> first\n> second', 7)
    const quoteJoin = joinContainerMarkdownBlock(quote, true)
    expect(quoteJoin).not.toBeNull()
    expect(quote.update(quoteJoin!).state.doc.toString()).toBe('> firstsecond')
  })
})

describe('heading boundary deletion', () => {
  it('turns a heading into a paragraph when Backspace is pressed at its visual left edge', () => {
    const state = createState('## Heading', 3)
    const result = deleteAtHeadingBoundary(state, false)

    expect(result.doc.toString()).toBe('Heading')
    expect(result.selection.main.head).toBe(0)
  })

  it('deletes the first visible heading character with Delete at either atomic boundary', () => {
    for (const cursor of [0, 3]) {
      const result = deleteAtHeadingBoundary(createState('## 👍🏽Title', cursor), true)
      expect(result.doc.toString()).toBe('## Title')
      expect(result.selection.main.head).toBe(3)
    }
  })

  it('removes only the blank line above a heading, keeping the heading intact', () => {
    const doc = 'before\n\n## Heading'
    const cursor = doc.indexOf('Heading')
    const result = deleteAtHeadingBoundary(createState(doc, cursor), false)
    expect(result.doc.toString()).toBe('before\n## Heading')
    expect(result.selection.main.head).toBe('before\n## '.length)
    // The heading keeps its level: no special "editable blank paragraph"
    // bookkeeping is needed anymore for the result to be well-formed.
    expect(result.doc.line(2).text).toBe('## Heading')
  })

  it('leaves a genuinely blank, ordinary line behind once a heading is emptied out', () => {
    const state = createState('# Title\nnext', 2)
    const result = deleteAsUser(state, 2, 7)

    expect(result.doc.toString()).toBe('\nnext')
    expect(result.selection.main.head).toBe(0)
    expect(result.doc.line(1).length).toBe(0)
  })

  it('never creates hidden-marker deletion transactions in read-only mode', () => {
    const state = EditorState.create({
      doc: '# Heading\n- item\n> quote',
      selection: EditorSelection.cursor(2),
      extensions: [markdown({ base: markdownLanguage }), EditorState.readOnly.of(true)],
    })

    expect(headingBoundaryDeletion(state, false)).toBeNull()
    expect(listBoundaryDeletion(state, false)).toBeNull()
    expect(quoteBoundaryDeletion(state, false)).toBeNull()
  })
})

describe('list boundary deletion', () => {
  it('turns a top-level list item into a paragraph at its visual left edge', () => {
    for (const doc of ['- item', '1. item', '- [ ] task']) {
      const cursor = doc.indexOf(doc.endsWith('task') ? 'task' : 'item')
      const result = deleteAtListBoundary(createState(doc, cursor), false)
      expect(result.doc.toString()).toBe(doc.endsWith('task') ? 'task' : 'item')
      expect(result.selection.main.head).toBe(0)
    }
  })

  it('outdents one level instead of removing a nested list marker', () => {
    const result = deleteAtListBoundary(createState('    - nested', 6), false)

    expect(result.doc.toString()).toBe('  - nested')
    expect(result.selection.main.head).toBe(4)
  })

  it('deletes one visible grapheme at a list marker boundary', () => {
    for (const cursor of [0, 2]) {
      const result = deleteAtListBoundary(createState('- 👍🏽item', cursor), true)
      expect(result.doc.toString()).toBe('- item')
      expect(result.selection.main.head).toBe(2)
    }
  })

  it('keeps quote prefixes while deleting a nested list prefix', () => {
    const doc = '> - quoted'
    const result = deleteAtListBoundary(createState(doc, doc.indexOf('quoted')), false)

    expect(result.doc.toString()).toBe('> quoted')
    expect(result.selection.main.head).toBe(2)
  })
})

describe('quote boundary deletion', () => {
  it('removes one quote level or one visible grapheme at the quote boundary', () => {
    const nested = deleteAtQuoteBoundary(createState('> > quoted', 4), false)
    expect(nested.doc.toString()).toBe('> quoted')
    expect(nested.selection.main.head).toBe(2)

    const deleted = deleteAtQuoteBoundary(createState('> 👍🏽quoted', 0), true)
    expect(deleted.doc.toString()).toBe('> quoted')
    expect(deleted.selection.main.head).toBe(2)
  })

  it('leaves an ordinary blank line behind when the only quote level is removed', () => {
    const result = deleteAtQuoteBoundary(createState('> quoted', 0), false)
    expect(result.doc.toString()).toBe('quoted')
  })
})

describe('cleanupEmptyMarkdownFormatting', () => {
  it.each([
    ['# title', 2, 7, ''],
    ['# title #', 2, 7, ''],
    ['**bold**', 2, 6, ''],
    ['*italic*', 1, 7, ''],
    ['~~strike~~', 2, 8, ''],
    ['`code`', 1, 5, ''],
    ['[label](https://example.com)', 1, 6, ''],
  ])(
    'cleans the whole %s construct when its visible content is deleted',
    (doc, from, to, result) => {
      expect(deleteAsUser(createState(doc), from, to).doc.toString()).toBe(result)
    },
  )

  it('cleans nested markers and their empty heading in one deletion', () => {
    const doc = '# ***title***'
    const from = doc.indexOf('title')
    expect(deleteAsUser(createState(doc), from, from + 5).doc.toString()).toBe('')
  })

  it('does not clean formatting when replacement leaves visible content', () => {
    const state = createState('**bold**')
    const change = {
      changes: { from: 2, to: 6, insert: 'new' },
      annotations: Transaction.userEvent.of('delete.selection'),
    }
    const transaction = state.update(change)
    expect(cleanupEmptyMarkdownFormatting(transaction)).toBeNull()
    expect(transaction.newDoc.toString()).toBe('**new**')
  })

  it('does not clean marker-looking text inside fenced code', () => {
    const doc = '```md\n**bold**\n```'
    const state = createState(doc)
    const from = doc.indexOf('bold')
    expect(deleteAsUser(state, from, from + 4).doc.toString()).toBe('```md\n****\n```')
  })
})
