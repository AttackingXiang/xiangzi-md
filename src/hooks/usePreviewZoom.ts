import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react'
import { clampPreviewScale, fitPreviewScale, nextPreviewScale } from '../lib/lightboxZoom'

export type PreviewZoomMode = 'fit' | 'actual' | 'custom'

export interface PreviewSize {
  width: number
  height: number
}

interface Options {
  viewportRef: RefObject<HTMLElement>
  contentRef: RefObject<HTMLElement>
  minScale: number
  maxScale: number
  /** Intrinsic size when the caller knows it (images); otherwise the content is measured. */
  suppliedBaseSize?: PreviewSize | null
  /** Re-measure whenever this changes — normally the rendered children. */
  measureKey: unknown
}

export interface PreviewZoom {
  scale: number
  baseSize: PreviewSize | null
  /** Live scale, for handlers that must not re-subscribe on every zoom step. */
  scaleRef: MutableRefObject<number>
  modeRef: MutableRefObject<PreviewZoomMode>
  fit: () => void
  actualSize: () => void
  zoomTo: (next: number, clientX?: number, clientY?: number) => void
  zoomStep: (direction: 'in' | 'out', clientX?: number, clientY?: number) => void
}

/** Scale, fit-to-viewport, and anchored zoom for the shared preview surface. */
export function usePreviewZoom({
  viewportRef,
  contentRef,
  minScale,
  maxScale,
  suppliedBaseSize,
  measureKey,
}: Options): PreviewZoom {
  const scaleRef = useRef(1)
  const modeRef = useRef<PreviewZoomMode>('fit')
  const [scale, setScale] = useState(1)
  const [measuredBaseSize, setMeasuredBaseSize] = useState<PreviewSize | null>(null)
  const baseSize = suppliedBaseSize ?? measuredBaseSize

  const updateScale = useCallback(
    (next: number, mode: PreviewZoomMode) => {
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
  }, [contentRef, suppliedBaseSize])

  useLayoutEffect(() => {
    measureContent()
    const content = contentRef.current
    if (!content || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measureContent)
    observer.observe(content)
    return () => observer.disconnect()
  }, [contentRef, measureContent, measureKey])

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
  }, [baseSize, maxScale, minScale, updateScale, viewportRef])

  useEffect(() => {
    if (!baseSize) return
    fit()
  }, [baseSize, fit])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver !== 'function') return undefined
    // 只有还停在 fit 模式时才跟随视口重算；用户手动缩放过就别再夺走控制权。
    const observer = new ResizeObserver(() => {
      if (modeRef.current === 'fit') fit()
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [fit, viewportRef])

  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const viewport = viewportRef.current
      const content = contentRef.current
      const current = scaleRef.current
      const clamped = clampPreviewScale(next, minScale, maxScale)
      if (!viewport || !content || clamped === current) return

      // 记下锚点在内容里的相对位置，缩放后再把它拨回原来的屏幕坐标，
      // 这样以光标（或视口中心）为中心缩放。
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
    [contentRef, maxScale, minScale, updateScale, viewportRef],
  )

  const actualSize = useCallback(() => {
    updateScale(1, 'actual')
    window.requestAnimationFrame(() => viewportRef.current?.scrollTo({ left: 0, top: 0 }))
  }, [updateScale, viewportRef])

  const zoomStep = useCallback(
    (direction: 'in' | 'out', clientX?: number, clientY?: number) => {
      zoomTo(nextPreviewScale(scaleRef.current, direction, minScale, maxScale), clientX, clientY)
    },
    [maxScale, minScale, zoomTo],
  )

  return { scale, baseSize, scaleRef, modeRef, fit, actualSize, zoomTo, zoomStep }
}
