import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { Tree } from '@lezer/common'
import {
  EditorState,
  Prec,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
  type KeyBinding,
} from '@codemirror/view'
import { hiddenRangeSource, type HiddenRange } from './core/hiddenRanges'
import type { PreviewRange } from './core/types'
import { viewportDecorationExtension } from './viewportDecorations'
import { setMermaidSourceRange } from './mermaidPreview'
import {
  fencedCodeAt,
  fencedCodeAtSelection,
  isCodeBlockPresentation,
  readFencedCode,
} from './codeBlockDetection'
import { codeBlockScrolling, type CodeBlockPreviewOptions } from './codeBlockScrollOverlay'

export { readFencedCode }
export { selectionIntersectsFencedCode, needsCodeCaretRepaint } from './codeBlockDetection'
export type { CodeBlockPreviewOptions } from './codeBlockScrollOverlay'

export {
  codeBlockOverlayHorizontalGeometry,
  codeControlsFitInside,
  codeControlsTop,
  pinnedOverlayTop,
} from './codeBlockGeometry'
export type { CodeBlockOverlayHorizontalGeometry, OverlayPinGeometry } from './codeBlockGeometry'

export {
  codeLanguageOptions,
  matchingCodeLanguageOptions,
  resolveCodeLanguageInput,
} from './codeBlockLanguage'

/** Move to the logical source-line boundary inside fenced code. CM6's default
 * visual-line Home/End commands treat a nested horizontal scroller's visible
 * edge as a line boundary, which can leave the cursor hundreds of columns into
 * a long line. */
export function fencedCodeLineBoundary(
  state: EditorState,
  forward: boolean,
  extend = false,
): TransactionSpec | null {
  if (state.selection.ranges.length !== 1) return null
  const range = state.selection.main
  const data = fencedCodeAt(state, range.head)
  if (
    !data ||
    !isCodeBlockPresentation(state, data) ||
    range.head < data.codeFrom ||
    range.head > data.codeTo
  )
    return null
  const line = state.doc.lineAt(range.head)
  const head = forward ? line.to : line.from
  return {
    selection: { anchor: extend ? range.anchor : head, head },
    scrollIntoView: true,
  }
}

function fencedCodeBoundaryKeybinding(
  shortcut: Pick<KeyBinding, 'key' | 'mac'>,
  forward: boolean,
): KeyBinding {
  const dispatch = (view: EditorView, extend: boolean): boolean => {
    const spec = fencedCodeLineBoundary(view.state, forward, extend)
    if (!spec) return false
    view.dispatch(spec)
    return true
  }
  return {
    ...shortcut,
    run: (view) => dispatch(view, false),
    shift: (view) => dispatch(view, true),
  }
}

/**
 * Fenced-code-specific Backspace ("forward: false") / Delete ("forward:
 * true") boundary command, in the same pure-`TransactionSpec` style as
 * `core/boundaryCommands.ts`'s heading/list/quote boundary commands. It only
 * has an opinion near the block's sole blank body row — everywhere else
 * (including ordinary joins between code lines) it returns `null` so CM6's
 * defaults, which are correct now that the fence lines are atomic, run
 * unmodified.
 *
 * - Delete at the start of a blank last body row is swallowed (`{}`, a no-op
 *   transaction) so it cannot eat the boundary immediately before the hidden
 *   closing fence and surface it as an editable position.
 * - Backspace at the start of the *sole* blank body row — i.e. the block's
 *   body is already empty — removes the whole block (both fences) in a
 *   single transaction, so it never passes through an intermediate state
 *   where only the closing fence has been removed (which would let the next
 *   fence in the document parse as this block's new closing marker and
 *   visually merge two blocks).
 * - Backspace at the start of the first ordinary blank line *after* a closed
 *   block removes only the closing fence's trailing newline. That newline is
 *   part of the atomic fence range, so the generic hidden-boundary command
 *   would otherwise consume the key even though the fence text is untouched.
 */
