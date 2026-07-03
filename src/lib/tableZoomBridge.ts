type RequestFn = (html: string) => void

let _handler: RequestFn | null = null

/** 表格「放大展开」弹窗的发布/订阅桥：命令端发起，React 端渲染。 */
export const tableZoomBridge = {
  setHandler: (h: RequestFn | null): void => {
    _handler = h
  },
  request: (html: string): void => {
    _handler?.(html)
  },
}
