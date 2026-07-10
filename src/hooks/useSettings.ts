import { useCallback, useEffect, useRef, useState } from 'react'
import { desktop } from '../platform'
import { setLang } from '../lib/i18n'
import { bytesToBlobUrl } from '../lib/backgroundImage'
import { applyThemeShade } from '../lib/themeShade'
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
  const [backgroundImageError, setBackgroundImageError] = useState(false)
  const backgroundImageUrlRef = useRef<string | null>(null)
  const languageSaveRevisionRef = useRef(0)

  useEffect(() => {
    void desktop
      .getSettings()
      .then((s) => {
        // i18n uses a small synchronous store. Update it before publishing the
        // settings state so the render triggered below already uses the saved
        // language (including on the initial app render).
        setLang(s.language)
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

  // ── 背景图片 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const clearBlobUrl = (): void => {
      if (backgroundImageUrlRef.current) {
        URL.revokeObjectURL(backgroundImageUrlRef.current)
        backgroundImageUrlRef.current = null
      }
    }
    if (!settings) return undefined
    setBackgroundImageError(false)
    if (!settings.backgroundImagePath) {
      clearBlobUrl()
      document.documentElement.style.removeProperty('--bg-image')
      return undefined
    }
    let cancelled = false
    const path = settings.backgroundImagePath
    void desktop
      .allowBackgroundImage(path)
      .catch(() => {})
      .then(() => desktop.readBinaryFile(path))
      .then((bytes) => {
        if (cancelled) return
        clearBlobUrl()
        const url = bytesToBlobUrl(bytes, path)
        backgroundImageUrlRef.current = url
        document.documentElement.style.setProperty('--bg-image', `url("${url}")`)
      })
      .catch(() => {
        if (!cancelled) setBackgroundImageError(true)
      })
    return () => {
      cancelled = true
    }
  }, [settings?.backgroundImagePath])

  // 图片本身用固定图层展示（见 foundation.css 的 body::before），这里额外算出
  // 一个 0-1 的无单位系数，供编辑器正文表面按同一强度变半透明，让图片透出来。
  useEffect(() => {
    if (!settings) return
    const shade = (settings.backgroundOpacity ?? 0) / 100
    document.documentElement.style.setProperty('--bg-image-shade', String(shade))
  }, [settings?.backgroundOpacity])

  // Code surfaces share one opacity token across the static renderer and
  // Milkdown/CodeMirror so appearance changes never drift between modes.
  useEffect(() => {
    if (!settings) return
    const opacity = Math.min(100, Math.max(0, settings.codeBlockOpacity ?? 30))
    document.documentElement.style.setProperty('--code-block-opacity', `${opacity}%`)
  }, [settings?.codeBlockOpacity])

  // ── 主题深浅 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings) return
    applyThemeShade(settings.themeShade ?? 0)
  }, [settings?.themeShade, settings?.theme])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveSettings = useCallback(async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const language = patch.language
    const languageRevision = language === undefined ? null : ++languageSaveRevisionRef.current

    if (language !== undefined) {
      // Apply language changes before persistence completes. Calling setLang
      // first is important: the state update causes the render, while setLang
      // itself intentionally does not have a React subscription.
      setLang(language)
      setSettings((previous) => (previous ? { ...previous, language } : previous))
    }

    try {
      const next = await desktop.setSettings(patch)
      if (languageRevision !== null && languageRevision !== languageSaveRevisionRef.current) {
        return next
      }
      setLang(next.language)
      setSettings(next)
      return next
    } catch (error) {
      if (languageRevision !== null && languageRevision === languageSaveRevisionRef.current) {
        // Restore the persisted value when an optimistic language update fails.
        // Reading it back also handles two rapid language changes where an
        // earlier request may have succeeded or failed independently.
        try {
          const persisted = await desktop.getSettings()
          if (languageRevision === languageSaveRevisionRef.current) {
            setLang(persisted.language)
            setSettings(persisted)
          }
        } catch {
          // Keep the optimistic value if the authoritative settings cannot be
          // read; the caller still receives and reports the original error.
        }
      }
      throw error
    }
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

  const toggleFavorite = useCallback((p: string, isFile = false) => {
    setSettings((prev) => {
      if (!prev) return prev
      const has = prev.favorites.includes(p)
      const favorites = has ? prev.favorites.filter((x) => x !== p) : [...prev.favorites, p]
      const currentFavoriteFiles = prev.favoriteFiles ?? []
      const favoriteFiles = has
        ? currentFavoriteFiles.filter((x) => x !== p)
        : isFile
          ? [...currentFavoriteFiles.filter((x) => x !== p), p]
          : currentFavoriteFiles.filter((x) => x !== p)
      const favoriteLabels = { ...prev.favoriteLabels }
      if (has) delete favoriteLabels[p]
      void desktop
        .setSettings({ favorites, favoriteFiles, favoriteLabels })
        .catch((error: unknown) => console.error('Favorites persistence failed', error))
      return { ...prev, favorites, favoriteFiles, favoriteLabels }
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

  const togglePinnedFolder = useCallback((path: string) => {
    setSettings((prev) => {
      if (!prev) return prev
      const current = prev.pinnedFolders ?? []
      const has = current.includes(path)
      const pinnedFolders = has ? current.filter((x) => x !== path) : [...current, path]
      void desktop
        .setSettings({ pinnedFolders })
        .catch((error: unknown) => console.error('Pinned folders persistence failed', error))
      return { ...prev, pinnedFolders }
    })
  }, [])

  const togglePinnedTag = useCallback((tagKey: string) => {
    setSettings((prev) => {
      if (!prev) return prev
      const current = prev.pinnedTags ?? []
      const has = current.includes(tagKey)
      const pinnedTags = has ? current.filter((x) => x !== tagKey) : [...current, tagKey]
      void desktop
        .setSettings({ pinnedTags })
        .catch((error: unknown) => console.error('Pinned tags persistence failed', error))
      return { ...prev, pinnedTags }
    })
  }, [])

  // 折叠/展开某个标签分组，并把整份折叠集合持久化（含置顶区的 pin: 前缀 key）。
  const toggleTagCollapsed = useCallback((key: string) => {
    setSettings((prev) => {
      if (!prev) return prev
      const current = prev.tagCollapsedKeys ?? []
      const has = current.includes(key)
      const tagCollapsedKeys = has ? current.filter((x) => x !== key) : [...current, key]
      void desktop
        .setSettings({ tagCollapsedKeys })
        .catch((error: unknown) => console.error('Tag collapse persistence failed', error))
      return { ...prev, tagCollapsedKeys }
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
    backgroundImageError,
    saveSettings,
    pushRecentFile,
    pushRecentFolder,
    toggleFavorite,
    togglePinnedFolder,
    togglePinnedTag,
    toggleTagCollapsed,
    setFavoritesCollapsed,
    setFavoriteLabel,
  }
}
