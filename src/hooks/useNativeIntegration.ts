import { useEffect, useRef } from 'react'
import type { CloseDecision, CloseReason } from '../components/UnsavedChangesDialog'
import { classifyExternalLink } from '../lib/externalLinks'
import { t } from '../lib/i18n'
import { isShortcutAction, type ShortcutAction } from '../lib/shortcuts'
import { desktop } from '../platform'
import type { Tab } from '../types'

interface NativeIntegrationOptions {
  stateRef: { current: { tabs: Tab[]; activeId: string | null } }
  dispatchShortcut: (action: ShortcutAction) => void
  exportHTML: () => Promise<void>
  exportPDF: () => Promise<void>
  exportImage: () => Promise<void>
  exportDocx: () => Promise<void>
  importDocx: () => Promise<void>
  checkForUpdates: (manual?: boolean) => Promise<void>
  clearRuntimeDrafts: () => Promise<void>
  deleteDrafts: (ids: string[]) => Promise<void>
  requestCloseDecision: (tabs: Tab[], reason?: CloseReason) => Promise<CloseDecision>
  saveTab: (id: string) => Promise<boolean>
}

export function useNativeIntegration(options: NativeIntegrationOptions): void {
  const {
    stateRef,
    dispatchShortcut,
    exportHTML,
    exportPDF,
    exportImage,
    exportDocx,
    importDocx,
    checkForUpdates,
    clearRuntimeDrafts,
    deleteDrafts,
    requestCloseDecision,
    saveTab,
  } = options
  const quitPromptOpenRef = useRef(false)

  useEffect(
    () =>
      desktop.onMenuAction((action) => {
        if (isShortcutAction(action)) {
          dispatchShortcut(action)
          return
        }
        if (action === 'export-html') void exportHTML()
        else if (action === 'export-pdf') void exportPDF()
        else if (action === 'export-image') void exportImage()
        else if (action === 'export-docx') void exportDocx()
        else if (action === 'import-docx') void importDocx()
        else if (action === 'check-updates') void checkForUpdates(true)
        else if (action === 'query-dirty') {
          const dirtyTabs = stateRef.current.tabs.filter((tab) => tab.dirty)
          if (dirtyTabs.length === 0) {
            void clearRuntimeDrafts().finally(() => desktop.notifyQuitOk())
            return
          }
          if (quitPromptOpenRef.current) return
          quitPromptOpenRef.current = true
          void requestCloseDecision(dirtyTabs, 'quit')
            .then(async (decision) => {
              if (decision === 'cancel') return
              if (decision === 'save') {
                for (const tab of dirtyTabs) {
                  if (!(await saveTab(tab.id))) return
                }
              }
              await deleteDrafts(dirtyTabs.map((tab) => tab.id))
              desktop.notifyQuitOk()
            })
            .finally(() => {
              quitPromptOpenRef.current = false
            })
        }
      }),
    [
      checkForUpdates,
      clearRuntimeDrafts,
      deleteDrafts,
      dispatchShortcut,
      exportDocx,
      exportHTML,
      exportImage,
      exportPDF,
      importDocx,
      requestCloseDecision,
      saveTab,
      stateRef,
    ],
  )

  useEffect(() => {
    const openExternalLink = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
      if (!anchor) return
      // 用原始 href 属性判断协议：anchor.href 会被浏览器归一化解析，
      // 无法可靠区分 javascript:/data: 等危险协议与普通相对路径。
      const rawHref = anchor.getAttribute('href')
      if (!rawHref) return
      // 页内锚点（脚注跳转等）保持默认滚动行为，不拦截
      if (rawHref.startsWith('#')) return
      if (!/^https?:\/\//i.test(rawHref)) {
        // javascript:/data:/file: 等一切非 http(s) 协议一律拦截：
        // WKWebView 对未处理的锚点点击默认会执行 javascript: URL，必须 preventDefault
        event.preventDefault()
        return
      }
      event.preventDefault()
      const decision = classifyExternalLink(anchor.href)
      if (decision.kind === 'blocked') {
        window.alert(t('出于安全原因，只能打开 HTTPS 外部链接。'))
        return
      }
      if (decision.kind === 'trusted') {
        void desktop.openExternal(decision.url)
        return
      }
      void desktop
        .confirm(
          `${t('是否在系统浏览器中打开此链接？')}\n\n${t('域名：')}${decision.hostname}\n${decision.url}`,
          t('打开外部链接'),
          t('打开'),
          t('取消'),
        )
        .then((confirmed) => {
          if (confirmed) return desktop.openExternal(decision.url)
        })
    }
    document.addEventListener('click', openExternalLink)
    return () => document.removeEventListener('click', openExternalLink)
  }, [])
}
