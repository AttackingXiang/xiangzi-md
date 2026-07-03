import { useEffect, useRef } from 'react'
import { desktop } from '../platform'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import {
  clearTextInCurrentBlockCommand,
  hardbreakFilterNodes,
} from '@milkdown/kit/preset/commonmark'
import { tablePickerBridge } from '../lib/tablePickerBridge'
import { editorCmd } from '../lib/editorCommands'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import {
  BLOCKED_REMOTE_IMAGE,
  blobPartFromBytes,
  imageMimeType,
  resolveAssetURL,
} from '../lib/asset'
import { resizableTableView, tableColumnResizingPlugin } from '../lib/resizableTable'
import { focusPlugin } from '../lib/focusPlugin'
import { searchPlugin } from '../lib/searchPlugin'
import { headingFoldPlugin } from '../lib/headingFold'
import { toolbarStatePlugin } from '../lib/toolbarStatePlugin'
import { editorBridge } from '../lib/editorBridge'
import { t } from '../lib/i18n'
import { typewriterScrollDelta } from '../lib/typewriterScroll'
import { setupRichClipboard } from '../lib/richClipboard'
import { codeHighlightPlugin } from '../lib/codeHighlight'
import { codeBlockView, setCodeBlockTheme } from '../lib/staticCodeBlock'
import { codeMirrorTheme } from '../lib/codeTheme'

interface Props {
  content: string
  /** 当前文档所在目录（用于解析相对图片路径、保存附件）；新建未保存为 null */
  docDir: string | null
  /** 当前文档文件名（用于按文档名分文件夹的附件模式） */
  docName: string
  /** 已打开文件夹（仓库）根目录，用于仓库级附件模式 */
  vaultRoot: string | null
  /** 额外图片搜索目录，解析失败时依序尝试 */
  assetSearchPaths: string[]
  /** 是否允许编辑器向远程图片主机发起网络请求 */
  allowRemoteImages: boolean
  imageMaxWidth: number
  /** 已解析的主题，用于代码块语法高亮配色 */
  theme: 'light' | 'dark'
  focusMode: boolean
  typewriterMode: boolean
  /** 阅读模式：编辑器只读，尝试编辑时提示先关闭 */
  readingMode: boolean
  initialScrollTop?: number
  onScrollTopChange?: (scrollTop: number) => void
  onChange: (markdown: string) => void
}

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/**
 * 所见即所得编辑器，基于 Milkdown Crepe（ProseMirror 内核）。
 * - 本地图片通过 proxyDomURL 解析为 xmd:// 协议显示，Markdown 中仍保存相对路径
 * - 粘贴/拖入图片经 onUpload 存到文档同级附件目录
 */
