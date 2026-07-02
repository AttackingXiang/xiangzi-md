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
  const [customCssError, setCustomCssError] = useState(false)

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
    el?.remove()
    el = null
    setCustomCssError(false)
    if (!settings.customCssPath) {
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
        if (!cancelled) setCustomCssError(true)
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
      const favoriteLabels = { ...prev.favoriteLabels }
      if (has) delete favoriteLabels[p]
      void desktop
        .setSettings({ favorites, favoriteLabels })
        .catch((error: unknown) => console.error('Favorites persistence failed', error))
      return { ...prev, favorites, favoriteLabels }
    })
  }, [])

  const setFavoritesCollapsed = useCallback((favoritesCollapsed: boolean) => {
    setSettings((prev) => {
      if (!prev || prev.favoritesCollapsed === favoritesCollapsed) return prev
      void desktop
        .setSettings({ favoritesCollapsed })
        .catch((error: unknown) => console.error('Favorites state persistence failed', error))
      return { ...prev, favoritesCollapsed }
    })
  }, [])

  const setFavoriteLabel = useCallback((p: string, value: string) => {
    setSettings((prev) => {
      if (!prev || !prev.favorites.includes(p)) return prev
      const label = Array.from(value.trim()).slice(0, 80).join('')
      const favoriteLabels = { ...prev.favoriteLabels }
      if (label) favoriteLabels[p] = label
      else delete favoriteLabels[p]
      void desktop
        .setSettings({ favoriteLabels })
        .catch((error: unknown) => console.error('Favorite label persistence failed', error))
      return { ...prev, favoriteLabels }
    })
  }, [])

  return {
    settings,
    settingsReady,
    customCssError,
    saveSettings,
    pushRecentFile,
    pushRecentFolder,
    toggleFavorite,
    setFavoritesCollapsed,
    setFavoriteLabel,
  }
}
