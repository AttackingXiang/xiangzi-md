import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { t } from '../lib/i18n'
import type { CopyFeedbackFormat } from '../lib/copyFeedback'

interface Props {
  format: CopyFeedbackFormat
  onCopyAlternate: () => void
  onClose: () => void
}

export default function CopyFeedbackToast({
  format,
  onCopyAlternate,
  onClose,
}: Props): JSX.Element {
  // 连续复制两次要重新计时。调用方用 sequence 做 key，每次都是一个新实例，
  // 所以这个 effect 只需要挂载时跑一次，不必再把 sequence 当依赖传进来。
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4_500)
    return () => window.clearTimeout(timer)
  }, [onClose])

  const label = format === 'rich' ? t('保留格式') : t('纯文本')
  const alternateLabel = format === 'rich' ? t('复制为纯文本') : t('复制为保留格式')

  return (
    <div className="copy-feedback-toast" role="status" aria-live="polite">
      <Check size={15} aria-hidden="true" />
      <span className="copy-feedback-label">
        <span>{t('已复制')}</span>
        <span aria-hidden="true">·</span>
        <strong>{label}</strong>
      </span>
      <button
        type="button"
        className="copy-feedback-action"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onCopyAlternate}
      >
        {alternateLabel}
      </button>
    </div>
  )
}