export default function Editor({
  content,
  docDir,
  docName,
  vaultRoot,
  assetSearchPaths,
  allowRemoteImages,
  imageMaxWidth,
  theme,
  focusMode,
  typewriterMode,
  readingMode,
  initialScrollTop = 0,
  onScrollTopChange,
  onChange,
}: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const readingModeRef = useRef(readingMode)
  readingModeRef.current = readingMode
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const contentRef = useRef(content)
  contentRef.current = content
  const onScrollTopChangeRef = useRef(onScrollTopChange)
  onScrollTopChangeRef.current = onScrollTopChange
  // docDir 可能在保存后变化（同一标签重命名/落盘），用 ref 保证回调读到最新值
  const docDirRef = useRef(docDir)
  docDirRef.current = docDir
  const docNameRef = useRef(docName)
  docNameRef.current = docName
  const vaultRootRef = useRef(vaultRoot)
  vaultRootRef.current = vaultRoot
  const assetSearchPathsRef = useRef(assetSearchPaths)
  assetSearchPathsRef.current = assetSearchPaths
  const allowRemoteImagesRef = useRef(allowRemoteImages)
  allowRemoteImagesRef.current = allowRemoteImages

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const upload = async (file: File): Promise<string> => {
      const dir = docDirRef.current
      if (!dir) {
        window.alert(t('请先保存文档，再插入本地图片。'))
        return ''
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        window.alert(t('单个附件不能超过 20 MB。'))
        return ''
      }
      const buf = new Uint8Array(await file.arrayBuffer())
      const { relPath } = await desktop.saveAttachment(
        dir,
        docNameRef.current,
        vaultRootRef.current,
        file.name || 'image.png',
        buf,
      )
      return relPath
    }

    setCodeBlockTheme(theme)
    let destroyed = false
    const remoteObjectUrls = new Set<string>()
    const crepe = new Crepe({
      root,
      defaultValue: content,
      featureConfigs: {
        [CrepeFeature.CodeMirror]: {
          theme: codeMirrorTheme(theme),
        },
        [CrepeFeature.ImageBlock]: {
          proxyDomURL: async (url: string) => {
            if (/^https?:/i.test(url)) {
              if (!allowRemoteImagesRef.current || !/^https:/i.test(url)) {
                return BLOCKED_REMOTE_IMAGE
              }
              try {
                const bytes = await desktop.readRemoteImage(url)
                if (destroyed) return BLOCKED_REMOTE_IMAGE
                const objectUrl = URL.createObjectURL(
                  new Blob([blobPartFromBytes(bytes)], { type: imageMimeType(url) }),
                )
                remoteObjectUrls.add(objectUrl)
                return objectUrl
              } catch {
                return BLOCKED_REMOTE_IMAGE
              }
            }
            return resolveAssetURL(
              docDirRef.current,
              url,
              vaultRootRef.current,
              assetSearchPathsRef.current,
            )
          },
          onUpload: upload,
          blockOnUpload: upload,
          inlineOnUpload: upload,
          ...(imageMaxWidth > 0 ? { maxWidth: imageMaxWidth } : {}),
        },
        [CrepeFeature.BlockEdit]: {
          textGroup: {
            label: t('文本'),
            text: { label: t('正文') },
            h1: { label: t('标题1') },
            h2: { label: t('标题2') },
            h3: { label: t('标题3') },
            h4: { label: t('标题4') },
            h5: { label: t('标题5') },
            h6: { label: t('标题6') },
            quote: { label: t('引用') },
            divider: { label: t('分割线') },
          },
          listGroup: {
            label: t('列表'),
            bulletList: { label: t('无序列表') },
            orderedList: { label: t('有序列表') },
            taskList: { label: t('任务列表') },
          },
          advancedGroup: {
            label: t('高级'),
            image: { label: t('图片') },
            codeBlock: { label: t('代码块') },
            table: null,
            math: { label: t('公式') },
          },
          buildMenu: (builder) => {
            builder.getGroup('advanced').addItem('table', {
              label: t('表格'),
              icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M20 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H20C21.1 21 22 20.1 22 19V5C22 3.9 21.1 3 20 3ZM20 5V8H5V5H20ZM15 19H10V10H15V19ZM5 10H8V19H5V10ZM17 19V10H20V19H17Z"/></svg>`,
              onRun: (ctx) => {
                const view = ctx.get(editorViewCtx)
                const { from } = view.state.selection
                const coords = view.coordsAtPos(from)
                ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
                tablePickerBridge.request(coords.left, coords.bottom + 8, (r, c) =>
                  editorCmd.insertTable(r, c),
                )
              },
            })
          },
        },
      },
    })

    crepeRef.current = crepe

    // 允许在表格单元格内用 Shift+Enter 插入换行：去掉对 "table" 的拦截。
    // Milkdown 的 hardbreakFilterPlugin 默认会过滤 table 和 code_block 内的
    // hard_break 事务，这里通过覆盖上下文将 table 从禁止列表移除。
    crepe.editor.config((ctx) => {
      ctx.update(hardbreakFilterNodes.key, (nodes) => nodes.filter((n) => n !== 'table'))
    })

    // 注入标题快捷键（⌘1~6 / ⌘0）、专注模式装饰、查找替换
    crepe.editor.use(focusPlugin)
    crepe.editor.use(searchPlugin)
    crepe.editor.use(headingFoldPlugin)
    crepe.editor.use(toolbarStatePlugin)
    crepe.editor.use(tableColumnResizingPlugin)
    // 放在 Crepe 自带 tableBlockView 之后注册，同一节点类型由最后注册的视图接管。
    crepe.editor.use(resizableTableView)
    // 静态代码块：取代 CodeMirror NodeView，消除异步高度回流导致的页面漂移。
    // codeBlockView 注册在所有 Crepe 特性之后，确保接管 code_block 节点的渲染。
    crepe.editor.use(codeHighlightPlugin)
    crepe.editor.use(codeBlockView)

    let ready = false
    let userEdited = false
    let baselineMarkdown = content
    let scrollRestoreFrame: number | null = null
    let restoringScroll = true
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        // 初始化阶段 Milkdown 会规范化 Markdown；以 create 完成后的内容为基线，
        // 只有真实输入/编辑操作发生后才提交，避免异步初始化把刚打开的文件标脏。
        if (!ready || destroyed) return
        if (!userEdited) {
          baselineMarkdown = markdown
          return
        }
        onChangeRef.current(markdown)
      })
    })

    let editorView: EditorView | undefined

    // ── Scroll anchoring ──────────────────────────────────────────────────
    // WebKit/WKWebView does not implement CSS scroll anchoring, so when content
    // above the viewport changes height after initial layout — CodeMirror code
    // blocks re-measuring, tables, images, async node views — the text the user
    // is reading visibly slides even though scrollTop never changes. We emulate
    // scroll anchoring: remember the top-level block currently at the top of the
    // viewport and its offset, and whenever the content resizes, nudge scrollTop
    // so that block stays put. Adjusting scrollTop does not change content size,
    // so this cannot feed back into the ResizeObserver.
    //
    // Anchoring stands down entirely during programmatic navigation (outline
    // click / restore), because there scrollTop is being animated on purpose and
    // compensating would fight the animation. `navigating` is armed by the
    // xmd-navigate event and disarmed once the scroll settles.
    let anchorEl: Element | null = null
    let anchorOffset = 0
    let anchorAdjusting = false
    let navigating = false
    let navSettleTimer: number | null = null
    const pickAnchor = (): void => {
      const dom = editorView?.dom
      if (!dom) return
      const rect = root.getBoundingClientRect()
      const x = rect.left + Math.min(40, rect.width / 2)
      const el = document.elementFromPoint(x, rect.top + 2)
      if (!el || !dom.contains(el)) {
        anchorEl = null
        return
      }
      let block: Element | null = el
      while (block && block.parentElement !== dom) block = block.parentElement
      if (!block) {
        anchorEl = null
        return
      }
      anchorEl = block
      anchorOffset = block.getBoundingClientRect().top - rect.top
    }
    const applyAnchor = (): void => {
      const dom = editorView?.dom
      if (navigating || restoringScroll || !dom || !anchorEl || !dom.contains(anchorEl)) {
        if (!navigating && !restoringScroll) pickAnchor()
        return
      }
      const containerTop = root.getBoundingClientRect().top
      const delta = anchorEl.getBoundingClientRect().top - containerTop - anchorOffset
      if (Math.abs(delta) >= 1) {
        anchorAdjusting = true
        root.scrollTop += delta
        anchorAdjusting = false
      }
    }
    const onScrollRepick = (): void => {
      // A real user scroll redefines what should stay anchored; our own anchor
      // correction and any in-flight navigation animation must not.
      if (!anchorAdjusting && !restoringScroll && !navigating) pickAnchor()
    }

    const disposeRichClipboard = setupRichClipboard(root)
    const clearSelectAllVisual = (): void => {
      if (!root.classList.contains('select-all-active')) return
      root.classList.remove('select-all-active')
      window.getSelection()?.removeAllRanges()
    }
    const clearSelectAllOnKey = (event: KeyboardEvent): void => {
      const keepSelection =
        (event.metaKey || event.ctrlKey) && ['a', 'c'].includes(event.key.toLowerCase())
      const editingShortcut =
        (event.metaKey || event.ctrlKey) &&
        ['0', '1', '2', '3', '4', '5', '6', 'b', 'i'].includes(event.key.toLowerCase())
      if (editingShortcut) userEdited = true
      if (!keepSelection) clearSelectAllVisual()
    }
    const markEditorControl = (event: PointerEvent): void => {
      if (!(event.target instanceof Element)) return
      if (
        event.target.closest(
          '.milkdown-toolbar button, .milkdown-block-handle button, .milkdown-slash-menu button, [role="menuitem"]',
        )
      ) {
        userEdited = true
      }
    }
    const markTableResize = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('td, th') && root.querySelector('.ProseMirror.resize-cursor')) {
        userEdited = true
      }
    }
    const focusEditorFromBlankArea = (event: PointerEvent): void => {
      if (event.button !== 0 || !editorView || !(event.target instanceof Element)) return
      if (event.target.closest('.ProseMirror')) return

      const clickedRoot = event.target === root
      const clickedMilkdownBackground = event.target.classList.contains('milkdown')
      if (!clickedRoot && !clickedMilkdownBackground) return

      const editorRect = editorView.dom.getBoundingClientRect()
      const horizontalInset = Math.min(2, editorRect.width / 2)
      const verticalInset = Math.min(2, editorRect.height / 2)
      const left = Math.min(
        Math.max(event.clientX, editorRect.left + horizontalInset),
        editorRect.right - horizontalInset,
      )
      const top = Math.min(
        Math.max(event.clientY, editorRect.top + verticalInset),
        editorRect.bottom - verticalInset,
      )
      const mapped = editorView.posAtCoords({ left, top })
      const selection = mapped
        ? TextSelection.near(editorView.state.doc.resolve(mapped.pos))
        : event.clientY < editorRect.top
          ? TextSelection.atStart(editorView.state.doc)
          : TextSelection.atEnd(editorView.state.doc)

      event.preventDefault()
      editorView.dispatch(editorView.state.tr.setSelection(selection).scrollIntoView())
      editorView.focus()
    }
    const onSelectAllRequest = (event: Event): void => {
      if (!editorView) return
      event.preventDefault()
      editorView.dispatch(editorView.state.tr.setSelection(new AllSelection(editorView.state.doc)))
      editorView.focus()
      root.classList.add('select-all-active')
    }
    window.addEventListener('xmd-select-all', onSelectAllRequest)
    window.addEventListener('xmd-clear-select-all', clearSelectAllVisual)
    document.addEventListener('pointerdown', clearSelectAllVisual, true)
    root.addEventListener('pointerdown', clearSelectAllVisual, true)
    root.addEventListener('pointerdown', markEditorControl, true)
    root.addEventListener('mousedown', markTableResize, true)
    root.addEventListener('pointerdown', focusEditorFromBlankArea)
    root.addEventListener('keydown', clearSelectAllOnKey, true)
    const cancelScrollRestore = (): void => {
      restoringScroll = false
      if (scrollRestoreFrame !== null) {
        cancelAnimationFrame(scrollRestoreFrame)
        scrollRestoreFrame = null
      }
    }
    root.addEventListener('scroll', onScrollRepick, { passive: true })
    const reportScroll = (): void => {
      if (!restoringScroll) onScrollTopChangeRef.current?.(root.scrollTop)
    }
    const restoreScroll = (): void => {
      let attempts = 0
      let stableFrames = 0
      const apply = (): void => {
        if (destroyed || !restoringScroll) return
        root.scrollTop = initialScrollTop
        attempts += 1
        const reached = Math.abs(root.scrollTop - initialScrollTop) <= 1
        stableFrames = reached ? stableFrames + 1 : 0
        // Milkdown node views and local images finish layout asynchronously.
        // Keep the requested position stable for about one second so a late
        // selection/layout update cannot pull a restored tab back to the top.
        if (stableFrames >= 60 || attempts >= 180) {
          restoringScroll = false
          scrollRestoreFrame = null
          onScrollTopChangeRef.current?.(root.scrollTop)
          return
        }
        scrollRestoreFrame = requestAnimationFrame(apply)
      }
      scrollRestoreFrame = requestAnimationFrame(apply)
    }
    const markUserEdited = (): void => {
      userEdited = true
    }
    // Arm the anchoring stand-down for the duration of a navigation. The glide
    // fires scroll events; each one pushes the disarm out by 200ms, so anchoring
    // resumes only once the animation has actually settled — at which point the
    // next reportScroll/onScrollRepick re-picks the anchor at the landing spot.
    const disarmNavigating = (): void => {
      if (navSettleTimer !== null) clearTimeout(navSettleTimer)
      navSettleTimer = window.setTimeout(() => {
        navigating = false
        navSettleTimer = null
        pickAnchor()
      }, 200)
    }
    const onNavigateRequest = (): void => {
      cancelScrollRestore()
      navigating = true
      disarmNavigating()
    }
    const onNavScroll = (): void => {
      if (navigating) disarmNavigating()
    }
    root.addEventListener('scroll', onNavScroll, { passive: true })
    root.addEventListener('scroll', reportScroll, { passive: true })
    root.addEventListener('wheel', cancelScrollRestore, { passive: true })
    root.addEventListener('touchstart', cancelScrollRestore, { passive: true })
    root.addEventListener('pointerdown', cancelScrollRestore, true)
    root.addEventListener('beforeinput', markUserEdited)
    root.addEventListener('paste', markUserEdited)
    root.addEventListener('cut', markUserEdited)
    root.addEventListener('drop', markUserEdited)
    window.addEventListener('xmd-navigate', onNavigateRequest)
    // Emulated scroll anchoring: when the content's height changes (images,
    // mermaid SVGs loading), hold the block the reader is looking at in place
    // by compensating scrollTop.
    let resizeObserver: ResizeObserver | null = null
    void crepe
      .create()
      .then(() => {
        if (destroyed) {
          void crepe.destroy()
          return
        }
        // 暴露 ProseMirror 视图给查找/替换
        crepe.editor.action((ctx) => {
          editorView = ctx.get(editorViewCtx)
          editorBridge.set(editorView, markUserEdited)
        })
        baselineMarkdown = crepe.getMarkdown()
        ready = true
        crepe.setReadonly(readingModeRef.current)
        restoreScroll()
        const contentEl = editorView?.dom
        if (!contentEl) return
        pickAnchor()
        resizeObserver = new ResizeObserver(() => applyAnchor())
        resizeObserver.observe(contentEl)
      })
      .catch((error: unknown) => console.error('Editor initialization failed', error))

    return () => {
      destroyed = true
      for (const url of remoteObjectUrls) URL.revokeObjectURL(url)
      remoteObjectUrls.clear()
      disposeRichClipboard()
      window.removeEventListener('xmd-select-all', onSelectAllRequest)
      window.removeEventListener('xmd-clear-select-all', clearSelectAllVisual)
      document.removeEventListener('pointerdown', clearSelectAllVisual, true)
      root.removeEventListener('pointerdown', clearSelectAllVisual, true)
      root.removeEventListener('pointerdown', markEditorControl, true)
      root.removeEventListener('mousedown', markTableResize, true)
      root.removeEventListener('pointerdown', focusEditorFromBlankArea)
      root.removeEventListener('keydown', clearSelectAllOnKey, true)
      root.removeEventListener('scroll', onScrollRepick)
      root.removeEventListener('scroll', onNavScroll)
      root.removeEventListener('scroll', reportScroll)
      root.removeEventListener('wheel', cancelScrollRestore)
      root.removeEventListener('touchstart', cancelScrollRestore)
      root.removeEventListener('pointerdown', cancelScrollRestore, true)
      root.removeEventListener('beforeinput', markUserEdited)
      root.removeEventListener('paste', markUserEdited)
      root.removeEventListener('cut', markUserEdited)
      root.removeEventListener('drop', markUserEdited)
      window.removeEventListener('xmd-navigate', onNavigateRequest)
      resizeObserver?.disconnect()
      if (navSettleTimer !== null) clearTimeout(navSettleTimer)
      if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame)
      // Do not persist from passive-effect cleanup. React may already have
      // detached this keyed editor from layout, at which point WebKit reports
      // scrollTop as 0 and would overwrite the position captured on pointerdown.
      clearSelectAllVisual()
      if (ready && userEdited) {
        try {
          const latestMarkdown = crepe.getMarkdown()
          if (latestMarkdown !== baselineMarkdown && latestMarkdown !== contentRef.current) {
            onChangeRef.current(latestMarkdown)
          }
        } catch {
          // 编辑器已进入销毁流程时，不再读取状态。
        }
      }
      if (editorBridge.get() === editorView) editorBridge.set(null)
      editorView = undefined
      crepeRef.current = null
      void crepe.destroy()
    }
    // 仅在挂载时创建；内容更新由 Crepe 内部维护
  }, [])

  // 阅读模式：切换编辑器只读态；尝试编辑时提示先关闭
  useEffect(() => {
    crepeRef.current?.setReadonly(readingMode)
    const root = rootRef.current
    if (!root) return
    root.classList.toggle('reading-mode', readingMode)
    if (!readingMode) return

    let toastEl: HTMLElement | null = null
    let toastTimer: number | null = null
    const showHint = (): void => {
      if (toastEl) return
      const el = document.createElement('div')
      el.className = 'reading-mode-toast'
      el.textContent = t('请先关闭阅读模式')
      root.appendChild(el)
      toastEl = el
      toastTimer = window.setTimeout(() => {
        el.remove()
        if (toastEl === el) toastEl = null
        toastTimer = null
      }, 1600)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      // Let navigation, selection and shortcuts (copy, find, …) through; only
      // intercept keys that would mutate the document.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const mutates =
        event.key.length === 1 || ['Enter', 'Backspace', 'Delete', 'Tab'].includes(event.key)
      if (!mutates) return
      event.preventDefault()
      showHint()
    }
    const onEditEvent = (event: Event): void => {
      event.preventDefault()
      showHint()
    }
    root.addEventListener('keydown', onKeyDown, true)
    root.addEventListener('paste', onEditEvent, true)
    root.addEventListener('cut', onEditEvent, true)
    root.addEventListener('drop', onEditEvent, true)
    return () => {
      root.removeEventListener('keydown', onKeyDown, true)
      root.removeEventListener('paste', onEditEvent, true)
      root.removeEventListener('cut', onEditEvent, true)
      root.removeEventListener('drop', onEditEvent, true)
      if (toastTimer !== null) clearTimeout(toastTimer)
      toastEl?.remove()
    }
  }, [readingMode])

  // 打字机模式：保持光标垂直居中
  useEffect(() => {
    if (!typewriterMode) return
    const scroller = rootRef.current
    if (!scroller) return
    let pointerSelecting = false
    let navigating = false
    let navScrollEnd: number | null = null

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button === 0) pointerSelecting = true
    }
    const onPointerUp = (): void => {
      pointerSelecting = false
    }
    const onSel = (): void => {
      if (navigating) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!scroller.contains(range.startContainer)) return
      const rect = range.getBoundingClientRect()
      const sRect = scroller.getBoundingClientRect()
      const delta = typewriterScrollDelta(sel.isCollapsed, pointerSelecting, rect, sRect)
      if (delta !== null) scroller.scrollBy({ top: delta })
    }
    // Suppress typewriter re-centering while the smooth scroll from outline navigation
    // is in progress. The 'xmd-navigate' event arms the guard; the guard is cleared
    // 150 ms after the last scroll event fires (i.e. after the animation settles).
    const onNavigateStart = (): void => {
      navigating = true
    }
    const onScrollDuringNav = (): void => {
      if (!navigating) return
      if (navScrollEnd !== null) clearTimeout(navScrollEnd)
      navScrollEnd = window.setTimeout(() => {
        navigating = false
        navScrollEnd = null
      }, 150)
    }
    scroller.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    document.addEventListener('selectionchange', onSel)
    window.addEventListener('xmd-navigate', onNavigateStart)
    scroller.addEventListener('scroll', onScrollDuringNav, { passive: true })
    return () => {
      scroller.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      document.removeEventListener('selectionchange', onSel)
      window.removeEventListener('xmd-navigate', onNavigateStart)
      scroller.removeEventListener('scroll', onScrollDuringNav)
      if (navScrollEnd !== null) clearTimeout(navScrollEnd)
    }
  }, [typewriterMode])

  return <div className={`wysiwyg-editor${focusMode ? ' focus-mode' : ''}`} ref={rootRef} />
}
