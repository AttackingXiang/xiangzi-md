import { X } from 'lucide-react'
import { t } from '../../../lib/i18n'

interface Props {
  tag: string
  active?: boolean
  compact?: boolean
  removing?: boolean
  onClick?: () => void
  onRemove?: () => void
}

export default function TagChip({
  tag,
  active = false,
  compact = false,
  removing = false,
  onClick,
  onRemove,
}: Props) {
  const className = `tag-chip${active ? ' active' : ''}${compact ? ' compact' : ''}${onRemove ? ' removable' : ''}`
  if (!onClick && !onRemove) return <span className={className}>#{tag}</span>
  return (
    <span className={className}>
      {onClick ? (
        <button type="button" className="tag-chip-label" onClick={onClick} title={`#${tag}`}>
          #{tag}
        </button>
      ) : (
        <span className="tag-chip-label">#{tag}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className="tag-chip-remove"
          onClick={onRemove}
          disabled={removing}
          aria-label={t('移除标签')}
          title={t('移除标签')}
        >
          <X size={11} />
        </button>
      )}
    </span>
  )
}
