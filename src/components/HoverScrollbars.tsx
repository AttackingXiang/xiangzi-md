import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'

type ScrollAxis = 'horizontal' | 'vertical'

interface Props {
  targetRef: RefObject<HTMLElement | null>
  axes?: 'both' | 'horizontal' | 'vertical'
}

interface Metrics {
  clientWidth: number
  clientHeight: number
  scrollWidth: number
  scrollHeight: number
  scrollLeft: number
  scrollTop: number
}

interface DragState {
  axis: ScrollAxis
  pointerPosition: number
  scrollPosition: number
}

function readMetrics(element: HTMLElement): Metrics {
  return {
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }
}

function pointerPosition(axis: ScrollAxis, event: PointerEvent<HTMLDivElement>): number {
  return axis === 'horizontal' ? event.clientX : event.clientY
}

export default function HoverScrollbars({ targetRef, axes = 'both' }: Props): JSX.Element | null {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const refresh = useCallback(() => {
    const target = targetRef.current
    if (target) setMetrics(readMetrics(target))
  }, [targetRef])

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    let frame: number | null = null
    const scheduleRefresh = (): void => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        refresh()
      })
    }
    const resizeObserver = new ResizeObserver(scheduleRefresh)
    const mutationObserver = new MutationObserver(scheduleRefresh)

    resizeObserver.observe(target)
    mutationObserver.observe(target, { childList: true, subtree: true, attributes: true })
    target.addEventListener('scroll', scheduleRefresh, { passive: true })
    window.addEventListener('resize', scheduleRefresh)
    scheduleRefresh()

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      target.removeEventListener('scroll', scheduleRefresh)
      window.removeEventListener('resize', scheduleRefresh)
    }
  }, [refresh, targetRef])

  useEffect(() => {
    const clearDrag = (): void => {
      dragRef.current = null
    }
    window.addEventListener('pointerup', clearDrag)
    window.addEventListener('pointercancel', clearDrag)
    return () => {
      window.removeEventListener('pointerup', clearDrag)
      window.removeEventListener('pointercancel', clearDrag)
    }
  }, [])

  if (!metrics) return null

  const hasHorizontal = axes !== 'vertical' && metrics.scrollWidth > metrics.clientWidth
  const hasVertical = axes !== 'horizontal' && metrics.scrollHeight > metrics.clientHeight
  if (!hasHorizontal && !hasVertical) return null

  const scrollAxis = (
    axis: ScrollAxis,
    event: PointerEvent<HTMLDivElement>,
    track: HTMLDivElement,
  ): void => {
    const target = targetRef.current
    if (!target) return

    const rect = track.getBoundingClientRect()
    const position = pointerPosition(axis, event)
    const offset = axis === 'horizontal' ? position - rect.left : position - rect.top
    const length = axis === 'horizontal' ? rect.width : rect.height
    const maxScroll =
      axis === 'horizontal'
        ? Math.max(0, target.scrollWidth - target.clientWidth)
        : Math.max(0, target.scrollHeight - target.clientHeight)
    const nextPosition = Math.max(0, Math.min(1, offset / length))
    if (axis === 'horizontal') target.scrollLeft = nextPosition * maxScroll
    else target.scrollTop = nextPosition * maxScroll
  }

  const handleTrackPointerDown = (axis: ScrollAxis, event: PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    scrollAxis(axis, event, event.currentTarget)
  }

  const handleThumbPointerDown = (axis: ScrollAxis, event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    const target = targetRef.current
    if (!target) return
    dragRef.current = {
      axis,
      pointerPosition: pointerPosition(axis, event),
      scrollPosition: axis === 'horizontal' ? target.scrollLeft : target.scrollTop,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleThumbPointerMove = (axis: ScrollAxis, event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const target = targetRef.current
    const track = event.currentTarget.parentElement
    if (!drag || drag.axis !== axis || !target || !track) return

    const trackRect = track.getBoundingClientRect()
    const trackLength = axis === 'horizontal' ? trackRect.width : trackRect.height
    const viewportLength = axis === 'horizontal' ? target.clientWidth : target.clientHeight
    const contentLength = axis === 'horizontal' ? target.scrollWidth : target.scrollHeight
    const thumbLength = Math.max(18, trackLength * (viewportLength / contentLength))
    const maxThumbOffset = Math.max(1, trackLength - thumbLength)
    const delta = pointerPosition(axis, event) - drag.pointerPosition
    const maxScroll = Math.max(0, contentLength - viewportLength)
    const nextScroll = drag.scrollPosition + (delta / maxThumbOffset) * maxScroll
    if (axis === 'horizontal') target.scrollLeft = nextScroll
    else target.scrollTop = nextScroll
  }

  const horizontalTrackLength = Math.max(0, metrics.clientWidth - (hasVertical ? 14 : 4))
  const verticalTrackLength = Math.max(0, metrics.clientHeight - (hasHorizontal ? 14 : 4))
  const horizontalThumbLength = Math.max(
    18,
    horizontalTrackLength * (metrics.clientWidth / metrics.scrollWidth),
  )
  const verticalThumbLength = Math.max(
    18,
    verticalTrackLength * (metrics.clientHeight / metrics.scrollHeight),
  )
  const horizontalTravel = Math.max(0, horizontalTrackLength - horizontalThumbLength)
  const verticalTravel = Math.max(0, verticalTrackLength - verticalThumbLength)

  return (
    <div
      className={[
        'hover-scrollbars',
        hasHorizontal ? 'has-horizontal' : '',
        hasVertical ? 'has-vertical' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-window-drag-interactive
      aria-hidden="true"
    >
      {hasVertical && (
        <div
          className="hover-scrollbar-track hover-scrollbar-track-vertical"
          onPointerDown={(event) => handleTrackPointerDown('vertical', event)}
        >
          <div
            className="hover-scrollbar-thumb"
            style={{
              height: `${verticalThumbLength}px`,
              transform: `translateY(${(metrics.scrollTop / Math.max(1, metrics.scrollHeight - metrics.clientHeight)) * verticalTravel}px)`,
            }}
            onPointerDown={(event) => handleThumbPointerDown('vertical', event)}
            onPointerMove={(event) => handleThumbPointerMove('vertical', event)}
          />
        </div>
      )}
      {hasHorizontal && (
        <div
          className="hover-scrollbar-track hover-scrollbar-track-horizontal"
          onPointerDown={(event) => handleTrackPointerDown('horizontal', event)}
        >
          <div
            className="hover-scrollbar-thumb"
            style={{
              width: `${horizontalThumbLength}px`,
              transform: `translateX(${(metrics.scrollLeft / Math.max(1, metrics.scrollWidth - metrics.clientWidth)) * horizontalTravel}px)`,
            }}
            onPointerDown={(event) => handleThumbPointerDown('horizontal', event)}
            onPointerMove={(event) => handleThumbPointerMove('horizontal', event)}
          />
        </div>
      )}
    </div>
  )
}
