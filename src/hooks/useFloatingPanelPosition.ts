import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'
import { placeFloatingPanel } from '../components/floatingPanelPosition'

/** Shared flip-and-shift positioning for pointer-anchored overlays. */
export function useFloatingPanelPosition(
  panelRef: RefObject<HTMLElement | null>,
  anchorX: number,
  anchorY: number,
  maxViewportHeightRatio = 1,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>(() => ({
    left: anchorX,
    top: anchorY,
    visibility: 'hidden',
  }))

  const update = useCallback(() => {
    const panel = panelRef.current
    if (!panel) return
    const viewportHeight = window.innerHeight
    const borderHeight = panel.offsetHeight - panel.clientHeight
    const placement = placeFloatingPanel({
      anchorX,
      anchorY,
      panelWidth: panel.offsetWidth,
      panelHeight: Math.min(
        panel.scrollHeight + borderHeight,
        viewportHeight * maxViewportHeightRatio,
      ),
      viewportWidth: window.innerWidth,
      viewportHeight,
    })
    const next: CSSProperties = { ...placement, visibility: 'visible' }
    setStyle((current) =>
      current.left === next.left &&
      current.top === next.top &&
      current.maxHeight === next.maxHeight &&
      current.visibility === next.visibility
        ? current
        : next,
    )
  }, [anchorX, anchorY, maxViewportHeightRatio, panelRef])

  useLayoutEffect(() => {
    update()
    window.addEventListener('resize', update)
    const observer = new ResizeObserver(update)
    if (panelRef.current) observer.observe(panelRef.current)
    return () => {
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [panelRef, update])

  return style
}
