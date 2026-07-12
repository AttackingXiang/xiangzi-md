import { RefreshCw } from 'lucide-react'
import type { UpdaterController } from '../../hooks/useUpdater'
import { SettingsPage, SettingsCard, ToggleRow } from './primitives'
import { updateStatusText } from './updateStatusText'
import type { SectionProps } from './types'

interface Props extends SectionProps {
  appVersion: string
  updater: UpdaterController
}

export default function UpdatesSection({
  settings,
  onChange,
  en,
  appVersion,
  updater,
}: Props): JSX.Element {
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
    </SettingsPage>
  )
}