export function fencedCodeBoundaryDeletion(
  state: EditorState,
  forward: boolean,
): TransactionSpec | null {
  if (state.readOnly || !state.selection.main.empty) return null
  const position = state.selection.main.head
  if (!forward && position > 0) {
    const line = state.doc.lineAt(position)
    if (position === line.from && line.length === 0) {
      let followsClosingFence = false
      syntaxTree(state).iterate({
        from: position - 1,
        to: position,
        enter(node) {
          if (node.name !== 'FencedCode') return
          const preceding = readFencedCode(state, node.from, node.to)
          if (preceding.closingFrom === null) return false
          const closing = state.doc.lineAt(preceding.closingFrom)
          if (closing.to + 1 === position) followsClosingFence = true
          return false
        },
      })
      if (followsClosingFence) {
        return {
          changes: { from: position - 1, to: position },
          selection: { anchor: position - 1 },
          scrollIntoView: true,
          userEvent: 'delete.backward',
        }
      }
    }
  }
  const data = fencedCodeAtSelection(state)
  if (!data || data.closingFrom === null || data.codeFrom > data.closingFrom) return null
  const lastLine = state.doc.lineAt(Math.max(data.codeFrom, data.closingFrom - 1))
  if (lastLine.length !== 0) return null
  if (forward) {
    return position === lastLine.from ? {} : null
  }

  if (position !== data.codeFrom || lastLine.from !== data.codeFrom) return null
  return {
    changes: { from: data.from, to: data.to },
    selection: { anchor: data.from },
    scrollIntoView: true,
    userEvent: 'delete.backward',
  }
}

/**
 * Selection deletion can remove the final code line and its newline in one
 * transaction. Restore a single blank body line before the closing fence so
 * the next caret position remains inside the same code card.
 */
export function restoreEmptyFencedCodeBody(transaction: Transaction): TransactionSpec | null {
  if (!transaction.docChanged || !transaction.isUserEvent('delete')) return null
  const changed: PreviewRange[] = []
  transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    changed.push({ from: fromB, to: toB })
  })
  if (!changed.length) return null

  const repairs: Array<{ from: number; insert: string }> = []
  let caret: number | null = null
  syntaxTree(transaction.state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return
      const data = readFencedCode(transaction.state, node.from, node.to)
      if (data.closingFrom === null) return false
      const touched = changed.some(({ from, to }) => from <= data.closingFrom! && to >= data.from)
      if (!touched) return false
      const head = transaction.state.selection.main.head
      if (data.codeFrom === data.closingFrom) {
        repairs.push({ from: data.codeFrom, insert: '\n' })
        if (head >= data.from && head <= data.closingFrom) caret = data.codeFrom
        return false
      }
      // After the final visible character is deleted, CM6 can associate the
      // selection with the hidden closing-fence replacement. Pin it to the
      // actual blank code line instead of trusting that DOM mapping.
      if (
        transaction.state.doc.sliceString(data.codeFrom, data.codeTo).length === 0 &&
        head >= data.codeFrom &&
        head <= data.closingFrom
      )
        caret = data.lastCodeLineFrom
      return false
    },
  })
  if (!repairs.length && caret === null) return null
  return {
    changes: repairs.length ? repairs : undefined,
    selection: caret === null ? undefined : { anchor: caret },
  }
}

/**
 * A hidden closing fence must not be removed by a partial delete: without it,
 * the next fence can become this block's closing fence and two cards appear to
 * merge. Selecting the complete fenced source remains a valid block deletion.
 * With fence lines now atomic (see `collectFencedCodeHiddenRanges`), ordinary
 * cursor-driven selections can no longer straddle only part of a fence line —
 * this remains a safety net for transactions built outside cursor motion
 * (paste, undo/redo, external document sync).
 */
