import { useEffect, useRef } from 'react'
import type { CloseDecision, CloseReason } from '../components/UnsavedChangesDialog'
import { classifyExternalLink } from '../lib/externalLinks'
import { tabsAreClean } from '../lib/documentState'
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
                const targetIds = new Set(dirtyTabs.map((tab) => tab.id))
                // A user edit can land while a disk write is in flight. Do not
                // acknowledge quit until every requested tab is actually clean.
                if (!tabsAreClean(stateRef.current.tabs, targetIds)) return
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
    const confirmAndOpen = (url: string, description: string): void => {
      void desktop
        .confirm(
          `${t('是否在系统浏览器中打开此链接？')}\n\n${description}\n${url}`,
          t('打开外部链接'),
          t('打开'),
          t('取消'),
        )
        .then((confirmed) => {
          if (confirmed) return desktop.openExternal(url)
        })
    }

    const openHttpsLink = (href: string): void => {
      const decision = classifyExternalLink(href)
      if (decision.kind === 'blocked') {
        window.alert(t('出于安全原因，只能打开 HTTPS 外部链接。'))
        return
      }
      if (decision.kind === 'trusted') {
        void desktop.openExternal(decision.url)
        return
      }
      confirmAndOpen(decision.url, `${t('域名：')}${decision.hostname}`)
    }

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
      openHttpsLink(anchor.href)
    }

    const openCm6Link = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const detail = event.detail as { href?: unknown } | null
      if (typeof detail?.href !== 'string') return
      const href = detail.href.trim()
      if (/^https?:\/\//i.test(href)) {
        openHttpsLink(href)
        return
      }
      if (/^mailto:/i.test(href)) {
        if (/[\r\n]/.test(href)) return
        let normalized: URL
        try {
          normalized = new URL(href)
        } catch {
          return
        }
        if (normalized.protocol !== 'mailto:') return
        confirmAndOpen(normalized.href, normalized.pathname)
        return
      }
      // Anchors and relative Markdown paths remain application navigation.
      // Re-dispatch a narrower event instead of treating them as external URLs.
      if (href.startsWith('#') || !/^[a-z][a-z\d+.-]*:/i.test(href)) {
        document.dispatchEvent(
          new CustomEvent('xmd-relative-link', { bubbles: true, detail: { href } }),
        )
      }
    }
    document.addEventListener('click', openExternalLink)
    document.addEventListener('xmd-link-open', openCm6Link)
    return () => {
      document.removeEventListener('click', openExternalLink)
      document.removeEventListener('xmd-link-open', openCm6Link)
    }
  }, [])
}
