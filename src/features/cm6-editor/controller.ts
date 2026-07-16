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
      // `mirror` is always LF-normalized (see sync.ts's `createExternalSyncTransaction`
      // doc comment for the contract), so it can be passed straight through as
      // `currentValue` — normalizing `value` here too would just repeat the
      // normalization `createExternalSyncTransaction` already does internally.
      const transaction = createExternalSyncTransaction(view.state, value, mirror)
      if (transaction) {
        // EditorView.dispatch is synchronous: the listener applies the external
        // ChangeSet to the old mirror first. Re-derive mirror from the now
        // up-to-date (and by construction LF-normalized) view doc instead of
        // normalizing `value` a second time.
        view.dispatch(transaction)
        mirror = view.state.doc.toString()
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
