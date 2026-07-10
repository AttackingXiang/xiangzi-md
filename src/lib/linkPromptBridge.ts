type RequestFn = (initial: string, onSubmit: (href: string) => void) => void

let _handler: RequestFn | null = null

/**
 * 「插入链接」输入弹窗的发布/订阅桥：命令端发起（需要一个 URL），React 端用
 * 应用内 InputDialog 采集后回调。取代 `window.prompt`——后者在 Tauri 生产
 * webview 里并不可靠，且与应用自有弹窗风格不一致。
 */
export const linkPromptBridge = {
  setHandler: (h: RequestFn | null): void => {
    _handler = h
  },
  request: (initial: string, onSubmit: (href: string) => void): void => {
    _handler?.(initial, onSubmit)
  },
}