export function partiallyDeletesFencedCodeFence(transaction: Transaction): boolean {
  if (!transaction.docChanged || !transaction.isUserEvent('delete')) return false
  const deleted: PreviewRange[] = []
  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA) deleted.push({ from: fromA, to: toA })
  })
  if (!deleted.length) return false

  let partial = false
  syntaxTree(transaction.startState).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return
      const data = readFencedCode(transaction.startState, node.from, node.to)
      if (data.closingFrom === null) return false
      const opening = transaction.startState.doc.lineAt(data.from)
      const closing = transaction.startState.doc.lineAt(data.closingFrom)
      const touchesFence = deleted.some(
        ({ from, to }) =>
          (from < opening.to && to > opening.from) || (from < closing.to && to > closing.from),
      )
      const deletesWholeBlock = deleted.some(({ from, to }) => from <= data.from && to >= data.to)
      if (touchesFence && !deletesWholeBlock) {
        partial = true
        return false
      }
    },
  })
  return partial
}

/**
 * Cmd/Ctrl+A inside a fenced code block selects only its body, excluding both
 * fences (mirroring copy/paste semantics — see the copy control in
 * `CodeBlockControlsOverlay`, codeBlockScrollOverlay.ts).
 * Returns `null` outside a code block so the caller can fall through to
 * CM6's default select-all. Accepts an optional pre-resolved `tree` (see
 * `fencedCodeAt`'s doc comment) for the same reason as `fencedCodeContentRange`.
 */
export function fencedCodeSelectAll(state: EditorState, tree?: Tree): TransactionSpec | null {
  const data = fencedCodeAtSelection(state, tree)
  if (!data) return null
  return { selection: { anchor: data.codeFrom, head: data.codeTo } }
}

/**
 * Pure query: the fenced code body range (excluding both fence lines) that
 * contains `position`, or `null` outside any fenced code block. This is the
 * single source of truth for "what does Cmd/Ctrl+A select inside a code
 * block" — both this module's own `Mod-a` keymap (via `fencedCodeSelectAll`
 * above) and the app-level `selectAllScope` (`src/lib/editorCommands.ts`)
 * resolve through it, replacing a second hand-rolled tree walk + regex that
 * had drifted out of sync with `readFencedCode`'s tree-driven fence
 * detection (which correctly handles a fence indented ≥4 spaces under a
 * list item; a regex re-derived from physical lines does not). `tree` may be
 * an already-resolved `Tree` from `ensureSyntaxTree` for callers that need
 * to get ahead of the background parser; it is never called with
 * `ensureSyntaxTree` internally so this stays cheap for hot paths that pass
 * only `state`.
 */
export function fencedCodeContentRange(
  state: EditorState,
  position: number,
  tree?: Tree,
): { from: number; to: number } | null {
  const data = fencedCodeAt(state, position, tree)
  return data ? { from: data.codeFrom, to: data.codeTo } : null
}

/**
 * Where a pointer down on a collapsed `.xmd-cm-code-fence-line` should send
 * the caret. `linePosition` is the document position of that line's DOM
 * start (`view.posAtDOM(line, 0)`); native hit-testing on a zero-height line
 * is not meaningful, so the fence area redirects into the block instead of
 * accepting whatever position the browser resolved. Returns `null` for a
 * position that is not actually a fence line (or belongs to a Mermaid fence,
 * which owns its own block-replace preview).
 */
export function fencedCodeFenceRedirectTarget(
  state: EditorState,
  linePosition: number,
): number | null {
  const data = fencedCodeAt(state, linePosition)
  if (!data || !isCodeBlockPresentation(state, data)) return null
  const line = state.doc.lineAt(linePosition)
  const opening = state.doc.lineAt(data.from)
  if (line.from === opening.from) return data.firstCodeLineFrom
  if (data.closingFrom !== null) {
    const closing = state.doc.lineAt(data.closingFrom)
    if (line.from === closing.from) return Math.max(data.codeFrom, data.codeTo)
  }
  return null
}

function mergeVisibleRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  margin: number,
): PreviewRange[] {
  const ranges = visibleRanges
    .map((range) => ({
      from: Math.max(0, range.from - margin),
      to: Math.min(state.doc.length, range.to + margin),
    }))
    .sort((a, b) => a.from - b.from)
  const merged: PreviewRange[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else merged.push(range)
  }
  return merged
}

