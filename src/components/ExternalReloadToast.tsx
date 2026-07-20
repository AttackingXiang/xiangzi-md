import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { t } from '../lib/i18n'

interface Props {
  name: string
  sequence: number
  onClose: () => void
}

export default function ExternalReloadToast({ name, sequence, onClose }: Props): JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 2_800)
    return () => window.clearTimeout(timer)
  }, [onClose, sequence])

  return (
    <div className="external-reload-toast" role="status" aria-live="polite">
      <RefreshCw size={14} aria-hidden="true" />
      <span>{t('已从磁盘更新')}</span>
      <strong>{name}</strong>
    </div>
  )
}
