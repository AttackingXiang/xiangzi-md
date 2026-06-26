import { useEffect, useRef } from 'react'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { resolveAssetURL } from '../lib/asset'
import { codeMirrorTheme } from '../lib/codeTheme'
import { setupTableResize } from '../lib/tableResize'
import { headingShortcutKeymap } from '../lib/headingKeymap'
import { focusPlugin } from '../lib/focusPlugin'
import { searchPlugin } from '../lib/searchPlugin'
import { headingFoldPlugin } from '../lib/headingFold'
import { editorBridge } from '../lib/editorBridge'
import { renderMermaid } from '../lib/mermaidPreview'
import { t } from '../lib/i18n'

interface Props {
  content: string
  /** 当前文档所在目录（用于解析相对图片路径、保存附件）；新建未保存为 null */
  docDir: string | null
  /** 当前文档文件名（用于按文档名分文件夹的附件模式） */
  docName: string
  /** 已打开文件夹（仓库）根目录，用于仓库级附件模式 */
  vaultRoot: string | null
  imageMaxWidth: number
  /** 已解析的主题，用于代码块语法高亮配色 */
  theme: 'light' | 'dark'
  focusMode: boolean
  typewriterMode: boolean
  onChange: (markdown: string) => void
}

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
  imageMaxWidth,
  theme,
  focusMode,
  typewriterMode,
  onChange
}: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // docDir 可能在保存后变化（同一标签重命名/落盘），用 ref 保证回调读到最新值
  const docDirRef = useRef(docDir)
  docDirRef.current = docDir
  const docNameRef = useRef(docName)
  docNameRef.current = docName
  const vaultRootRef = useRef(vaultRoot)
  vaultRootRef.current = vaultRoot

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const upload = async (file: File): Promise<string> => {
      const dir = docDirRef.current
      if (!dir) {
        window.alert(t('请先保存文档，再插入本地图片。'))
        return ''
      }
      const buf = new Uint8Array(await file.arrayBuffer())
      const { relPath } = await window.api.saveAttachment(
        dir,
        docNameRef.current,
        vaultRootRef.current,
        file.name || 'image.png',
        buf
      )
      return relPath
    }

    const crepe = new Crepe({
      root,
      defaultValue: content,
      featureConfigs: {
        [CrepeFeature.ImageBlock]: {
          proxyDomURL: (url: string) => resolveAssetURL(docDirRef.current, url),
          onUpload: upload,
          blockOnUpload: upload,
          inlineOnUpload: upload,
          ...(imageMaxWidth > 0 ? { maxWidth: imageMaxWidth } : {})
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
            divider: { label: t('分割线') }
          },
          listGroup: {
            label: t('列表'),
            bulletList: { label: t('无序列表') },
            orderedList: { label: t('有序列表') },
            taskList: { label: t('任务列表') }
          },
          advancedGroup: {
            label: t('高级'),
            image: { label: t('图片') },
            codeBlock: { label: t('代码块') },
            table: { label: t('表格') },
            math: { label: t('公式') }
          }
        },
        [CrepeFeature.CodeMirror]: {
          theme: codeMirrorTheme(theme),
          renderPreview: renderMermaid(theme),
          // 有预览的代码块（如 mermaid）默认显示渲染结果，右上角按钮可切回源码
          previewOnlyByDefault: true,
          previewToggleButton: (previewOnlyMode: boolean) =>
            previewOnlyMode
              ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
              : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
        }
      }
    })

    // 注入标题快捷键（⌘1~6 / ⌘0）、专注模式装饰、查找替换
    crepe.editor.use(headingShortcutKeymap)
    crepe.editor.use(focusPlugin)
    crepe.editor.use(searchPlugin)
    crepe.editor.use(headingFoldPlugin)

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown)
      })
    })

    let destroyed = false
    let disposeTableResize: (() => void) | undefined
    crepe.create().then(() => {
      if (destroyed) {
        crepe.destroy()
        return
      }
      disposeTableResize = setupTableResize(root)
      // 暴露 ProseMirror 视图给查找/替换
      crepe.editor.action((ctx) => editorBridge.set(ctx.get(editorViewCtx)))
    })

    return () => {
      destroyed = true
      disposeTableResize?.()
      editorBridge.set(null)
      crepe.destroy()
    }
    // 仅在挂载时创建；内容更新由 Crepe 内部维护
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 打字机模式：保持光标垂直居中
  useEffect(() => {
    if (!typewriterMode) return
    const scroller = rootRef.current
    if (!scroller) return
    const onSel = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!scroller.contains(range.startContainer)) return
      const rect = range.getBoundingClientRect()
      if (rect.height === 0 && rect.top === 0) return
      const sRect = scroller.getBoundingClientRect()
      const delta = rect.top + rect.height / 2 - (sRect.top + sRect.height / 2)
      if (Math.abs(delta) > 2) scroller.scrollBy({ top: delta })
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [typewriterMode])

  return <div className={`wysiwyg-editor${focusMode ? ' focus-mode' : ''}`} ref={rootRef} />
}

