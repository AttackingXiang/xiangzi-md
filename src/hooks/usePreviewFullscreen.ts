import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { isTauriRuntime } from '../platform'
import {
  getWindowFullscreen,
  setWindowFullscreen,
  watchWindowFullscreen,
} from '../lib/windowActions'

export interface PreviewFullscreen {
  /** Panel fills the app window (an in-app state, not an OS one). */
  maximized: boolean
  setMaximized: Dispatch<SetStateAction<boolean>>
  /** The OS/browser window itself is fullscreen. */
  systemFullscreen: boolean
  toggleSystemFullscreen: () => Promise<void>
  /** Escape unwinds one level at a time: system fullscreen, then maximized, then close. */
  handleEscape: () => void
}

/** Maximize and system-fullscreen state for the shared preview surface. */
export function usePreviewFullscreen(onClose: () => void): PreviewFullscreen {
  const enteredByPreviewRef = useRef(false)
  const maximizedBeforeSystemRef = useRef(false)
  const [maximized, setMaximized] = useState(false)
  const [systemFullscreen, setSystemFullscreen] = useState(false)

  const leaveSystemFullscreen = useCallback(async () => {
    const enteredByPreview = enteredByPreviewRef.current
    if (isTauriRuntime()) {
      await setWindowFullscreen(false)
    } else if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen()
    }
    enteredByPreviewRef.current = false
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
    enteredByPreviewRef.current = true
    setSystemFullscreen(true)
  }, [leaveSystemFullscreen, maximized, systemFullscreen])

  useEffect(() => {
    if (!isTauriRuntime()) return undefined
    void getWindowFullscreen()
      .then(setSystemFullscreen)
      .catch(() => undefined)

    // 用户可能绕过本弹窗直接用绿灯 / ⌃⌘F 退出全屏。不跟踪的话 systemFullscreen
    // 会永久停在 true，Escape 只会反复"退出全屏"而关不掉弹窗。
    let unwatch: (() => void) | null = null
    let disposed = false
    void watchWindowFullscreen(setSystemFullscreen)
      .then((stop) => {
        if (disposed) stop()
        else unwatch = stop
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unwatch?.()
    }
  }, [])

  // 浏览器（非 Tauri）下的全屏变化走 DOM 事件。
  useEffect(() => {
    const onFullscreenChange = (): void => setSystemFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // 关闭弹窗时把它自己带进去的全屏还原，别把整个窗口留在全屏状态。
  useEffect(
    () => () => {
      if (!enteredByPreviewRef.current) return
      if (isTauriRuntime()) void setWindowFullscreen(false).catch(() => undefined)
      else if (document.fullscreenElement && document.exitFullscreen) {
        void document.exitFullscreen().catch(() => undefined)
      }
    },
    [],
  )

  const handleEscape = useCallback(() => {
    if (systemFullscreen) void leaveSystemFullscreen().catch(() => undefined)
    else if (maximized) setMaximized(false)
    else onClose()
  }, [leaveSystemFullscreen, maximized, onClose, systemFullscreen])

  return { maximized, setMaximized, systemFullscreen, toggleSystemFullscreen, handleEscape }
}
