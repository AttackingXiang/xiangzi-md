import { browserDesktopAdapter, browserUpdaterAdapter } from './browserAdapter'
import { tauriDesktopAdapter, tauriUpdaterAdapter } from './tauriAdapter'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export const isBrowserPreview = !isTauriRuntime()
export const desktop = isBrowserPreview ? browserDesktopAdapter : tauriDesktopAdapter
export const updater = isBrowserPreview ? browserUpdaterAdapter : tauriUpdaterAdapter

export type { DesktopPort, UpdaterPort } from './contracts'
