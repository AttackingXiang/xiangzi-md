import type { Extension } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'

export interface Cm6EditorOptions {
  parent: HTMLElement
  value: string
  onChange?: (value: string, update: ViewUpdate) => void
  onReady?: (view: EditorView) => void
  readOnly?: boolean
  lineWrapping?: boolean
  autoFocus?: boolean
  extensions?: readonly Extension[]
  theme?: Extension
  ariaLabel?: string
}

export interface Cm6EditorController {
  readonly view: EditorView
  focus(): void
  setValue(value: string): void
  setReadOnly(readOnly: boolean): void
  setLineWrapping(lineWrapping: boolean): void
  setExtensions(extensions: readonly Extension[]): void
  setTheme(theme: Extension): void
  setOnChange(onChange?: Cm6EditorOptions['onChange']): void
  destroy(): void
}