/**
 * Decorates fenced code without replacing its contents. CodeText remains a set
 * of ordinary outer-editor lines, so CM6 owns one document and one selection.
 * The copy/language controls and the shared scrollbar are deliberately *not*
 * part of this decoration set: as widgets anchored to the opening fence they
 * left the DOM whenever CM6's virtualized viewport dropped that line, taking
 * the controls with them mid-edit. They are scrollDOM overlays owned by
 * `CodeBlockScrollPlugin` instead.
 */
export function buildCodeBlockPreviewDecorations(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: CodeBlockPreviewOptions = {},
): DecorationSet {
  const decorations: Array<ReturnType<Decoration['range']>> = []
  const seen = new Set<number>()
  const margin = Math.max(0, options.viewportMargin ?? 256)
  const codeLineClass = options.lineWrapping ? 'xmd-cm-code-line-wrap' : ''

  for (const visible of mergeVisibleRanges(state, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'FencedCode' || seen.has(node.from)) return
        seen.add(node.from)
        const data = readFencedCode(state, node.from, node.to)
        if (!isCodeBlockPresentation(state, data)) return false

        const opening = state.doc.lineAt(data.from)
        const closing = data.closingFrom === null ? null : state.doc.lineAt(data.closingFrom)
        decorations.push(
          Decoration.line({ class: 'xmd-cm-code-fence-line' }).range(opening.from),
          Decoration.replace({}).range(opening.from, opening.to),
        )
        if (closing) {
          decorations.push(
            Decoration.line({ class: 'xmd-cm-code-fence-line' }).range(closing.from),
            Decoration.replace({}).range(closing.from, closing.to),
          )
        }

        let line = state.doc.lineAt(data.codeFrom)
        while (line.from <= data.codeTo && (!closing || line.from < closing.from)) {
          const classes = ['xmd-cm-code-line']
          if (codeLineClass) classes.push(codeLineClass)
          if (line.from === data.firstCodeLineFrom) classes.push('xmd-cm-code-line-first')
          if (line.from === data.lastCodeLineFrom) classes.push('xmd-cm-code-line-last')
          decorations.push(Decoration.line({ class: classes.join(' ') }).range(line.from))
          if (line.from < line.to) {
            decorations.push(
              Decoration.mark({ class: 'xmd-cm-code-line-content', inclusiveEnd: true }).range(
                line.from,
                line.to,
              ),
            )
          }
          if (line.number >= state.doc.lines) break
          line = state.doc.line(line.number + 1)
        }
        return false
      },
    })
  }
  return Decoration.set(decorations, true)
}

/**
 * The single source of atomic/hidden ranges this feature contributes to the
 * core engine (`core/hiddenRanges.ts`), replacing the standalone
 * `EditorView.atomicRanges` provider this module used to maintain on its
 * own. Fence lines (opening `` ``` `` / closing `` ``` ``, including their
 * trailing newline) are the `atomic-block` case registered in
 * `core/nodePolicy.ts`: unlike Phase 1's inline hidden ranges, an
 * `atomic-block` range is allowed to cross its own line's newline boundary
 * (see core/README.md, invariant 2), which is what keeps a caret from ever
 * resting between the fence text and its line break. `presentation: 'external'` on every
 * range here means core never paints them — this module's own
 * `viewportDecorationExtension` StateField already does that (a cross-line
 * replace is only safe from a StateField, not core's ViewPlugin aggregator).
 */
export function collectFencedCodeHiddenRanges(
  state: EditorState,
  visibleRanges: readonly PreviewRange[],
  options: CodeBlockPreviewOptions = {},
): HiddenRange[] {
  const hidden: HiddenRange[] = []
  const seen = new Set<number>()
  const margin = Math.max(0, options.viewportMargin ?? 256)

  for (const visible of mergeVisibleRanges(state, visibleRanges, margin)) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'FencedCode' || seen.has(node.from)) return
        seen.add(node.from)
        const data = readFencedCode(state, node.from, node.to)
        if (!isCodeBlockPresentation(state, data)) return false

        const opening = state.doc.lineAt(data.from)
        hidden.push({
          from: opening.from,
          to: Math.min(state.doc.length, opening.to + 1),
          presentation: 'external',
        })
        if (data.closingFrom !== null) {
          const closing = state.doc.lineAt(data.closingFrom)
          hidden.push({
            from: closing.from,
            to: Math.min(state.doc.length, closing.to + 1),
            presentation: 'external',
          })
        }
        return false
      },
    })
  }
  return hidden
}

