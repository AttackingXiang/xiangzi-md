import type { Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createCm6Editor } from './controller'
import { imageInsertion } from './imageInsertion'
import { typewriterScrolling } from './writingModes'
import { setupRichClipboard } from '../../lib/richClipboard'
import { t } from '../../lib/i18n'
import type { Cm6EditorController } from './types'
import { createMarkdownPreviewExtensions } from './previewExtensions'
import type { TableColumnWidthMode } from './tablePreview'
import { markdownEditorExportBridge } from './exportBridge'
import './livePreview.css'
import './codeBlockPreview.css'
import './imagePreview.css'
import './mathPreview.css'
import './mermaidPreview.css'
import 'katex/dist/katex.min.css'
import './editor.css'

export interface MarkdownEditorProps {
  content: string
  tagBar?: ReactNode
  readingMode: boolean
  /** Keep one EditorState while switching between live preview and plain source. */
  livePreview?: boolean
  resolveImageSrc?: (src: string) => Promise<string | null> | string | null
  allowRemoteImages?: boolean
  imageMaxWidth?: number
  uploadImage?: (file: File) => Promise<string>
  onImageError?: (error: unknown, file: File) => void
  focusMode?: boolean
  typewriterMode?: boolean
  /** Wrap long lines in fenced code blocks; off by default. */
  codeBlockLineWrapping?: boolean
  tableColumnWidthMode?: TableColumnWidthMode
  tableAutoResize?: boolean
  previewThemeVersion?: string
  initialScrollTop?: number
  onScrollTopChange?: (scrollTop: number) => void
  onChange: (markdown: string) => void
  onReady?: () => void
  className?: string
  ariaLabel?: string
}

class ReactTagBarWidget extends WidgetType {
  constructor(readonly host: HTMLElement) {
    super()
  }

  eq(other: ReactTagBarWidget): boolean {
    return other.host === this.host
  }

  toDOM(): HTMLElement {
    return this.host
  }

  ignoreEvent(): boolean {
    // Property inputs, menus and links mounted through the portal own their events.
    return true
  }
}

function tagBarExtension(host: HTMLElement): Extension {
  return EditorView.decorations.of(
    Decoration.set([
      Decoration.widget({
        widget: new ReactTagBarWidget(host),
        block: true,
        side: -1,
      }).range(0),
    ]),
  )
}

const identityImageSource = (src: string): string => src

/**
 * React boundary for the CM6 Markdown core. The EditorView owns high-frequency
 * document state; React props only synchronize external document replacements.
 */
