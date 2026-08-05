import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

interface DragState {
  pointerId: number
  clientX: number
  clientY: number
  scrollLeft: number
  scrollTop: number
}

export interface PreviewPan {
  dragging: boolean
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  endPointerDrag: (event: ReactPointerEvent<HTMLDivElement>) => void
}

/** Drag-to-scroll for the preview viewport, active while the pan tool (or Space) is held. */
export function usePreviewPan(viewportRef: RefObject<HTMLElement>, active: boolean): PreviewPan {
  const dragRef = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!active || event.button !== 0) return
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

  return { dragging, onPointerDown, onPointerMove, endPointerDrag }
}
