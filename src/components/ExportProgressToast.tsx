import { memo } from 'react'
import { t } from '../lib/i18n'

interface Props {
  label: string
  detail?: string
  percent?: number
  cancellable: boolean
  onCancel: () => void
}

const ExportProgressToast = memo(function ExportProgressToast({
  label,
  detail,
  percent,
  cancellable,
  onCancel,
}: Props): JSX.Element {
  return (
    <div className="export-progress-toast" role="status" aria-live="polite">
      <span className="export-progress-spinner" aria-hidden="true" />
      <span className="export-progress-content">
        <span className="export-progress-label">
          <span>{label}</span>
          {percent !== undefined && <span>{percent}%</span>}
        </span>
        {detail && <span className="export-progress-detail">{detail}</span>}
        {percent !== undefined && <progress max={100} value={percent} />}
      </span>
      {cancellable && (
        <button className="export-progress-cancel" type="button" onClick={onCancel}>
          {t('取消导出')}
        </button>
      )}
    </div>
  )
})

export default ExportProgressToast
