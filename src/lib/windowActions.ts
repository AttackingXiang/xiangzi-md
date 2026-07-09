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
