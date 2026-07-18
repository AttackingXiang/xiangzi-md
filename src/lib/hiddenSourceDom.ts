/**
 * Marks source syntax that must remain in CodeMirror's DOM for stable browser
 * geometry, but is not part of the rendered document's semantic content.
 *
 * Consumers that clone the editor DOM (HTML export, rich clipboard) must call
 * `removeHiddenSource` before reading `textContent` or serializing markup.
 */
export const HIDDEN_SOURCE_ATTRIBUTE = 'data-xmd-hidden-source'
export const HIDDEN_SOURCE_SELECTOR = `[${HIDDEN_SOURCE_ATTRIBUTE}]`

export function removeHiddenSource(root: ParentNode): void {
  root.querySelectorAll(HIDDEN_SOURCE_SELECTOR).forEach((node) => node.remove())
}
