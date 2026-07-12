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
