import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { desktop } from '../platform'
import { generateExportHTML } from '../features/export/generateExportHtml'
import { createEditorRasterImage } from '../features/export/editorDomExport'
import { estimateRemainingSeconds } from '../features/export/exportProgress'
import { t } from '../lib/i18n'
import { dirName } from '../lib/path'
import type { Tab } from '../types'

export interface ExportActivity {
  label: string
  detail?: string
  percent?: number
  cancellable: boolean
}

function remainingTimeLabel(seconds: number): string {
  if (seconds < 60) return `${t('预计还需约')} ${seconds} ${t('秒')}`
  if (seconds < 3_600) return `${t('预计还需约')} ${Math.ceil(seconds / 60)} ${t('分钟')}`
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.ceil((seconds % 3_600) / 60)
  return `${t('预计还需约')} ${hours} ${t('小时')}${minutes > 0 ? ` ${minutes} ${t('分钟')}` : ''}`
}

interface ExportState {
  tabs: Tab[]
  activeId: string | null
}

export function useExportActions(
  stateRef: { current: ExportState },
  setExportResultPath: Dispatch<SetStateAction<string | null>>,
  setExportActivity: Dispatch<SetStateAction<ExportActivity | null>>,
) {
  const exportInProgressRef = useRef(false)
  const imageExportAbortRef = useRef<AbortController | null>(null)

  const cancelExport = useCallback(() => {
    imageExportAbortRef.current?.abort()
    setExportActivity((activity) =>
      activity
        ? { ...activity, label: t('正在取消导出…'), detail: undefined, cancellable: false }
        : null,
    )
  }, [setExportActivity])

  const exportHTML = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document')
      const res = await desktop.exportHTML(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(t('HTML 导出失败：\n') + (error as Error).message)
    } finally {
      exportInProgressRef.current = false
    }
  }, [setExportResultPath, stateRef])

  const exportPDF = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document')
      const res = await desktop.exportPDF(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(t('PDF 导出失败：\n') + (error as Error).message)
    } finally {
      exportInProgressRef.current = false
    }
  }, [setExportResultPath, stateRef])

  const exportImage = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    const abortController = new AbortController()
    imageExportAbortRef.current = abortController
    let renderingStartedAt = 0
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const res = await desktop.exportImage(
        tab?.name ?? 'document',
        createEditorRasterImage,
        ({ phase, percent }) => {
          if (phase === 'preparing') {
            setExportActivity({ label: t('正在准备长图…'), cancellable: true })
          } else if (phase === 'rendering') {
            if (renderingStartedAt === 0) renderingStartedAt = performance.now()
            const remaining = estimateRemainingSeconds(
              performance.now() - renderingStartedAt,
              percent ?? 0,
            )
            setExportActivity({
              label: t('正在渲染并传输长图…'),
              detail: remaining === undefined ? undefined : remainingTimeLabel(remaining),
              percent,
              cancellable: true,
            })
          } else {
            setExportActivity({ label: t('正在编码图片…'), cancellable: false })
          }
        },
        abortController.signal,
      )
      if (res) setExportResultPath(res.path)
    } catch (error) {
      if (!abortController.signal.aborted) {
        window.alert(t('图片导出失败：\n') + (error as Error).message)
      }
    } finally {
      if (imageExportAbortRef.current === abortController) imageExportAbortRef.current = null
      setExportActivity(null)
      exportInProgressRef.current = false
    }
  }, [setExportActivity, setExportResultPath, stateRef])

  const exportDocx = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      if (!tab) return

      // 导出前先确认 pandoc 可用
      const status = await desktop.pandocStatus()
      if (!status) {
        const confirmed = await desktop.confirm(
          t('未检测到 Pandoc，导出 Word 需要安装 Pandoc。是否打开下载页面？'),
          t('未找到 Pandoc'),
          t('打开下载页面'),
          t('取消'),
        )
        if (confirmed) {
          await desktop.openExternal('https://pandoc.org/installing.html')
        }
        return
      }

      // 获取文档所在目录（用于嵌入相对路径图片）
      const docDir = tab.path ? dirName(tab.path) : null

      const { prepareMarkdownForDocx } = await import('../lib/docxMermaid')
      const markdown = await prepareMarkdownForDocx(tab.content)
      const res = await desktop.exportDocx(markdown, docDir, tab.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(t('Word 导出失败：\n') + (error as Error).message)
    } finally {
      exportInProgressRef.current = false
    }
  }, [stateRef, setExportResultPath])

  return { exportHTML, exportPDF, exportImage, exportDocx, cancelExport }
}
