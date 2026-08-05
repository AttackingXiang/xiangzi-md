import { createRequestBridge } from './bridgeFactory'

export type FindDirection = 'next' | 'previous'

/**
 * 让全局快捷键推进查找匹配，而不必先把焦点交还给查找框。
 *
 * 查找栏原本只在自己的输入框里响应 Enter / ⇧Enter，所以在正文里改完一处、
 * 想跳到下一处就得先点回输入框。⌘G / F3 是这类操作的通用键位。
 */
export const findNavigationBridge =
  createRequestBridge<[direction: FindDirection]>('findNavigationBridge')
