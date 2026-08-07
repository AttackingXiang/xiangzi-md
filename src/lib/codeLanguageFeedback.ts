import { createEventBridge } from './bridgeFactory'

export interface CodeLanguageFeedbackDetail {
  language: string
}

const bridge = createEventBridge<CodeLanguageFeedbackDetail>()

export function emitCodeLanguageFeedback(language: string): void {
  bridge.emit({ language })
}

export const subscribeCodeLanguageFeedback = bridge.subscribe
