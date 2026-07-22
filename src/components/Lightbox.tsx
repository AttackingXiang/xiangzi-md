import { useCallback, useEffect, useRef, useState, type MouseEvent, type WheelEvent } from 'react'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { t } from '../lib/i18n'
import { clampLightboxScale } from '../lib/lightboxZoom'

interface Props {
  src: string
  onClose: () => void
}

/** 图片/图表查看器：滚轮或按钮缩放，放大后拖拽查看局部，Esc 关闭。 */
export default function Lightbox({ src, onClose }: Props): JSX.Element {
  const [scale, setScale] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)

  const reset = useCallback(() => {
    setScale(1)
    window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ left: 0, top: 0 }))
  }, [])
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    setScale((current) => {
      const next = clampLightboxScale(current * factor)
      const scroll = scrollRef.current
      if (!scroll || next === current) return next

      const rect = scroll.getBoundingClientRect()
      const pointX = clientX === undefined ? rect.width / 2 : clientX - rect.left
      const pointY = clientY === undefined ? rect.height / 2 : clientY - rect.top
      const contentX = (scroll.scrollLeft + pointX) / current
      const contentY = (scroll.scrollTop + pointY) / current
      window.requestAnimationFrame(() => {
        scroll.scrollLeft = contentX * next - rect.width / 2
        scroll.scrollTop = contentY * next - rect.height / 2
      })
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      else if (event.key === '+' || event.key === '=') zoomAt(1.2)
      else if (event.key === '-') zoomAt(1 / 1.2)
      else if (event.key === '0') reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, reset, zoomAt])

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY)
  }

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    zoomAt(1.6, event.clientX, event.clientY)
  }

  return (
    <div className="lightbox" onMouseDown={onClose}>
      <section className="lightbox-panel" onMouseDown={(event) => event.stopPropagation()}>
        <header className="lightbox-header">
          <span className="lightbox-title">{t('图表预览')}</span>
          <div className="lightbox-toolbar" role="toolbar" aria-label={t('缩放')}>
            <button type="button" onClick={() => zoomAt(1 / 1.2)} title={`${t('缩小')} (-)`}>
              <Minus aria-hidden="true" />
            </button>
            <span className="lightbox-scale">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => zoomAt(1.2)} title={`${t('放大')} (+)`}>
              <Plus aria-hidden="true" />
            </button>
            <button type="button" onClick={reset} title={`${t('实际大小')} (0)`}>
              <Maximize2 aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="lightbox-close" onClick={onClose} title={t('关闭')}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div
          ref={scrollRef}
          className="lightbox-scroll"
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        >
          <div
            className="lightbox-canvas"
            style={{ width: `${scale * 100}%` }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <img className="lightbox-img" src={src} alt="" draggable={false} />
          </div>
        </div>
      </section>
    </div>
  )
}
