import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react'
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
import { usePreviewFullscreen } from '../hooks/usePreviewFullscreen'
import { usePreviewPan } from '../hooks/usePreviewPan'
import { usePreviewZoom, type PreviewSize } from '../hooks/usePreviewZoom'
import { t } from '../lib/i18n'

export type PreviewTool = 'select' | 'pan' | 'zoom'

interface Props {
  title: string
  children: ReactNode
  onClose: () => void
  minScale: number
  maxScale: number
  initialTool: PreviewTool
  baseSize?: PreviewSize | null
  contentClassName?: string
  doubleClickZoom?: boolean
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
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [tool, setTool] = useState<PreviewTool>(initialTool)
  const [spaceHeld, setSpaceHeld] = useState(false)

  const { scale, baseSize, scaleRef, modeRef, fit, actualSize, zoomTo, zoomStep } = usePreviewZoom({
    viewportRef,
    contentRef,
    minScale,
    maxScale,
    suppliedBaseSize,
    measureKey: children,
  })
  const { maximized, setMaximized, systemFullscreen, toggleSystemFullscreen, handleEscape } =
    usePreviewFullscreen(onClose)

  const panActive = tool === 'pan' || spaceHeld
  const { dragging, onPointerDown, onPointerMove, endPointerDrag } = usePreviewPan(
    viewportRef,
    panActive,
  )

  // Escape 走模态栈分发，这样嵌在别的弹窗里时一次按键只关掉最内层。
  const dialogRef = useModalFocus<HTMLElement>(true, handleEscape)

  useEffect(() => {
    // 缩放/平移快捷键都是裸键位，落到输入控件里就会变成"打不出字"。
    const typingInto = (target: EventTarget | null): boolean =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)

    const onKeyDown = (event: KeyboardEvent): void => {
      if (typingInto(event.target)) return
      if (event.code === 'Space' && !event.repeat) {
        event.preventDefault()
        setSpaceHeld(true)
      }
      if (event.key === '+' || event.key === '=') zoomStep('in')
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
  }, [actualSize, fit, zoomStep])

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
