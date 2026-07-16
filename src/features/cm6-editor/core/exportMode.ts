import { Facet } from '@codemirror/state'

/** Export views show the rendered form even though an EditorState always has a selection. */
export const cm6ExportMode = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})
