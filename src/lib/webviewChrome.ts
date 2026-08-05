import { desktop } from '../platform'

/** 一次缩放步进所需的累计 wheel 距离；触控板会连续发很多小 delta。 */
const ZOOM_WHEEL_STEP = 60

function isNativeMenuUseful(target: EventTarget | null): boolean {
  // 输入框里的原生菜单提供可用的剪切/复制/粘贴和拼写建议，是真的有用；
  // 其余地方只会露出「重新加载 / 另存为 / 检查」这类浏览器项。
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/**
 * 关掉 WebView 自带的、在桌面应用里不该出现的浏览器行为。
 *
 * 三件事：
 * - 编辑器之外的右键会弹出 WebView 原生菜单（WebView2 上是「返回/重新加载/
 *   另存为/打印/检查」），在桌面应用里很出戏。
 * - Ctrl/⌘ + 滚轮（以及触控板双指捏合）会缩放整个 WebView，误触后整个界面变形，
 *   且没有可见的复位入口。改为路由到应用自己的缩放——它有上下限也会持久化。
 * - 把文件拖到编辑器**以外**的区域，WebView 会直接导航到那个 file:// URL，
 *   整个应用被替换成一个文件预览页，只能重启。
 *
 * 返回取消注册的函数。
 */
export function installWebViewChrome(): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    if (isNativeMenuUseful(event.target)) return
    event.preventDefault()
  }

  let wheelAccumulator = 0
  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey) return
    // 预览弹窗自己实现了 ctrl+滚轮缩放并已经 preventDefault，别再叠一层。
    if (event.defaultPrevented) return
    event.preventDefault()

    wheelAccumulator += event.deltaY
    while (Math.abs(wheelAccumulator) >= ZOOM_WHEEL_STEP) {
      const zoomingOut = wheelAccumulator > 0
      wheelAccumulator -= zoomingOut ? ZOOM_WHEEL_STEP : -ZOOM_WHEEL_STEP
      desktop.triggerMenuAction(zoomingOut ? 'zoom-out' : 'zoom-in')
    }
  }

  // 编辑器自己接管拖放（拖图片进来会上传并插入）。CM6 的 dropCursor 是否
  // preventDefault 掉 dragover 属于它的内部实现，这里不去赌——凡是落在编辑器
  // 内部的拖放一律放行，只兜底编辑器之外的区域。
  const ownsDrop = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest('.cm-editor') !== null

  const onDragOver = (event: DragEvent): void => {
    if (event.defaultPrevented || ownsDrop(event.target)) return
    // 必须 preventDefault，否则 drop 事件根本不会派发，也就拦不住导航。
    event.preventDefault()
  }

  const onDrop = (event: DragEvent): void => {
    if (event.defaultPrevented || ownsDrop(event.target)) return
    event.preventDefault()
  }

  document.addEventListener('contextmenu', onContextMenu)
  // passive: false —— 否则 preventDefault 会被忽略，缩放依旧生效。
  document.addEventListener('wheel', onWheel, { passive: false })
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('drop', onDrop)

  return () => {
    document.removeEventListener('contextmenu', onContextMenu)
    document.removeEventListener('wheel', onWheel)
    document.removeEventListener('dragover', onDragOver)
    document.removeEventListener('drop', onDrop)
  }
}
