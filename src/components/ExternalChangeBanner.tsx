import { AlertTriangle, FileQuestion, RefreshCw } from 'lucide-react'
import { t } from '../lib/i18n'
import type { Tab } from '../types'

interface Props {
  tab: Tab
  onReview: () => void
  onReload: () => void
  onOverwrite: () => void
  onRetry: () => void
  onSaveAs: () => void
  onClose: () => void
}

export default function ExternalChangeBanner({
  tab,
  onReview,
  onReload,
  onOverwrite,
  onRetry,
  onSaveAs,
  onClose,
}: Props): JSX.Element | null {
  if (!tab.diskState) return null

  if (tab.diskState.kind === 'unavailable') {
    return (
      <aside className="external-change-banner unavailable" role="status" aria-live="polite">
        <FileQuestion size={17} aria-hidden="true" />
        <span className="external-change-message">
          {t('此文件已被删除或暂时无法访问。编辑内容仍安全保留在当前标签中。')}
        </span>
        <div className="external-change-actions">
          <button type="button" onClick={onRetry}>
            <RefreshCw size={14} />
            {t('重试')}
          </button>
          <button type="button" onClick={onSaveAs}>
            {t('另存为')}
          </button>
          <button type="button" onClick={onClose}>
            {t('关闭')}
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside className="external-change-banner" role="alert">
      <AlertTriangle size={17} aria-hidden="true" />
      <span className="external-change-message">
        {t('此文件已被其他程序修改。你的未保存内容尚未被覆盖。')}
      </span>
      <div className="external-change-actions">
        <button type="button" onClick={onReview}>
          {t('比较更改')}
        </button>
        <button type="button" onClick={onReload}>
          {t('重新加载')}
        </button>
        <button className="external-overwrite" type="button" onClick={onOverwrite}>
          {t('保留我的版本')}
        </button>
      </div>
    </aside>
  )
}
