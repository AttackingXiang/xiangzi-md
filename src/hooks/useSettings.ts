import { useCallback, useEffect, useRef, useState } from 'react'
import { desktop } from '../platform'
import { setLang } from '../lib/i18n'
import { bytesToBlobUrl } from '../lib/backgroundImage'
import { applyThemeShade } from '../lib/themeShade'
import { applySearchFocusEffect } from '../lib/searchFocusEffect'
import { SettingsPersistenceQueue } from '../lib/settingsPersistence'
import { isPathAtOrUnder, replacePathPrefix, sameDocumentPath } from '../lib/pathIdentity'
import type { AppSettings, RecentDoc } from '../types'

/** frecency 语料库上限，与 Rust 端 MAX_RECENT_DOCS 保持一致。 */
const RECENT_DOCS_CAP = 100
/** 最近文件/文件夹的持久化上限；首页和「最近打开」面板都可滚动查看完整集合。 */
const RECENT_ITEMS_CAP = 100
/** 同一文件在此毫秒数内重复触发只刷新时间、不累加 openCount，避免切 tab 反复计数。 */
const OPEN_COUNT_COOLDOWN_MS = 60_000

/** 按最近打开时间倒序截断到上限，并派生出最近文件列表。 */
function normalizeRecentDocs(docs: RecentDoc[]): {
  recentDocs: RecentDoc[]
  recentFiles: string[]
} {
  const recentDocs = [...docs]
    .sort((a, b) => b.lastOpenedNanos - a.lastOpenedNanos)
    .slice(0, RECENT_DOCS_CAP)
  const recentFiles = recentDocs.slice(0, RECENT_ITEMS_CAP).map((doc) => doc.path)
  return { recentDocs, recentFiles }
}

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
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsSaveError, setSettingsSaveError] = useState(false)
  const [themeRenderVersion, setThemeRenderVersion] = useState(0)
  const backgroundImageUrlRef = useRef<string | null>(null)
  const settingsRevisionRef = useRef(0)
  const pendingUserSavesRef = useRef(0)
  const settingsPersistenceRef = useRef<SettingsPersistenceQueue<AppSettings> | null>(null)
  if (!settingsPersistenceRef.current) {
    settingsPersistenceRef.current = new SettingsPersistenceQueue((patch) =>
      desktop.setSettings(patch),
    )
  }

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
      setThemeRenderVersion((version) => version + 1)
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

  // ── 紧凑空行 ────────────────────────────────────────────────────────────────
  // 只切一个根属性，由 livePreview.css 决定分隔空行的行高。编辑器扩展无需重配置，
  // 所以开关是即时生效的，且关掉后完全退回默认行高。
  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.compactBlankLines = settings.compactBlankLines ? 'on' : 'off'
  }, [settings?.compactBlankLines])

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
    setThemeRenderVersion((version) => version + 1)
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
        setThemeRenderVersion((version) => version + 1)
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

  // Persisted settings identify intended search roots, but never grant access
  // by themselves. Re-establish the asset-protocol scope only when the native
  // persisted fs scope still proves that the user selected each directory.
  useEffect(() => {
    if (!settings) return
    for (const path of settings.assetSearchPaths) {
      void desktop.authorizeAssetSearchDirectory(path).catch(() => {})
    }
  }, [settings?.assetSearchPaths])

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

  // Search focus is a setting-backed theme contract. The editor reads these
  // variables when a match is selected, so changing the preset is immediate
  // and does not require rebuilding any CodeMirror extensions.
  useEffect(() => {
    if (!settings) return
    applySearchFocusEffect(settings.searchFocusEffect)
  }, [settings?.searchFocusEffect])

  // ── 主题深浅 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings) return
    applyThemeShade(settings.themeShade ?? 0)
    setThemeRenderVersion((version) => version + 1)
  }, [settings?.themeShade, settings?.theme])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const applyAuthoritativeSettings = useCallback((next: AppSettings): void => {
    setLang(next.language)
    setSettings(next)
  }, [])

  const restorePersistedSettings = useCallback(
    async (revision: number): Promise<void> => {
      try {
        const persisted = await desktop.getSettings()
        if (revision === settingsRevisionRef.current) applyAuthoritativeSettings(persisted)
      } catch {
        // Keep the optimistic value when the authoritative settings cannot be
        // read; the original write error is still reported by the caller.
      }
    },
    [applyAuthoritativeSettings],
  )

  const persistInBackground = useCallback(
    (patch: Partial<AppSettings>, context: string): void => {
      const revision = ++settingsRevisionRef.current
      void settingsPersistenceRef
        .current!.enqueue(patch)
        .then((next) => {
          if (revision === settingsRevisionRef.current) applyAuthoritativeSettings(next)
        })
        .catch((error: unknown) => {
          console.error(context, error)
          if (revision === settingsRevisionRef.current) void restorePersistedSettings(revision)
        })
    },
    [applyAuthoritativeSettings, restorePersistedSettings],
  )

  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>): Promise<AppSettings> => {
      const revision = ++settingsRevisionRef.current
      pendingUserSavesRef.current += 1
      setSettingsSaving(true)
      setSettingsSaveError(false)
      if (patch.language !== undefined) setLang(patch.language)
      setSettings((previous) => (previous ? { ...previous, ...patch } : previous))

      try {
        const next = await settingsPersistenceRef.current!.enqueue(patch)
        if (revision === settingsRevisionRef.current) applyAuthoritativeSettings(next)
        return next
      } catch (error) {
        if (revision === settingsRevisionRef.current) {
          setSettingsSaveError(true)
          await restorePersistedSettings(revision)
        }
        throw error
      } finally {
        pendingUserSavesRef.current -= 1
        if (pendingUserSavesRef.current === 0) setSettingsSaving(false)
      }
    },
    [applyAuthoritativeSettings, restorePersistedSettings],
  )

  // 记录一次「有效打开」：命中则刷新 lastOpened（冷却外才 +1 openCount），否则新建。
  // 同时重算 recentFiles 镜像并持久化。门控（停留够久/首次编辑）在 App 层，这里只落库。
  const recordDocOpen = useCallback(
    (p: string) => {
      const nowNanos = Date.now() * 1_000_000
      const cooldownNanos = OPEN_COUNT_COOLDOWN_MS * 1_000_000
      setSettings((prev) => {
        if (!prev) return prev
        const hit = prev.recentDocs.find((doc) => sameDocumentPath(doc.path, p))
        const next = hit
          ? prev.recentDocs.map((doc) =>
              sameDocumentPath(doc.path, p)
                ? {
                    ...doc,
                    openCount:
                      doc.openCount + (nowNanos - doc.lastOpenedNanos > cooldownNanos ? 1 : 0),
                    lastOpenedNanos: nowNanos,
                  }
                : doc,
            )
          : [
              { path: p, openCount: 1, lastOpenedNanos: nowNanos, lastEditedNanos: 0 },
              ...prev.recentDocs,
            ]
        const { recentDocs, recentFiles } = normalizeRecentDocs(next)
        persistInBackground({ recentDocs, recentFiles }, 'Recent docs persistence failed')
        return { ...prev, recentDocs, recentFiles }
      })
    },
    [persistInBackground],
  )

  // 记录一次编辑/保存：刷新 lastEdited（编辑是强信号，缺记录则连打开一起补上）。
  const recordDocEdit = useCallback(
    (p: string) => {
      const nowNanos = Date.now() * 1_000_000
      setSettings((prev) => {
        if (!prev) return prev
        const hit = prev.recentDocs.find((doc) => sameDocumentPath(doc.path, p))
        const next = hit
          ? prev.recentDocs.map((doc) =>
              sameDocumentPath(doc.path, p) ? { ...doc, lastEditedNanos: nowNanos } : doc,
            )
          : [
              {
                path: p,
                openCount: 1,
                lastOpenedNanos: nowNanos,
                lastEditedNanos: nowNanos,
              },
              ...prev.recentDocs,
            ]
        const { recentDocs, recentFiles } = normalizeRecentDocs(next)
        persistInBackground({ recentDocs, recentFiles }, 'Recent docs persistence failed')
        return { ...prev, recentDocs, recentFiles }
      })
    },
    [persistInBackground],
  )

  // 重命名/移动文件或文件夹后，改写 recentDocs 里命中的路径（含文件夹前缀下的所有后代）。
  const recordDocRename = useCallback(
    (oldPath: string, newPath: string) => {
      setSettings((prev) => {
        if (!prev) return prev
        let changed = false
        const remapped = prev.recentDocs.map((doc) => {
          if (!isPathAtOrUnder(doc.path, oldPath)) return doc
          changed = true
          return { ...doc, path: replacePathPrefix(doc.path, oldPath, newPath) }
        })
        if (!changed) return prev
        const { recentDocs, recentFiles } = normalizeRecentDocs(remapped)
        persistInBackground({ recentDocs, recentFiles }, 'Recent docs persistence failed')
        return { ...prev, recentDocs, recentFiles }
      })
    },
    [persistInBackground],
  )

  // 删除文件或文件夹后，移除 recentDocs 里该路径及其后代的记录。
  const recordDocRemove = useCallback(
    (p: string) => {
      setSettings((prev) => {
        if (!prev) return prev
        const kept = prev.recentDocs.filter((doc) => !isPathAtOrUnder(doc.path, p))
        if (kept.length === prev.recentDocs.length) return prev
        const { recentDocs, recentFiles } = normalizeRecentDocs(kept)
        persistInBackground({ recentDocs, recentFiles }, 'Recent docs persistence failed')
        return { ...prev, recentDocs, recentFiles }
      })
    },
    [persistInBackground],
  )

  const pushRecentFolder = useCallback(
    (p: string) => {
      setSettings((prev) => {
        if (!prev) return prev
        const recentFolders = [
          p,
          ...prev.recentFolders.filter((path) => !sameDocumentPath(path, p)),
        ].slice(0, RECENT_ITEMS_CAP)
        persistInBackground({ recentFolders }, 'Recent folders persistence failed')
        return { ...prev, recentFolders }
      })
    },
    [persistInBackground],
  )

  const toggleFavorite = useCallback(
    (p: string, isFile = false) => {
      setSettings((prev) => {
        if (!prev) return prev
        const existingFavorite = prev.favorites.find((path) => sameDocumentPath(path, p))
        const has = existingFavorite !== undefined
        const favorites = has
          ? prev.favorites.filter((path) => !sameDocumentPath(path, p))
          : [...prev.favorites, p]
        const currentFavoriteFiles = prev.favoriteFiles ?? []
        const favoriteFiles = has
          ? currentFavoriteFiles.filter((path) => !sameDocumentPath(path, p))
          : isFile
            ? [...currentFavoriteFiles.filter((path) => !sameDocumentPath(path, p)), p]
            : currentFavoriteFiles.filter((path) => !sameDocumentPath(path, p))
        const favoriteLabels = { ...prev.favoriteLabels }
        if (has) {
          for (const path of Object.keys(favoriteLabels)) {
            if (sameDocumentPath(path, existingFavorite)) delete favoriteLabels[path]
          }
        }
        persistInBackground(
          { favorites, favoriteFiles, favoriteLabels },
          'Favorites persistence failed',
        )
        return { ...prev, favorites, favoriteFiles, favoriteLabels }
      })
    },
    [persistInBackground],
  )

  const setFavoritesCollapsed = useCallback(
    (favoritesCollapsed: boolean) => {
      setSettings((prev) => {
        if (!prev || prev.favoritesCollapsed === favoritesCollapsed) return prev
        persistInBackground({ favoritesCollapsed }, 'Favorites state persistence failed')
        return { ...prev, favoritesCollapsed }
      })
    },
    [persistInBackground],
  )

  const togglePinnedFolder = useCallback(
    (path: string) => {
      setSettings((prev) => {
        if (!prev) return prev
        const current = prev.pinnedFolders ?? []
        const has = current.some((currentPath) => sameDocumentPath(currentPath, path))
        const pinnedFolders = has
          ? current.filter((currentPath) => !sameDocumentPath(currentPath, path))
          : [...current, path]
        persistInBackground({ pinnedFolders }, 'Pinned folders persistence failed')
        return { ...prev, pinnedFolders }
      })
    },
    [persistInBackground],
  )

  const togglePinnedTag = useCallback(
    (tagKey: string) => {
      setSettings((prev) => {
        if (!prev) return prev
        const current = prev.pinnedTags ?? []
        const has = current.includes(tagKey)
        const pinnedTags = has ? current.filter((x) => x !== tagKey) : [...current, tagKey]
        persistInBackground({ pinnedTags }, 'Pinned tags persistence failed')
        return { ...prev, pinnedTags }
      })
    },
    [persistInBackground],
  )

  // 折叠/展开某个标签分组，并把整份折叠集合持久化（含置顶区的 pin: 前缀 key）。
  const toggleTagCollapsed = useCallback(
    (key: string) => {
      setSettings((prev) => {
        if (!prev) return prev
        const current = prev.tagCollapsedKeys ?? []
        const has = current.includes(key)
        const tagCollapsedKeys = has ? current.filter((x) => x !== key) : [...current, key]
        persistInBackground({ tagCollapsedKeys }, 'Tag collapse persistence failed')
        return { ...prev, tagCollapsedKeys }
      })
    },
    [persistInBackground],
  )

  const setFavoriteLabel = useCallback(
    (p: string, value: string) => {
      setSettings((prev) => {
        if (!prev) return prev
        const favoritePath = prev.favorites.find((path) => sameDocumentPath(path, p))
        if (!favoritePath) return prev
        const label = Array.from(value.trim()).slice(0, 80).join('')
        const favoriteLabels = { ...prev.favoriteLabels }
        for (const path of Object.keys(favoriteLabels)) {
          if (sameDocumentPath(path, favoritePath)) delete favoriteLabels[path]
        }
        if (label) favoriteLabels[favoritePath] = label
        persistInBackground({ favoriteLabels }, 'Favorite label persistence failed')
        return { ...prev, favoriteLabels }
      })
    },
    [persistInBackground],
  )

  return {
    settings,
    settingsReady,
    themeRenderVersion,
    customCssError,
    backgroundImageError,
    settingsSaving,
    settingsSaveError,
    saveSettings,
    persistSettingsInBackground: persistInBackground,
    recordDocOpen,
    recordDocEdit,
    recordDocRename,
    recordDocRemove,
    pushRecentFolder,
    toggleFavorite,
    togglePinnedFolder,
    togglePinnedTag,
    toggleTagCollapsed,
    setFavoritesCollapsed,
    setFavoriteLabel,
  }
}
