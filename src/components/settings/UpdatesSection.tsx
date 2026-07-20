import { RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import { desktop } from '../../platform'
import type { UpdaterController } from '../../hooks/useUpdater'
import { SettingsPage, SettingsCard, ToggleRow } from './primitives'
import { updateStatusText } from './updateStatusText'
import type { SectionProps } from './types'

interface Props extends SectionProps {
  appVersion: string
  updater: UpdaterController
}

function formatPublishedAt(iso: string | undefined, en: boolean): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(en ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function UpdatesSection({
  settings,
  onChange,
  en,
  appVersion,
  updater,
}: Props): JSX.Element {
  const { releases, releaseInstall } = updater

  const { loadReleases } = updater
  useEffect(() => {
    // Only ever on mount — Settings remounts this section each time the user
    // opens it, which is exactly when a fresh (never cached) list is wanted.
    void loadReleases()
  }, [loadReleases])

  const installing = releaseInstall.phase === 'checking' || releaseInstall.phase === 'downloading'

  const handleInstall = async (tag: string, version: string): Promise<void> => {
    const confirmed = await desktop.confirm(
      en
        ? `Install v${version}? Xiangzi MD will restart. Rolling back to an older version can occasionally be incompatible with settings or files a newer version has already written.`
        : `确认安装 v${version}？Xiangzi MD 将重启。回退到旧版本时，偶尔可能与新版本已经写入的设置或文件不兼容。`,
      en ? 'Install this version' : '安装该版本',
      en ? 'Install and restart' : '安装并重启',
      en ? 'Cancel' : '取消',
    )
    if (!confirmed) return
    await updater.installRelease(tag)
  }

  return (
    <SettingsPage
      title={en ? 'Software updates' : '软件更新'}
      description={
        en ? 'Keep Xiangzi MD up to date automatically.' : '自动检查并安装 Xiangzi MD 的最新版本。'
      }
    >
      <SettingsCard>
        <ToggleRow
          label={en ? 'Check when Xiangzi MD starts' : '启动时自动检查更新'}
          description={
            en
              ? 'The check runs in the background and never blocks startup.'
              : '后台检查，不阻塞编辑器启动。'
          }
          checked={settings.checkUpdatesOnStartup}
          onChange={(checked) => onChange({ checkUpdatesOnStartup: checked })}
        />
        <div className="update-settings-row">
          <div>
            <strong>{en ? `Current version ${appVersion}` : `当前版本 ${appVersion}`}</strong>
            <p aria-live="polite">{updateStatusText(updater, en)}</p>
          </div>
          <button
            className="secondary-btn"
            disabled={updater.state.phase === 'checking' || updater.state.phase === 'downloading'}
            onClick={() => void updater.checkNow(true)}
          >
            <RefreshCw size={14} className={updater.state.phase === 'checking' ? 'spin' : ''} />
            {en ? 'Check now' : '立即检查'}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title={en ? 'Install a specific version' : '安装指定版本 / 版本回退'}>
        <p className="settings-hint">
          {en
            ? 'The version list is fetched fresh each time you open this page, so a version taken offline disappears from here too.'
            : '每次打开此页都会重新获取版本列表；某个版本被下线后，这里也会同步消失。'}
        </p>

        {releases.phase === 'loading' && (
          <p className="settings-empty-text">{en ? 'Loading versions…' : '正在加载版本列表…'}</p>
        )}
        {releases.phase === 'error' && (
          <p className="update-error" role="alert">
            {en ? 'Could not load the release list.' : '版本列表加载失败。'} {releases.error}
          </p>
        )}
        {releases.phase === 'loaded' && releases.items.length === 0 && (
          <p className="settings-empty-text">
            {en ? 'No published releases found.' : '未找到任何已发布版本。'}
          </p>
        )}
        {releases.phase === 'loaded' && releases.items.length > 0 && (
          <ul className="release-list">
            {releases.items.map((release) => {
              const isBusy = installing && releaseInstall.tag === release.tag
              return (
                <li key={release.tag} className="release-row">
                  <div className="release-row-copy">
                    <strong>
                      v{release.version}
                      {release.isCurrent && (
                        <span className="release-current-badge">{en ? 'Current' : '当前版本'}</span>
                      )}
                    </strong>
                    <small>{formatPublishedAt(release.publishedAt, en)}</small>
                  </div>
                  <button
                    className="secondary-btn"
                    disabled={release.isCurrent || installing}
                    onClick={() => void handleInstall(release.tag, release.version)}
                  >
                    <RotateCcw size={14} className={isBusy ? 'spin' : ''} />
                    {isBusy
                      ? releaseInstall.phase === 'checking'
                        ? en
                          ? 'Preparing…'
                          : '准备中…'
                        : en
                          ? 'Installing…'
                          : '安装中…'
                      : en
                        ? 'Install'
                        : '安装'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {releaseInstall.phase === 'downloading' && (
          <div className="release-progress" aria-live="polite">
            <progress max={100} value={releaseInstall.progress} />
            <span>
              {releaseInstall.progress === undefined
                ? en
                  ? 'Downloading…'
                  : '正在下载…'
                : `${releaseInstall.progress}%`}
            </span>
          </div>
        )}
        {releaseInstall.phase === 'error' && (
          <p className="update-error" role="alert">
            {en ? 'Install failed.' : '安装失败。'} {releaseInstall.error}
          </p>
        )}

        <button
          className="secondary-btn"
          disabled={releases.phase === 'loading'}
          onClick={() => void updater.loadReleases()}
        >
          <RefreshCw size={14} className={releases.phase === 'loading' ? 'spin' : ''} />
          {en ? 'Refresh list' : '刷新列表'}
        </button>
      </SettingsCard>
    </SettingsPage>
  )
}
