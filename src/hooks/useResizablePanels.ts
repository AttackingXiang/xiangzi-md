import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

interface WidthOptions {
  initial: number
  min: number
  max: number
  direction: 1 | -1
}

export function resizedPanelWidth(
  startWidth: number,
  startX: number,
  currentX: number,
  { min, max, direction }: Omit<WidthOptions, 'initial'>,
): number {
  return Math.max(min, Math.min(max, startWidth + direction * (currentX - startX)))
}

function useResizableWidth(options: WidthOptions): [number, (event: ReactMouseEvent) => void] {
  const [width, setWidth] = useState(options.initial)
  const widthRef = useRef(width)
  const cleanupRef = useRef<(() => void) | null>(null)
  widthRef.current = width

  useEffect(() => () => cleanupRef.current?.(), [])

  const startResize = useCallback(
    (event: ReactMouseEvent): void => {
      event.preventDefault()
      cleanupRef.current?.()
      const startX = event.clientX
      const startWidth = widthRef.current
      const onMove = (moveEvent: MouseEvent): void =>
        setWidth(resizedPanelWidth(startWidth, startX, moveEvent.clientX, options))
      const cleanup = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', cleanup)
        cleanupRef.current = null
      }
      cleanupRef.current = cleanup
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', cleanup)
    },
    [options.direction, options.max, options.min],
  )
  return [width, startResize]
}

export function useResizablePanels(): {
  sidebarWidth: number
  resultsWidth: number
  outlineWidth: number
  startSidebarResize: (event: ReactMouseEvent) => void
  startResultsResize: (event: ReactMouseEvent) => void
  startOutlineResize: (event: ReactMouseEvent) => void
} {
  const [sidebarWidth, startSidebarResize] = useResizableWidth({
    initial: 256,
    min: 160,
    max: 520,
    direction: 1,
  })
  const [resultsWidth, startResultsResize] = useResizableWidth({
    initial: 300,
    min: 200,
    max: 560,
    direction: 1,
  })
  const [outlineWidth, startOutlineResize] = useResizableWidth({
    initial: 240,
    min: 160,
    max: 520,
    direction: -1,
  })
  return {
    sidebarWidth,
    resultsWidth,
    outlineWidth,
    startSidebarResize,
    startResultsResize,
    startOutlineResize,
  }
}
