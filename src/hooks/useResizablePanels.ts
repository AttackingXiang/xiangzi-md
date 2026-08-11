import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

interface WidthOptions {
  initial: number
  min: number
  max: number
  direction: 1 | -1
  /** 拖动结束/复位/微调后落盘一次；拖动过程中的每一帧不写。 */
  onCommit?: (width: number) => void
  /** 设置加载完成后的宽度；首次拿到时覆盖默认值。 */
  persisted?: number | null
}

export const DEFAULT_PANEL_WIDTHS = {
  sidebar: 256,
  results: 300,
  outline: 240,
} as const

export function resizedPanelWidth(
  startWidth: number,
  startX: number,
  currentX: number,
  { min, max, direction }: Pick<WidthOptions, 'min' | 'max' | 'direction'>,
): number {
  return Math.max(min, Math.min(max, startWidth + direction * (currentX - startX)))
}

interface ResizableWidth {
  width: number
  startResize: (event: ReactMouseEvent) => void
  reset: () => void
  nudge: (delta: number) => void
}

function useResizableWidth(options: WidthOptions): ResizableWidth {
  const [width, setWidth] = useState(options.initial)
  const widthRef = useRef(width)
  const cleanupRef = useRef<(() => void) | null>(null)
  const hydratedRef = useRef(false)
  widthRef.current = width

  useEffect(() => () => cleanupRef.current?.(), [])

  // 设置是异步加载的，这个 hook 在设置就绪之前就已经跑过一轮了。第一次拿到持久化
  // 的宽度时补上，之后不再跟随（避免自己写回去的值又绕一圈把用户的拖动打断）。
  const persisted = options.persisted
  useEffect(() => {
    if (hydratedRef.current || persisted == null) return
    hydratedRef.current = true
    setWidth(Math.max(options.min, Math.min(options.max, persisted)))
  }, [persisted, options.min, options.max])

  const commit = options.onCommit
  const apply = useCallback(
    (next: number): void => {
      const clamped = Math.max(options.min, Math.min(options.max, next))
      hydratedRef.current = true
      setWidth(clamped)
      commit?.(clamped)
    },
    [commit, options.min, options.max],
  )

  const startResize = useCallback(
    (event: ReactMouseEvent): void => {
      event.preventDefault()
      cleanupRef.current?.()
      const startX = event.clientX
      const startWidth = widthRef.current
      hydratedRef.current = true
      const onMove = (moveEvent: MouseEvent): void =>
        setWidth(resizedPanelWidth(startWidth, startX, moveEvent.clientX, options))
      const cleanup = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', cleanup)
        cleanupRef.current = null
        commit?.(widthRef.current)
      }
      cleanupRef.current = cleanup
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', cleanup)
    },
    [commit, options.direction, options.max, options.min],
  )

  const reset = useCallback((): void => apply(options.initial), [apply, options.initial])
  const nudge = useCallback((delta: number): void => apply(widthRef.current + delta), [apply])

  return { width, startResize, reset, nudge }
}

interface PanelWidthSettings {
  sidebarWidth?: number | null
  resultsWidth?: number | null
  outlineWidth?: number | null
  onPersist?: (widths: {
    sidebarWidth?: number
    resultsWidth?: number
    outlineWidth?: number
  }) => void
}

export function useResizablePanels(settings: PanelWidthSettings = {}): {
  sidebar: ResizableWidth
  results: ResizableWidth
  outline: ResizableWidth
} {
  const { onPersist } = settings
  const persistSidebar = useCallback(
    (sidebarWidth: number) => onPersist?.({ sidebarWidth }),
    [onPersist],
  )
  const persistResults = useCallback(
    (resultsWidth: number) => onPersist?.({ resultsWidth }),
    [onPersist],
  )
  const persistOutline = useCallback(
    (outlineWidth: number) => onPersist?.({ outlineWidth }),
    [onPersist],
  )

  const sidebar = useResizableWidth({
    initial: DEFAULT_PANEL_WIDTHS.sidebar,
    min: 160,
    max: 520,
    direction: 1,
    persisted: settings.sidebarWidth,
    onCommit: persistSidebar,
  })
  const results = useResizableWidth({
    initial: DEFAULT_PANEL_WIDTHS.results,
    min: 200,
    max: 560,
    direction: 1,
    persisted: settings.resultsWidth,
    onCommit: persistResults,
  })
  const outline = useResizableWidth({
    initial: DEFAULT_PANEL_WIDTHS.outline,
    min: 160,
    max: 520,
    direction: -1,
    persisted: settings.outlineWidth,
    onCommit: persistOutline,
  })

  return { sidebar, results, outline }
}
