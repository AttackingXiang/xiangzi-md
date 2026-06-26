import { app, shell, dialog } from 'electron'
import https from 'https'
import { getSettings } from './settings'

const GITHUB_API = 'https://api.github.com/repos/AttackingXiang/xiangzi-md/releases/latest'
const GITEE_API  = 'https://gitee.com/api/v5/repos/tlqgyx/xiangzi-md/releases/latest'
const GITHUB_DL  = 'https://github.com/AttackingXiang/xiangzi-md/releases/latest'
const GITEE_DL   = 'https://gitee.com/tlqgyx/xiangzi-md/releases'

interface Release { tag_name: string; body?: string }

function fetchRelease(url: string, timeoutMs = 7000): Promise<Release> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'xiangzi-md-updater' } }, (res) => {
      let raw = ''
      res.on('data', (c: string) => { raw += c })
      res.on('end', () => {
        try { resolve(JSON.parse(raw) as Release) }
        catch { reject(new Error('parse error')) }
      })
    })
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map(Number)
  const a = parse(latest)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/**
 * silent=true：只在发现新版本时弹框；用于启动时自动检查。
 * silent=false：无论结果都给用户反馈；用于菜单「检查更新」。
 */
export async function checkForUpdates(silent = true): Promise<void> {
  const current = app.getVersion()
  const settings = await getSettings()
  const zh = settings.language !== 'en'

  let release: Release | null = null
  let source: 'github' | 'gitee' = 'github'

  try {
    release = await fetchRelease(GITHUB_API)
  } catch {
    try {
      release = await fetchRelease(GITEE_API)
      source = 'gitee'
    } catch {
      if (!silent) {
        await dialog.showMessageBox({
          type: 'warning',
          title: zh ? '检查更新' : 'Check for Updates',
          message: zh ? '无法连接更新服务器，请检查网络。' : 'Cannot reach update server. Please check your network.',
          buttons: ['OK']
        })
      }
      return
    }
  }

  if (!release?.tag_name) return

  if (!isNewer(release.tag_name, current)) {
    if (!silent) {
      await dialog.showMessageBox({
        type: 'info',
        title: zh ? '已是最新版本' : 'Up to Date',
        message: zh
          ? `当前已是最新版本（v${current}）。`
          : `You're running the latest version (v${current}).`,
        buttons: ['OK']
      })
    }
    return
  }

  const sourceNote = source === 'gitee'
    ? (zh ? '\n（通过 Gitee 镜像检测到）' : '\n(Detected via Gitee mirror)')
    : ''

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: zh ? '发现新版本' : 'Update Available',
    message: zh
      ? `发现新版本 ${release.tag_name}（当前：v${current}）${sourceNote}`
      : `${release.tag_name} is available  (current: v${current})${sourceNote}`,
    buttons: [
      zh ? '前往 GitHub 下载' : 'Download on GitHub',
      zh ? '前往 Gitee 下载'  : 'Download on Gitee',
      zh ? '稍后再说'          : 'Later'
    ],
    defaultId: 0,
    cancelId: 2
  })

  if (response === 0) shell.openExternal(GITHUB_DL)
  else if (response === 1) shell.openExternal(GITEE_DL)
}
