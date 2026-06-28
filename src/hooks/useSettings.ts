import { useCallback, useEffect, useState } from 'react'
import { desktop } from '../platform'
import { setLang } from '../lib/i18n'
import type { AppSettings } from '../types'

/**
 * Manages all app settings: load from disk, apply side effects (theme, width,
 * CSS, i18n) and expose mutation helpers. Single source of truth — no local
 * DEFAULT_SETTINGS constant needed in App.tsx.
 */
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)

  useEffect(() => {
    void desktop
      .getSettings()
      .then((s) => {
        setSettings(s)
        setSettingsReady(true)
      })
      .catch((error: unknown) => console.error('Settings loading failed', error))
  }, [])

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings) return undefined
    const apply = (): void => {
      const resolved =
        settings.theme === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : settings.theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
    return undefined
  }, [settings?.theme])

  // ── Editor width ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings) return
    const w =
      settings.editorWidth === 'full'
        ? '100%'
        : settings.editorWidth === 'wide'
          ? '1080px'
          : '820px'
    document.documentElement.style.setProperty('--editor-max-width', w)
  }, [settings?.editorWidth])

  // ── Heading numbering ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.headingNumber = settings.headingNumber ? 'on' : 'off'
  }, [settings?.headingNumber])

  // ── Language ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings) return
    setLang(settings.language)
  }, [settings?.language])

  // ── Custom CSS ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings) return undefined
    const id = 'custom-theme-style'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!settings.customCssPath) {
      el?.remove()
      return undefined
    }
    let cancelled = false
    desktop
      .readFile(settings.customCssPath)
      .then((res) => {
        if (cancelled) return
        if (!el) {
          el = document.createElement('style')
          el.id = id
          document.head.appendChild(el)
        }
        el.textContent = res.content
      })
      .catch(() => {
        /* file gone */
      })
    return () => {
      cancelled = true
    }
  }, [settings?.customCssPath])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveSettings = useCallback(async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const next = await desktop.setSettings(patch)
    setSettings(next)
    return next
  }, [])

  const pushRecentFile = useCallback((p: string) => {
    setSettings((prev) => {
      if (!prev) return prev
      const recentFiles = [p, ...prev.recentFiles.filter((x) => x !== p)].slice(0, 15)
      void desktop
        .setSettings({ recentFiles })
        .catch((error: unknown) => console.error('Recent files persistence failed', error))
      return { ...prev, recentFiles }
    })
  }, [])

  const pushRecentFolder = useCallback((p: string) => {
    setSettings((prev) => {
      if (!prev) return prev
      const recentFolders = [p, ...prev.recentFolders.filter((x) => x !== p)].slice(0, 15)
      void desktop
        .setSettings({ recentFolders })
        .catch((error: unknown) => console.error('Recent folders persistence failed', error))
      return { ...prev, recentFolders }
    })
  }, [])

  const toggleFavorite = useCallback((p: string) => {
    setSettings((prev) => {
      if (!prev) return prev
      const has = prev.favorites.includes(p)
      const favorites = has ? prev.favorites.filter((x) => x !== p) : [...prev.favorites, p]
      void desktop
        .setSettings({ favorites })
        .catch((error: unknown) => console.error('Favorites persistence failed', error))
      return { ...prev, favorites }
    })
  }, [])

  return {
    settings,
    settingsReady,
    saveSettings,
    pushRecentFile,
    pushRecentFolder,
    toggleFavorite,
  }
}
