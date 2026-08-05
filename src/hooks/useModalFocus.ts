import { useEffect, useRef, type RefObject } from 'react'
import { isTopmostModal, popModal, pushModal } from '../lib/modalStack'

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * 把键盘焦点限制在模态框内，并在关闭后还给打开它的控件。
 *
 * 传入 `onEscape` 时还会接管 Escape：只有处于模态栈最内层的弹窗才会响应，
 * 所以嵌套弹窗按一次 Escape 只关掉自己，不会连带关掉父弹窗。
 */
export function useModalFocus<T extends HTMLElement>(
  active = true,
  onEscape?: () => void,
): RefObject<T> {
  const ref = useRef<T>(null)
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape

  useEffect(() => {
    if (!active) return undefined
    const dialog = ref.current
    if (!dialog) return undefined
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    pushModal(dialog)
    // 捕获阶段：焦点可能已经回到 WebView 根节点，冒泡路径上不一定有这个弹窗。
    const onEscapeKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (!escapeRef.current || !isTopmostModal(dialog)) return
      event.preventDefault()
      event.stopPropagation()
      escapeRef.current()
    }
    document.addEventListener('keydown', onEscapeKeyDown, true)

    const focusable = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
      )
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items.at(-1) ?? first
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', onKeyDown)
    return () => {
      dialog.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keydown', onEscapeKeyDown, true)
      popModal(dialog)
      previous?.focus()
    }
  }, [active])
  return ref
}