export function markdownCodeBlockPreview(options: CodeBlockPreviewOptions = {}): Extension {
  return [
    codeBlockScrolling(options),
    viewportDecorationExtension(
      (view) => buildCodeBlockPreviewDecorations(view.state, view.visibleRanges, options),
      // None of these decorations depends on the selection. Rebuilding the
      // StateField after every caret move makes CM6 invalidate line geometry
      // in a microtask, which produces a visible two-stage caret jump.
      // (No `rebuildOnUpdate` readOnly trigger anymore: the read-only flag
      // only affected the controls widget, which is no longer a decoration —
      // CodeBlockScrollPlugin re-applies it to the overlay on measure.)
      {
        rebuildOnSelection: false,
        rebuildOnSyntaxTree: true,
        rebuildOnUpdate: (update) =>
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setMermaidSourceRange)),
          ),
      },
    ),
    hiddenRangeSource.of(({ state, visibleRanges }) =>
      collectFencedCodeHiddenRanges(state, visibleRanges, options),
    ),
    EditorState.transactionFilter.of((transaction) => {
      if (partiallyDeletesFencedCodeFence(transaction)) return []
      const repair = restoreEmptyFencedCodeBody(transaction)
      return repair ? [transaction, repair] : transaction
    }),
    Prec.high(
      keymap.of([
        {
          key: 'Backspace',
          run: (view) => {
            const spec = fencedCodeBoundaryDeletion(view.state, false)
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        },
        {
          key: 'Delete',
          run: (view) => {
            const spec = fencedCodeBoundaryDeletion(view.state, true)
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        },
        {
          key: 'Mod-a',
          run: (view) => {
            // Background parsing may not have reached the caret yet (a busy
            // editor, or a document just opened). Force it up to the caret
            // first so a not-yet-parsed fence doesn't make this fall back to
            // selecting the whole document — the same race `selectAllScope`
            // in `src/lib/editorCommands.ts` guards against. `ensureSyntaxTree`
            // returns a tree independent of `syntaxTree(state)`'s cached
            // field, so its result must be threaded through explicitly.
            const tree =
              ensureSyntaxTree(
                view.state,
                Math.min(view.state.doc.length, view.state.selection.main.head + 1),
                100,
              ) ?? undefined
            const spec = fencedCodeSelectAll(view.state, tree)
            if (!spec) return false
            view.dispatch(spec)
            return true
          },
        },
        fencedCodeBoundaryKeybinding({ key: 'Home' }, false),
        fencedCodeBoundaryKeybinding({ key: 'End' }, true),
        fencedCodeBoundaryKeybinding({ mac: 'Cmd-ArrowLeft' }, false),
        fencedCodeBoundaryKeybinding({ mac: 'Cmd-ArrowRight' }, true),
      ]),
    ),
    EditorView.domEventHandlers({
      pointerdown(event, view) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return false
        const target = event.target
        if (!(target instanceof Element)) return false
        const line = target.closest<HTMLElement>('.cm-line')
        if (!line || line.parentElement !== view.contentDOM) return false
        if (!line.classList.contains('xmd-cm-code-fence-line')) return false
        const linePosition = view.posAtDOM(line, 0)
        const anchor = fencedCodeFenceRedirectTarget(view.state, linePosition)
        if (anchor === null || view.state.selection.main.head === anchor) return false
        event.preventDefault()
        view.dispatch({ selection: { anchor }, scrollIntoView: true })
        view.focus()
        return true
      },
    }),
  ]
}
