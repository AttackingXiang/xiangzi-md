import { tauriDesktopAdapter, tauriUpdaterAdapter } from './tauriAdapter'

export const desktop = tauriDesktopAdapter
export const updater = tauriUpdaterAdapter

export type { DesktopPort, UpdaterPort } from './contracts'
