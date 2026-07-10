import type { UpdaterController } from '../../hooks/useUpdater'

/** 把更新器状态映射为一行可读文案（更新/关于两处共用）。 */
export function updateStatusText(updater: UpdaterController, en: boolean): string {
  const { state } = updater
  if (state.phase === 'checking') return en ? 'Checking for updates…' : '正在检查新版本…'
  if (state.phase === 'up-to-date') return en ? 'You are up to date.' : '当前已经是最新版本。'
  if (state.phase === 'available')
    return en ? `Version ${state.version} is available.` : `发现新版本 ${state.version}。`
  if (state.phase === 'downloading') return en ? 'Downloading the update…' : '正在下载更新…'
  if (state.phase === 'error')
    return en ? 'Could not check for updates. Try again later.' : '暂时无法检查更新，请稍后重试。'
  return en ? 'Not checked yet.' : '尚未检查。'
}
