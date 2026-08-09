import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n'
import ModalShell from './ModalShell'

interface Props {
  title: string
  initial?: string
  placeholder?: string
  confirmText?: string
  onSubmit: (value: string) => void
  onClose: () => void
}

export default function InputDialog({
  title,
  initial = '',
  placeholder,
  confirmText = t('确定'),
  onSubmit,
  onClose,
}: Props): JSX.Element {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // 文件名默认选中“名称”部分（不含扩展名）
    const dot = initial.lastIndexOf('.')
    if (dot > 0) el.setSelectionRange(0, dot)
    else el.select()
  }, [initial])

  const submit = (): void => {
    const v = value.trim()
    if (!v) return
    onSubmit(v)
    onClose()
  }

  return (
    <ModalShell className="modal modal-input" label={title} onBackdrop={onClose} onEscape={onClose}>
      <div className="modal-header">
        <span>{title}</span>
      </div>
      <div className="modal-body">
        <input
          ref={inputRef}
          className="input-dialog-field"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        <div className="input-dialog-actions">
          <button className="secondary-btn" onClick={onClose}>
            {t('取消')}
          </button>
          <button className="primary-btn" disabled={!value.trim()} onClick={submit}>
            {confirmText}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
