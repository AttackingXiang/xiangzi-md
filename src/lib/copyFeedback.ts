export type CopyFeedbackFormat = 'rich' | 'plain'

export interface CopyFeedbackDetail {
  format: CopyFeedbackFormat
}

const COPY_FEEDBACK_EVENT = 'xmd-copy-feedback'

export function emitCopyFeedback(format: CopyFeedbackFormat): void {
  window.dispatchEvent(
    new CustomEvent<CopyFeedbackDetail>(COPY_FEEDBACK_EVENT, {
      detail: { format },
    }),
  )
}

export function subscribeCopyFeedback(listener: (detail: CopyFeedbackDetail) => void): () => void {
  const onFeedback = (event: Event): void => {
    const detail = (event as CustomEvent<CopyFeedbackDetail>).detail
    if (detail?.format === 'rich' || detail?.format === 'plain') listener(detail)
  }
  window.addEventListener(COPY_FEEDBACK_EVENT, onFeedback)
  return () => window.removeEventListener(COPY_FEEDBACK_EVENT, onFeedback)
}
