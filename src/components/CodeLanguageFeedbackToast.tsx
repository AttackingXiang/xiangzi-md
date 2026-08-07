import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { t } from '../lib/i18n'

interface Props {
  language: string
  onClose: () => void
}

export default function CodeLanguageFeedbackToast({ language, onClose }: Props): JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4_500)
    return () => window.clearTimeout(timer)
  }, [onClose])

  return (
    <div className="copy-feedback-toast" role="status" aria-live="polite">
      <Check size={15} aria-hidden="true" />
      <span className="copy-feedback-label">
        <span>{t('代码语言已识别')}</span>
        <span aria-hidden="true">·</span>
        <strong>{language}</strong>
      </span>
    </div>
  )
}
