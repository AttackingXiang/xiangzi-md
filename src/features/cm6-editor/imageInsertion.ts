import { isolateHistory } from '@codemirror/commands'
import { StateEffect, StateField, type ChangeDesc, type Extension } from '@codemirror/state'
import { ViewPlugin, type EditorView } from '@codemirror/view'

export interface ImageInsertionOptions {
  upload: (file: File) => Promise<string>
  onError?: (error: unknown, file: File) => void
}

export interface PendingImageAnchor {
  id: number
  from: number
  to: number
}

type AddAnchor = PendingImageAnchor

export function mapPendingImageAnchor(
  anchor: PendingImageAnchor,
  changes: ChangeDesc,
): PendingImageAnchor {
  if (anchor.from === anchor.to) {
    const position = changes.mapPos(anchor.from, 1)
    return { ...anchor, from: position, to: position }
  }
  const from = changes.mapPos(anchor.from, 1)
  const to = changes.mapPos(anchor.to, -1)
  return { ...anchor, from: Math.min(from, to), to: Math.max(from, to) }
}

function escapeAlt(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/([\\\[\]])/g, '\\$1')
}

function escapeDestination(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, (character) => encodeURIComponent(character))
    .replace(/([\\>])/g, '\\$1')
}

export function markdownImageInsertionText(fileName: string, path: string): string {
  const alt = escapeAlt(fileName || 'image') || 'image'
  return `![${alt}](<${escapeDestination(path)}>)`
}

const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i

export function isImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  const type = file.type.toLowerCase()
  return (
    type.startsWith('image/') ||
    ((!type || type === 'application/octet-stream') && IMAGE_FILE_EXTENSION.test(file.name))
  )
}

function imageFiles(files: FileList | null): File[] {
  return files ? Array.from(files).filter(isImageFile) : []
}

/**
 * Uploads pasted/dropped images and inserts Markdown at a transaction-mapped
 * anchor. Normal clipboard text and read-only editors are never intercepted.
 */
export function imageInsertion(options: ImageInsertionOptions): Extension {
  const addAnchor = StateEffect.define<AddAnchor>()
  const removeAnchor = StateEffect.define<number>()
  const anchors = StateField.define<ReadonlyMap<number, PendingImageAnchor>>({
    create: () => new Map(),
    update(value, transaction) {
      const next = new Map<number, PendingImageAnchor>()
      for (const [id, anchor] of value) {
        next.set(
          id,
          transaction.docChanged ? mapPendingImageAnchor(anchor, transaction.changes) : anchor,
        )
      }
      for (const effect of transaction.effects) {
        if (effect.is(addAnchor)) next.set(effect.value.id, effect.value)
        if (effect.is(removeAnchor)) next.delete(effect.value)
      }
      return next
    },
  })

  let nextId = 0
  interface UploadRuntime {
    alive: boolean
  }

  const beginUpload = (
    view: EditorView,
    files: File[],
    from: number,
    to: number,
    origin: 'paste' | 'drop',
  ): boolean => {
    if (view.state.readOnly || !files.length) return false
    const id = ++nextId
    view.dispatch({ effects: addAnchor.of({ id, from, to }) })

    void Promise.all(
      files.map(async (file) => {
        try {
          const path = await options.upload(file)
          return path ? markdownImageInsertionText(file.name, path) : null
        } catch (error) {
          try {
            options.onError?.(error, file)
          } catch {
            // Error reporting must never break anchor cleanup.
          }
          return null
        }
      }),
    ).then((markdownItems) => {
      if (!view.plugin(runtime)?.alive) return
      const anchor = view.state.field(anchors).get(id)
      if (!anchor) return
      if (view.state.readOnly) {
        view.dispatch({ effects: removeAnchor.of(id) })
        return
      }
      const markdown = markdownItems.filter((item): item is string => item !== null).join('\n')
      view.dispatch({
        changes: markdown ? { from: anchor.from, to: anchor.to, insert: markdown } : undefined,
        effects: removeAnchor.of(id),
        annotations: isolateHistory.of('full'),
        userEvent: origin === 'paste' ? 'input.paste' : 'input.drop',
      })
    })
    return true
  }

  const runtime = ViewPlugin.fromClass<UploadRuntime>(
    class implements UploadRuntime {
      alive = true
      destroy(): void {
        this.alive = false
      }
    },
    {
      eventHandlers: {
        paste(event, view) {
          const files = imageFiles(event.clipboardData?.files ?? null)
          const selection = view.state.selection.main
          const handled = beginUpload(view, files, selection.from, selection.to, 'paste')
          if (handled) event.preventDefault()
          return handled
        },
        drop(event, view) {
          const files = imageFiles(event.dataTransfer?.files ?? null)
          if (!files.length || view.state.readOnly) return false
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
          const fallback = view.state.selection.main.head
          const handled = beginUpload(
            view,
            files,
            position ?? fallback,
            position ?? fallback,
            'drop',
          )
          if (handled) event.preventDefault()
          return handled
        },
      },
    },
  )

  return [anchors, runtime]
}
