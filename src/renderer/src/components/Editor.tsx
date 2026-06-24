import { useEffect, useRef } from 'react'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { resolveAssetURL } from '../lib/asset'

interface Props {
  content: string
  /** 当前文档所在目录（用于解析相对图片路径、保存附件）；新建未保存为 null */
  docDir: string | null
  imageMaxWidth: number
  onChange: (markdown: string) => void
}

/**
 * 所见即所得编辑器（Typora 风格），基于 Milkdown Crepe（ProseMirror 内核）。
 * - 本地图片通过 proxyDomURL 解析为 xmd:// 协议显示，Markdown 中仍保存相对路径
 * - 粘贴/拖入图片经 onUpload 存到文档同级附件目录
 */
export default function Editor({ content, docDir, imageMaxWidth, onChange }: Props): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // docDir 可能在保存后变化（同一标签重命名/落盘），用 ref 保证回调读到最新值
  const docDirRef = useRef(docDir)
  docDirRef.current = docDir

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const upload = async (file: File): Promise<string> => {
      const dir = docDirRef.current
      if (!dir) {
        window.alert('请先保存文档，再插入本地图片。')
        return ''
      }
      const buf = new Uint8Array(await file.arrayBuffer())
      const { relPath } = await window.api.saveAttachment(dir, file.name || 'image.png', buf)
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
        }
      }
    })

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown)
      })
    })

    let destroyed = false
    crepe.create().then(() => {
      if (destroyed) crepe.destroy()
    })

    return () => {
      destroyed = true
      crepe.destroy()
    }
    // 仅在挂载时创建；内容更新由 Crepe 内部维护
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="wysiwyg-editor" ref={rootRef} />
}
