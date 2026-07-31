import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react'
import {
  Expand,
  Fullscreen,
  Hand,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useModalFocus } from '../hooks/useModalFocus'
import { isTauriRuntime } from '../platform'
import { getWindowFullscreen, setWindowFullscreen } from '../lib/windowActions'
import { clampPreviewScale, fitPreviewScale, nextPreviewScale } from '../lib/lightboxZoom'
import { t } from '../lib/i18n'

export type PreviewTool = 'select' | 'pan' | 'zoom'

interface Props {
  title: string
  children: ReactNode
  onClose: () => void
  minScale: number
  maxScale: number
  initialTool: PreviewTool
  baseSize?: { width: number; height: number } | null
  contentClassName?: string
  doubleClickZoom?: boolean
}

interface DragState {
  pointerId: number
  clientX: number
  clientY: number
  scrollLeft: number
  scrollTop: number
}

/** Shared, bounded preview surface for images, Mermaid diagrams, and tables. */
export default function PreviewDialog({
  title,
  children,
  onClose,
  minScale,
  maxScale,
  initialTool,
  baseSize: suppliedBaseSize,
  contentClassName = '',
  doubleClickZoom = false,
}: Props): JSX.Element {
  const dialogRef = useModalFocus<HTMLElement>()
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scaleRef = useRef(1)
  const modeRef = useRef<'fit' | 'actual' | 'custom'>('fit')
  const dragRef = useRef<DragState | null>(null)
  const enteredSystemFullscreenRef = useRef(false)
  const maximizedBeforeSystemRef = useRef(false)
  const [measuredBaseSize, setMeasuredBaseSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const [scale, setScale] = useState(1)
  const [tool, setTool] = useState<PreviewTool>(initialTool)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [systemFullscreen, setSystemFullscreen] = useState(false)
  const baseSize = suppliedBaseSize ?? measuredBaseSize

  const updateScale = useCallback(
    (next: number, mode: 'fit' | 'actual' | 'custom') => {
      const clamped = clampPreviewScale(next, minScale, maxScale)
      scaleRef.current = clamped
      modeRef.current = mode
      setScale(clamped)
    },
    [maxScale, minScale],
  )

  const measureContent = useCallback(() => {
    if (suppliedBaseSize) return
    const content = contentRef.current
    if (!content) return
    const width = Math.ceil(content.scrollWidth)
    const height = Math.ceil(content.scrollHeight)
    if (width <= 0 || height <= 0) return
    setMeasuredBaseSize((current) =>
      current?.width === width && current.height === height ? current : { width, height },
    )
  }, [suppliedBaseSize])

  useLayoutEffect(() => {
    measureContent()
    const content = contentRef.current
    if (!content || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measureContent)
    observer.observe(content)
    return () => observer.disconnect()
  }, [children, measureContent])

  const fit = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport || !baseSize) return
    updateScale(
      fitPreviewScale(
        baseSize.width,
        baseSize.height,
        Math.max(1, viewport.clientWidth - 48),
        Math.max(1, viewport.clientHeight - 48),
        minScale,
        maxScale,
      ),
      'fit',
    )
    window.requestAnimationFrame(() => viewport.scrollTo({ left: 0, top: 0 }))
  }, [baseSize, maxScale, minScale, updateScale])

  useEffect(() => {
    if (!baseSize) return
    fit()
  }, [baseSize, fit])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => {
      if (modeRef.current === 'fit') fit()
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [fit])

  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const viewport = viewportRef.current
      const content = contentRef.current
      const current = scaleRef.current
      const clamped = clampPreviewScale(next, minScale, maxScale)
      if (!viewport || !content || clamped === current) return

      const viewportRect = viewport.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      const anchorX = clientX ?? viewportRect.left + viewportRect.width / 2
      const anchorY = clientY ?? viewportRect.top + viewportRect.height / 2
      const ratioX = contentRect.width > 0 ? (anchorX - contentRect.left) / contentRect.width : 0.5
      const ratioY = contentRect.height > 0 ? (anchorY - contentRect.top) / contentRect.height : 0.5
      updateScale(clamped, 'custom')
      window.requestAnimationFrame(() => {
        const nextRect = content.getBoundingClientRect()
        viewport.scrollLeft += nextRect.left + ratioX * nextRect.width - anchorX
        viewport.scrollTop += nextRect.top + ratioY * nextRect.height - anchorY
      })
    },
    [maxScale, minScale, updateScale],
  )

  const actualSize = useCallback(() => {
    updateScale(1, 'actual')
    window.requestAnimationFrame(() => viewportRef.current?.scrollTo({ left: 0, top: 0 }))
  }, [updateScale])

  const zoomStep = useCallback(
    (direction: 'in' | 'out', clientX?: number, clientY?: number) => {
      zoomTo(nextPreviewScale(scaleRef.current, direction, minScale, maxScale), clientX, clientY)
    },
    [maxScale, minScale, zoomTo],
  )

  const leaveSystemFullscreen = useCallback(async () => {
    const enteredByPreview = enteredSystemFullscreenRef.current
    if (isTauriRuntime()) {
      await setWindowFullscreen(false)
    } else if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen()
    }
    enteredSystemFullscreenRef.current = false
    setSystemFullscreen(false)
    if (enteredByPreview) setMaximized(maximizedBeforeSystemRef.current)
  }, [])

  const toggleSystemFullscreen = useCallback(async () => {
    if (systemFullscreen) {
      await leaveSystemFullscreen()
      return
    }
    if (isTauriRuntime()) {
      await setWindowFullscreen(true)
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen()
    } else {
      return
    }
    maximizedBeforeSystemRef.current = maximized
    setMaximized(true)
    enteredSystemFullscreenRef.current = true
    setSystemFullscreen(true)
  }, [leaveSystemFullscreen, maximized, systemFullscreen])

  useEffect(() => {
    if (!isTauriRuntime()) return
    void getWindowFullscreen()
      .then(setSystemFullscreen)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onFullscreenChange = (): void => setSystemFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(
    () => () => {
      if (!enteredSystemFullscreenRef.current) return
      if (isTauriRuntime()) void setWindowFullscreen(false).catch(() => undefined)
      else if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => undefined)
      }
    },
    [],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !event.repeat) {
        const target = event.target
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
          event.preventDefault()
          setSpaceHeld(true)
        }
      }
      if (event.key === 'Escape') {
        if (systemFullscreen) void leaveSystemFullscreen().catch(() => undefined)
        else if (maximized) setMaximized(false)
        else onClose()
      } else if (event.key === '+' || event.key === '=') zoomStep('in')
      else if (event.key === '-') zoomStep('out')
      else if (event.key === '0') fit()
      else if (event.key === '1') actualSize()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [actualSize, fit, leaveSystemFullscreen, maximized, onClose, systemFullscreen, zoomStep])

  const panActive = tool === 'pan' || spaceHeld

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!panActive || event.button !== 0) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    viewport.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const viewport = viewportRef.current
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.clientX)
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.clientY)
  }

  const endPointerDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const onViewportClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (tool !== 'zoom' || dragging) return
    zoomStep(event.altKey ? 'out' : 'in', event.clientX, event.clientY)
  }

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!doubleClickZoom || tool === 'zoom') return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    if (modeRef.current === 'fit') zoomTo(Math.min(2, maxScale), event.clientX, event.clientY)
    else fit()
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    zoomTo(scaleRef.current * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY)
  }

  const scaledWidth = baseSize ? Math.max(1, baseSize.width * scale) : undefined
  const scaledHeight = baseSize ? Math.max(1, baseSize.height * scale) : undefined

  return (
    <div
      className={`preview-backdrop${maximized ? ' is-maximized' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="preview-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="preview-header">
          <span className="preview-title">{title}</span>
          <div className="preview-tools" role="toolbar" aria-label={t('预览工具')}>
            <div className="preview-tool-group" aria-label={t('交互工具')}>
              <button
                type="button"
                className={tool === 'select' ? 'is-active' : ''}
                aria-pressed={tool === 'select'}
                onClick={() => setTool('select')}
                title={t('选择工具')}
              >
                <MousePointer2 aria-hidden="true" />
              </button>
              <button
                type="button"
                className={tool === 'pan' ? 'is-active' : ''}
                aria-pressed={tool === 'pan'}
                onClick={() => setTool('pan')}
                title={t('抓手工具')}
              >
                <Hand aria-hidden="true" />
              </button>
              <button
                type="button"
                className={tool === 'zoom' ? 'is-active' : ''}
                aria-pressed={tool === 'zoom'}
                onClick={() => setTool('zoom')}
                title={t('缩放工具')}
              >
                <Search aria-hidden="true" />
              </button>
            </div>
            <div className="preview-tool-group" aria-label={t('缩放')}>
              <button
                type="button"
                disabled={scale <= minScale}
                onClick={() => zoomStep('out')}
                title={`${t('缩小')} (-)`}
              >
                <Minus aria-hidden="true" />
              </button>
              <span className="preview-scale" aria-live="polite">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                disabled={scale >= maxScale}
                onClick={() => zoomStep('in')}
                title={`${t('放大')} (+)`}
              >
                <Plus aria-hidden="true" />
              </button>
              <button type="button" onClick={fit} title={`${t('适合窗口')} (0)`}>
                <Expand aria-hidden="true" />
              </button>
              <button type="button" onClick={actualSize} title={`${t('实际大小')} (1)`}>
                <Maximize2 aria-hidden="true" />
              </button>
            </div>
            <div className="preview-tool-group" aria-label={t('窗口工具')}>
              <button
                type="button"
                aria-pressed={maximized}
                onClick={() => setMaximized((current) => !current)}
                title={maximized ? t('还原预览窗口') : t('最大化预览窗口')}
              >
                {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
              </button>
              <button
                type="button"
                aria-pressed={systemFullscreen}
                onClick={() => void toggleSystemFullscreen().catch(() => undefined)}
                title={systemFullscreen ? t('退出系统全屏') : t('系统全屏')}
              >
                <Fullscreen aria-hidden="true" />
              </button>
            </div>
          </div>
          <button type="button" className="preview-close" onClick={onClose} title={t('关闭')}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div
          ref={viewportRef}
          className={`preview-viewport is-${tool}${spaceHeld ? ' is-space-pan' : ''}${dragging ? ' is-dragging' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
          onClick={onViewportClick}
          onDoubleClick={onDoubleClick}
        >
          <div
            className="preview-stage"
            style={
              scaledWidth && scaledHeight
                ? {
                    width: `max(100%, ${scaledWidth + 48}px)`,
                    height: `max(100%, ${scaledHeight + 48}px)`,
                  }
                : undefined
            }
          >
            <div
              className="preview-content-frame"
              style={
                scaledWidth && scaledHeight
                  ? { width: `${scaledWidth}px`, height: `${scaledHeight}px` }
                  : undefined
              }
            >
              <div
                ref={contentRef}
                className={`preview-content ${contentClassName}`.trim()}
                style={{
                  transform: `scale(${scale})`,
                  ...(baseSize
                    ? { width: `${baseSize.width}px`, height: `${baseSize.height}px` }
                    : undefined),
                }}
              >
                {children}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