export function MarkdownEditor({
  content,
  tagBar,
  readingMode,
  livePreview = true,
  resolveImageSrc = identityImageSource,
  allowRemoteImages = false,
  imageMaxWidth = 800,
  uploadImage,
  onImageError,
  focusMode = false,
  typewriterMode = false,
  codeBlockLineWrapping = false,
  tableColumnWidthMode = 'distribute',
  tableAutoResize = true,
  previewThemeVersion = 'default',
  initialScrollTop = 0,
  onScrollTopChange,
  onChange,
  onReady,
  className,
  ariaLabel = 'Markdown editor',
}: MarkdownEditorProps): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<Cm6EditorController | null>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const onScrollTopChangeRef = useRef(onScrollTopChange)
  const resolveImageSrcRef = useRef(resolveImageSrc)
  const uploadImageRef = useRef(uploadImage)
  const onImageErrorRef = useRef(onImageError)
  const stableImageResolverRef = useRef((src: string) => resolveImageSrcRef.current(src))
  const stableImageUploadRef = useRef((file: File) => {
    const upload = uploadImageRef.current
    return upload ? upload(file) : Promise.reject(new Error('Image upload is not configured'))
  })
  const stableImageErrorRef = useRef((error: unknown, file: File) =>
    onImageErrorRef.current?.(error, file),
  )
  const imageInsertionExtensionRef = useRef<Extension | null>(null)
  if (uploadImage && !imageInsertionExtensionRef.current) {
    imageInsertionExtensionRef.current = imageInsertion({
      upload: stableImageUploadRef.current,
      onError: stableImageErrorRef.current,
    })
  } else if (!uploadImage) {
    imageInsertionExtensionRef.current = null
  }
  const imageUploadEnabled = Boolean(uploadImage)
  const previewOptionsRef = useRef({
    allowRemoteImages,
    codeBlockLineWrapping,
    imageMaxWidth,
    previewThemeVersion,
    tableColumnWidthMode,
    tableAutoResize,
  })
  const [tagPortalHost, setTagPortalHost] = useState<HTMLElement | null>(null)
  const tagPortalHostRef = useRef<HTMLElement | null>(null)
  const hasTagBar = Boolean(tagBar)

  onChangeRef.current = onChange
  onReadyRef.current = onReady
  onScrollTopChangeRef.current = onScrollTopChange
  resolveImageSrcRef.current = resolveImageSrc
  uploadImageRef.current = uploadImage
  onImageErrorRef.current = onImageError
  previewOptionsRef.current = {
    allowRemoteImages,
    codeBlockLineWrapping,
    imageMaxWidth,
    previewThemeVersion,
    tableColumnWidthMode,
    tableAutoResize,
  }

  useLayoutEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const portalHost = document.createElement('div')
    tagPortalHostRef.current = portalHost
    portalHost.className = 'xmd-cm-tag-bar-host'
    let restoringScroll = true
    let restoreFrame = 0
    let restoreAttempts = 0

    const controller = createCm6Editor({
      parent: mount,
      value: content,
      readOnly: readingMode,
      extensions: [
        createMarkdownPreviewExtensions({
          enabled: livePreview,
          resolveImageSrc: stableImageResolverRef.current,
          allowRemoteImages,
          imageMaxWidth,
          codeBlockLineWrapping,
          previewThemeVersion,
          tableColumnWidthMode,
          tableAutoResize,
        }),
        imageInsertionExtensionRef.current ?? [],
        typewriterMode ? typewriterScrolling() : [],
        hasTagBar ? tagBarExtension(portalHost) : [],
      ],
      ariaLabel,
      onChange: (markdown) => onChangeRef.current(markdown),
      onReady: () => onReadyRef.current?.(),
    })
    controllerRef.current = controller
    setTagPortalHost(portalHost)

    const unregisterExport = markdownEditorExportBridge.register(() => {
      const current = controllerRef.current
      const root = rootRef.current
      if (!current || !root) return null
      const tagBarClone = tagPortalHostRef.current?.cloneNode(true)
      const options = previewOptionsRef.current
      return {
        value: current.view.state.doc.toString(),
        width: Math.max(1, Math.round(root.getBoundingClientRect().width || 920)),
        className: [
          'xmd-cm-editor',
          tagBarClone ? 'has-tag-bar' : '',
          'is-reading',
          'is-live-preview',
          'xmd-export-renderer',
        ]
          .filter(Boolean)
          .join(' '),
        extensions: [
          createMarkdownPreviewExtensions({
            enabled: true,
            resolveImageSrc: stableImageResolverRef.current,
            ...options,
          }),
          tagBarClone instanceof HTMLElement ? tagBarExtension(tagBarClone) : [],
        ],
      }
    })

    const scroller = controller.view.scrollDOM
    const disposeRichClipboard = setupRichClipboard(mount, stableImageResolverRef.current)
    const reportScroll = (): void => {
      if (!restoringScroll) onScrollTopChangeRef.current?.(scroller.scrollTop)
    }
    scroller.addEventListener('scroll', reportScroll, { passive: true })

    // CM6 lays out synchronously, but live-preview line heights settle over the
    // next frames. Reapply briefly without reporting these internal scrolls.
    const restoreScroll = (): void => {
      scroller.scrollTop = initialScrollTop
      restoreAttempts += 1
      if (restoreAttempts < 3) {
        restoreFrame = requestAnimationFrame(restoreScroll)
      } else {
        restoringScroll = false
        onScrollTopChangeRef.current?.(scroller.scrollTop)
      }
    }
    restoreFrame = requestAnimationFrame(restoreScroll)

    return () => {
      cancelAnimationFrame(restoreFrame)
      scroller.removeEventListener('scroll', reportScroll)
      disposeRichClipboard()
      // Persist the actual position even when the component unmounts during restore.
      onScrollTopChangeRef.current?.(scroller.scrollTop)
      unregisterExport()
      controllerRef.current = null
      tagPortalHostRef.current = null
      controller.destroy()
    }
    // The controller owns its state for this component lifetime. Subsequent
    // prop changes are applied by the focused effects below.
  }, [])

  useLayoutEffect(() => {
    controllerRef.current?.setValue(content)
  }, [content])

  useLayoutEffect(() => {
    controllerRef.current?.setReadOnly(readingMode)
  }, [readingMode])

  useLayoutEffect(() => {
    const portalHost = tagPortalHostRef.current
    if (!portalHost) return
    controllerRef.current?.setExtensions([
      createMarkdownPreviewExtensions({
        enabled: livePreview,
        resolveImageSrc: stableImageResolverRef.current,
        allowRemoteImages,
        imageMaxWidth,
        codeBlockLineWrapping,
        previewThemeVersion,
        tableColumnWidthMode,
        tableAutoResize,
      }),
      imageInsertionExtensionRef.current ?? [],
      typewriterMode ? typewriterScrolling() : [],
      hasTagBar ? tagBarExtension(portalHost) : [],
    ])
  }, [
    allowRemoteImages,
    codeBlockLineWrapping,
    hasTagBar,
    imageMaxWidth,
    imageUploadEnabled,
    livePreview,
    previewThemeVersion,
    tableAutoResize,
    tableColumnWidthMode,
    typewriterMode,
  ])

  useLayoutEffect(() => {
    controllerRef.current?.setOnChange((markdown) => onChangeRef.current(markdown))
  }, [onChange])

  const rootClassName = [
    'xmd-cm-editor',
    tagBar ? 'has-tag-bar' : '',
    readingMode ? 'is-reading' : '',
    livePreview ? 'is-live-preview' : 'is-source',
    focusMode ? 'focus-mode' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  const showReadingHint = (root: HTMLElement): void => {
    if (root.querySelector('.reading-mode-toast')) return
    const hint = document.createElement('div')
    hint.className = 'reading-mode-toast'
    hint.textContent = t('请先关闭阅读模式')
    root.append(hint)
    window.setTimeout(() => hint.remove(), 1600)
  }

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      onKeyDownCapture={(event) => {
        if (!readingMode || event.metaKey || event.ctrlKey || event.altKey) return
        if (event.key.length === 1 || ['Enter', 'Backspace', 'Delete', 'Tab'].includes(event.key)) {
          showReadingHint(event.currentTarget)
        }
      }}
      onPasteCapture={(event) => {
        if (readingMode) showReadingHint(event.currentTarget)
      }}
      onDropCapture={(event) => {
        if (readingMode) showReadingHint(event.currentTarget)
      }}
    >
      <div ref={mountRef} className="xmd-cm-mount" />
      {tagPortalHost && tagBar ? createPortal(tagBar, tagPortalHost) : null}
    </div>
  )
}
