import { memo } from 'react'

interface Props {
  label: string
  percent?: number
}

const ExportProgressToast = memo(function ExportProgressToast({
  label,
  percent,
}: Props): JSX.Element {
  return (
    <div className="export-progress-toast" role="status" aria-live="polite">
      <span className="export-progress-spinner" aria-hidden="true" />
      <span className="export-progress-content">
        <span className="export-progress-label">
          <span>{label}</span>
          {percent !== undefined && <span>{percent}%</span>}
        </span>
        {percent !== undefined && <progress max={100} value={percent} />}
      </span>
    </div>
  )
})

export default ExportProgressToast
