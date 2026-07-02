import { useEffect, useRef } from 'react'
import { desktop } from '../platform'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
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
import { codeMirrorTheme } from '../lib/codeTheme'
import { resizableTableView, tableColumnResizingPlugin } from '../lib/resizableTable'
import { focusPlugin } from '../lib/focusPlugin'
import { searchPlugin } from '../lib/searchPlugin'
import { headingFoldPlugin } from '../lib/headingFold'
import { editorBridge } from '../lib/editorBridge'
import { renderMermaid } from '../lib/mermaidPreview'
import { t } from '../lib/i18n'
import { typewriterScrollDelta } from '../lib/typewriterScroll'
import { setupRichClipboard } from '../lib/richClipboard'

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
  initialScrollTop = 0,
  onScrollTopChange,
  onChange,
}: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
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

    let destroyed = false
    const remoteObjectUrls = new Set<string>()
    const crepe = new Crepe({
      root,
      defaultValue: content,
      featureConfigs: {
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
            table: { label: t('表格') },
            math: { label: t('公式') },
          },
        },
        [CrepeFeature.CodeMirror]: {
          theme: codeMirrorTheme(theme),
          renderPreview: renderMermaid(theme),
          // 有预览的代码块（如 mermaid）默认显示渲染结果，右上角按钮可切回源码
          previewOnlyByDefault: true,
          previewToggleButton: (previewOnlyMode: boolean) =>
            previewOnlyMode
              ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
              : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
        },
      },
    })

    // 注入标题快捷键（⌘1~6 / ⌘0）、专注模式装饰、查找替换
    crepe.editor.use(focusPlugin)
    crepe.editor.use(searchPlugin)
    crepe.editor.use(headingFoldPlugin)
    crepe.editor.use(tableColumnResizingPlugin)
    // 放在 Crepe 自带 tableBlockView 之后注册，同一节点类型由最后注册的视图接管。
    crepe.editor.use(resizableTableView)

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
    root.addEventListener('scroll', reportScroll, { passive: true })
    root.addEventListener('wheel', cancelScrollRestore, { passive: true })
    root.addEventListener('touchstart', cancelScrollRestore, { passive: true })
    root.addEventListener('pointerdown', cancelScrollRestore, true)
    root.addEventListener('beforeinput', markUserEdited)
    root.addEventListener('paste', markUserEdited)
    root.addEventListener('cut', markUserEdited)
    root.addEventListener('drop', markUserEdited)
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
        restoreScroll()
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
      root.removeEventListener('scroll', reportScroll)
      root.removeEventListener('wheel', cancelScrollRestore)
      root.removeEventListener('touchstart', cancelScrollRestore)
      root.removeEventListener('pointerdown', cancelScrollRestore, true)
      root.removeEventListener('beforeinput', markUserEdited)
      root.removeEventListener('paste', markUserEdited)
      root.removeEventListener('cut', markUserEdited)
      root.removeEventListener('drop', markUserEdited)
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
      void crepe.destroy()
    }
    // 仅在挂载时创建；内容更新由 Crepe 内部维护
  }, [])

  // 打字机模式：保持光标垂直居中
  useEffect(() => {
    if (!typewriterMode) return
    const scroller = rootRef.current
    if (!scroller) return
    let pointerSelecting = false

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button === 0) pointerSelecting = true
    }
    const onPointerUp = (): void => {
      pointerSelecting = false
    }
    const onSel = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!scroller.contains(range.startContainer)) return
      const rect = range.getBoundingClientRect()
      const sRect = scroller.getBoundingClientRect()
      const delta = typewriterScrollDelta(sel.isCollapsed, pointerSelecting, rect, sRect)
      if (delta !== null) scroller.scrollBy({ top: delta })
    }
    scroller.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    document.addEventListener('selectionchange', onSel)
    return () => {
      scroller.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      document.removeEventListener('selectionchange', onSel)
    }
  }, [typewriterMode])

  return <div className={`wysiwyg-editor${focusMode ? ' focus-mode' : ''}`} ref={rootRef} />
}
