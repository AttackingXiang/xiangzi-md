/**
 * Pure helpers for preserving a Markdown document's original line-ending
 * style (LF vs CRLF) across the read → edit → write round trip.
 *
 * CodeMirror 6's document model only understands LF: everything that reaches
 * the editor is normalized to `\n` (see
 * `cm6-editor/sync.ts::normalizeEditorDocument`). That means once a tab has
 * been edited even once, its in-memory content is pure LF, regardless of
 * what line endings the file on disk originally used. Writing that content
 * straight back to disk would silently rewrite every line ending in the
 * file, turning a one-line edit into a full-file diff.
 *
 * The fix lives entirely outside the editor: detect the original style once,
 * when a file is opened (see `detectLineEnding`), keep it attached to the
 * document's own state (e.g. `Tab.eol`), and re-apply it once, right before
 * the content leaves the app and touches disk (see `applyLineEnding`). The
 * editor itself stays fully LF-only and is never aware any of this happens.
 */

export type LineEnding = 'lf' | 'crlf'

/**
 * Detects which line-ending style a raw file's content predominantly uses.
 *
 * Rule: count `\r\n` occurrences and "lone" `\n` occurrences (an `\n` that is
 * not part of a `\r\n` pair). If CRLF pairs strictly outnumber lone LFs, the
 * content is treated as `'crlf'`; otherwise — including an exact tie and
 * content with no line breaks at all (new/empty files) — it is treated as
 * `'lf'`. LF is deliberately the default for every ambiguous case: it is
 * both CodeMirror's native format and the safer assumption when there is no
 * clear signal either way.
 *
 * Old-Mac-style lone `\r` (a carriage return with no following `\n`) is
 * intentionally not detected as its own style and is never preserved: the
 * CM6 normalization layer already collapses lone `\r` into `\n` the instant
 * content enters the editor (`value.replace(/\r\n?/g, '\n')`), so by the
 * time a save happens there is no lossless way to tell "this used to be a
 * lone \r" apart from "this was already \n". Lone-CR line endings are also
 * effectively extinct in real-world files, so falling back to `'lf'` for
 * them is a non-issue in practice.
 */
export function detectLineEnding(content: string): LineEnding {
  const crlfCount = (content.match(/\r\n/g) ?? []).length
  const totalLfCount = (content.match(/\n/g) ?? []).length
  // Every \r\n pair contains exactly one \n, so subtracting crlfCount from
  // the total \n count leaves only the LFs that stand on their own.
  const loneLfCount = totalLfCount - crlfCount
  return crlfCount > loneLfCount ? 'crlf' : 'lf'
}

/**
 * Converts pure-LF editor output back to the given line-ending style right
 * before it is written to disk.
 *
 * Callers are expected to pass content that is already pure LF (that is all
 * CodeMirror ever produces), but this function normalizes defensively first
 * — collapsing any `\r\n` or lone `\r` down to `\n` — before expanding to
 * `\r\n` when `eol === 'crlf'`. That makes it idempotent and safe to call
 * even on content that unexpectedly already contains CRLF or mixed line
 * endings, without ever producing a doubled `\r\r\n`.
 */
export function applyLineEnding(content: string, eol: LineEnding): string {
  const normalized = content.replace(/\r\n?/g, '\n')
  return eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized
}
