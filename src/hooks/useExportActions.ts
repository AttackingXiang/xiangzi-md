import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { desktop } from '../platform'
import { generateExportHTML } from '../features/export/generateExportHtml'
import { getLang } from '../lib/i18n'
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
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content)
      if (!html) return
      const res = await desktop.exportHTML(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'HTML export failed:\n' : 'HTML 导出失败：\n') +
          (error as Error).message,
      )
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
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content, true)
      if (!html) return
      const res = await desktop.exportPDF(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'PDF export failed:\n' : 'PDF 导出失败：\n') +
          (error as Error).message,
      )
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
      const html = await generateExportHTML(tab?.name ?? 'document', tab?.content, true)
      if (!html) return
      const res = await desktop.exportImage(html, tab?.name ?? 'document')
      if (res) setExportResultPath(res.path)
    } catch (error) {
      window.alert(
        (getLang() === 'en' ? 'Image export failed:\n' : '图片导出失败：\n') +
          (error as Error).message,
      )
    } finally {
      exportInProgressRef.current = false
    }
  }, [generateExportHTML])
  
  return { exportHTML, exportPDF, exportImage }
}
