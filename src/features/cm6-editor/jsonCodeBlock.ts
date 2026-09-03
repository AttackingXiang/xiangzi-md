/**
 * Pretty-printing support for `json` fenced code blocks.
 *
 * Kept separate from the overlay that renders the button so the two decisions
 * that actually have edge cases — "does this block accept formatting" and
 * "what does formatting produce" — are plain functions with tests, rather than
 * behaviour reachable only through a mounted CodeMirror view.
 */

/** Two spaces, matching the JSON formatting the plain-text editor applies. */
const JSON_INDENT = 2

/**
 * Whether a fence's info string marks a block `JSON.parse` can handle.
 *
 * Deliberately stricter than the language resolution used for syntax
 * highlighting: `@codemirror/language-data` treats `jsonc`, `json5` and
 * `geojson` as aliases of JSON, but the first two exist precisely to allow
 * comments, trailing commas and unquoted keys — all of which `JSON.parse`
 * rejects. Offering the button there would mean offering an action that fails
 * on perfectly valid documents, so only a plain `json` fence qualifies.
 */
export function isFormattableJsonLanguage(language: string): boolean {
  return language.trim().toLowerCase() === 'json'
}

export type JsonFormatResult = { ok: true; text: string } | { ok: false; message: string }

/**
 * Re-indent JSON source, reporting the parse error instead of throwing.
 *
 * Returns `ok: true` only when the result differs from the input, so an
 * already-formatted block does not push a no-op edit onto the undo stack.
 */
export function formatJsonSource(source: string): JsonFormatResult | null {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  const text = JSON.stringify(value, null, JSON_INDENT)
  // `JSON.stringify` returns undefined for a bare `undefined`, which
  // `JSON.parse` cannot produce — but a document is not a place to rely on
  // that, so treat a missing result as "nothing to do".
  if (text === undefined) return null
  return text === source ? null : { ok: true, text }
}
