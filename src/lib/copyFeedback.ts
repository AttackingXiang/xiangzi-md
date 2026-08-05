import { createEventBridge } from './bridgeFactory'

export type CopyFeedbackFormat = 'rich' | 'plain'

export interface CopyFeedbackDetail {
  format: CopyFeedbackFormat
}

/**
 * 复制完成后通知 React 端弹出提示。
 *
 * 走 bridgeFactory 而不是 `window.dispatchEvent(new CustomEvent(...))`：
 * 形状上这就是一个「模块发布、React 订阅」的桥，和其它桥共用一套机制即可。
 * DOM 事件总线还要额外付出 `event as CustomEvent` 的类型断言和运行时字段校验，
 * 而这里的类型本可以在编译期就保证。
 */
const bridge = createEventBridge<CopyFeedbackDetail>()

export function emitCopyFeedback(format: CopyFeedbackFormat): void {
  bridge.emit({ format })
}

export const subscribeCopyFeedback = bridge.subscribe

/** For tests only. */
export const resetCopyFeedback = bridge.reset
