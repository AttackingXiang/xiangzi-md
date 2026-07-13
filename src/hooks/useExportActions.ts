import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { desktop } from '../platform'
import { generateExportHTML } from '../features/export/generateExportHtml'
import { t } from '../lib/i18n'
import { dirName } from '../lib/path'
import type { Tab } from '../types'

interface ExportState {
  tabs: Tab[]
  activeId: string | null
}

export function useExportActions(
  stateRef: { current: ExportState },
  setExportResultPath: Dispatch<SetStateAction<string | null>>,
) {
  const exportInProgressRef = useRef(false)
  const exportHTML = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content, false, {
        docDir: tab?.path ? dirName(tab.path) : null,
      })
      if (!html) return
      const res = await desktop.exportHTML(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(t('HTML 导出失败：\n') + (error as Error).message)
    } finally {
      exportInProgressRef.current = false
    }
  }, [generateExportHTML])

  const exportPDF = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content, true, {
        docDir: tab?.path ? dirName(tab.path) : null,
      })
      if (!html) return
      const res = await desktop.exportPDF(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(t('PDF 导出失败：\n') + (error as Error).message)
    } finally {
      exportInProgressRef.current = false
    }
  }, [generateExportHTML])

  const exportImage = useCallback(async () => {
    if (exportInProgressRef.current) return
    exportInProgressRef.current = true
    try {
      const { activeId: id } = stateRef.current
      if (!id) return
      const tab = stateRef.current.tabs.find((t) => t.id === id)
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content, true, {
        docDir: tab?.path ? dirName(tab.path) : null,
      })
      if (!html) return
      const res = await desktop.exportImage(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(t('图片导出失败：\n') + (error as Error).message)
    } finally {
      exportInProgressRef.current = false
    }
  }, [generateExportHTML])

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

      const res = await desktop.exportDocx(tab.content, docDir, tab.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(t('Word 导出失败：\n') + (error as Error).message)
    } finally {
      exportInProgressRef.current = false
    }
  }, [stateRef, setExportResultPath])

  return { exportHTML, exportPDF, exportImage, exportDocx }
}
