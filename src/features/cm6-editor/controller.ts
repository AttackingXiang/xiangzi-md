import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { cm6ActiveViewBridge } from './activeViewBridge'
import { applyChangeSetToString } from './applyChangeSet'
import { createBaseExtensions, defaultCm6Theme } from './extensions'
import {
  createExternalSyncTransaction,
  isExternalDocumentSync,
  normalizeEditorDocument,
} from './sync'
import type { Cm6EditorController, Cm6EditorOptions } from './types'

function editableExtension(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

function wrappingExtension(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : []
}

/** Mounts one framework-agnostic EditorView owned by the returned controller. */
export function createCm6Editor(options: Cm6EditorOptions): Cm6EditorController {
  const editable = new Compartment()
  const wrapping = new Compartment()
  const customExtensions = new Compartment()
  const theme = new Compartment()
  let onChange = options.onChange
  let destroyed = false
  // This is the authoritative serialized document. Local transactions update
  // it incrementally so the input hot path never calls state.doc.toString().
  let mirror = normalizeEditorDocument(options.value)

  const state = EditorState.create({
    doc: mirror,
    extensions: [
      createBaseExtensions(),
      editable.of(editableExtension(options.readOnly ?? false)),
      wrapping.of(wrappingExtension(options.lineWrapping ?? true)),
      customExtensions.of(options.extensions ?? []),
      theme.of(options.theme ?? defaultCm6Theme),
      EditorView.contentAttributes.of({ 'aria-label': options.ariaLabel ?? 'Markdown editor' }),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged && update.view.hasFocus) cm6ActiveViewBridge.activate(update.view)
        if (update.docChanged) {
          mirror = applyChangeSetToString(mirror, update.changes)
          if (!update.transactions.every(isExternalDocumentSync)) onChange?.(mirror, update)
        }
      }),
    ],
  })
  const view = new EditorView({ state, parent: options.parent })
  const unregister = cm6ActiveViewBridge.register(view)
  options.onReady?.(view)
  if (options.autoFocus) view.focus()

  const reconfigure = (effect: ReturnType<Compartment['reconfigure']>): void => {
    if (!destroyed) view.dispatch({ effects: effect })
  }

  return {
    view,
    focus: () => {
      if (!destroyed) view.focus()
    },
    setValue: (value) => {
      if (destroyed) return
      const normalizedValue = normalizeEditorDocument(value)
      const transaction = createExternalSyncTransaction(view.state, normalizedValue, mirror)
      if (transaction) {
        // EditorView.dispatch is synchronous: the listener applies the external
        // ChangeSet to the old mirror before this assignment confirms the value.
        view.dispatch(transaction)
        mirror = normalizedValue
      }
    },
    setReadOnly: (readOnly) => reconfigure(editable.reconfigure(editableExtension(readOnly))),
    setLineWrapping: (enabled) => reconfigure(wrapping.reconfigure(wrappingExtension(enabled))),
    setExtensions: (extensions) => reconfigure(customExtensions.reconfigure(extensions)),
    setTheme: (extension) => reconfigure(theme.reconfigure(extension)),
    setOnChange: (listener) => {
      if (!destroyed) onChange = listener
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      onChange = undefined
      mirror = ''
      unregister()
      view.destroy()
    },
  }
}
