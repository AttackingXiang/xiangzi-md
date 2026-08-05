import { getCurrentWindow } from '@tauri-apps/api/window'

let maximizeLocked = false

export async function runWindowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void> {
  const appWindow = getCurrentWindow()
  if (action === 'minimize') await appWindow.minimize()
  else if (action === 'maximize') {
    if (maximizeLocked) return
    maximizeLocked = true
    try {
      await appWindow.toggleMaximize()
    } finally {
      window.setTimeout(() => {
        maximizeLocked = false
      }, 260)
    }
  } else await appWindow.close()
}

/** 开始拖动窗口（标题栏按下时调用）。 */
export async function startWindowDragging(): Promise<void> {
  await getCurrentWindow().startDragging()
}

/** 切换全屏。 */
export async function toggleWindowFullscreen(): Promise<void> {
  const win = getCurrentWindow()
  const fullscreen = await win.isFullscreen()
  await win.setFullscreen(!fullscreen)
}

export async function getWindowFullscreen(): Promise<boolean> {
  return getCurrentWindow().isFullscreen()
}

/**
 * 订阅窗口最大化状态。用于让标题栏按钮在「最大化」和「还原」之间切换图标——
 * 用户可能通过双击标题栏、系统快捷键或贴边吸附改变它，不只是点那个按钮。
 */
export async function watchWindowMaximized(
  onChange: (maximized: boolean) => void,
): Promise<() => void> {
  const win = getCurrentWindow()
  const publish = (): void => {
    void win
      .isMaximized()
      .then(onChange)
      .catch(() => undefined)
  }
  publish()
  return win.onResized(publish)
}

export async function setWindowFullscreen(fullscreen: boolean): Promise<void> {
  await getCurrentWindow().setFullscreen(fullscreen)
}

/**
 * 订阅原生窗口的全屏状态变化。
 *
 * native 全屏不会触发 DOM 的 `fullscreenchange`，所以用户通过绿灯按钮或
 * ⌃⌘F 退出全屏时，只有窗口尺寸事件能反映出来；收到后重新查询真实状态。
 */
export async function watchWindowFullscreen(
  onChange: (fullscreen: boolean) => void,
): Promise<() => void> {
  const win = getCurrentWindow()
  return win.onResized(() => {
    void win
      .isFullscreen()
      .then(onChange)
      .catch(() => undefined)
  })
}
