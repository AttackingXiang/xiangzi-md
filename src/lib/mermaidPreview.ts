import type mermaid from 'mermaid'
import { t } from './i18n'

// 动态加载 mermaid（体积较大）：只有真正渲染图表时才加载，避免拖慢启动
type MermaidApi = typeof mermaid
let mermaidPromise: Promise<MermaidApi> | null = null
let currentMode: string | null = null

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/**
 * 用 mermaid 的 'base' 主题 + themeVariables 自定义配色，取代原先只能二选一
 * 的内置 'default'/'dark' 主题名——这样流程图配色跟随当前 [data-theme] 走
 * 一套统一的 CSS 变量，不需要为每个新增主题单独适配 mermaid。themeVariables
 * 只接受字面量颜色（mermaid 在 JS 侧拼 SVG 内联样式，不会再交给浏览器解析
 * var()），因此在这里用 getComputedStyle 把当前生效的 CSS 变量值读成字符串。
 *
 * 只覆盖 primaryColor/primaryBorderColor 等少数几个基础槛位，不手动指定
 * secondaryColor/tertiaryColor/clusterBkg 等——mermaid 的 base 主题会在
 * 这些槛位缺省时，用 khroma 从 primaryColor 自动做色相旋转推算出一整套
 * 协调但有区分度的颜色（子图、class/state 图的不同分类色块等）。此前把这
 * 些槛位全部手写成同一档灰色，等于抹掉了这套自动配色，导致所有节点/子图
 * 变成一片灰白、彼此不再区分。
 */
function mermaidThemeVariables(): Record<string, string> {
  const nodeBg = readCssVar('--diagram-node-bg', '#ececff')
  const nodeBorder = readCssVar('--diagram-node-border', '#9370db')
  const text = readCssVar('--text', '#1f2328')
  const lineColor = readCssVar('--text-2', '#57606a')
  const bg = readCssVar('--bg', '#ffffff')
  const invalid = readCssVar('--code-invalid', '#cf222e')
  return {
    background: 'transparent',
    primaryColor: nodeBg,
    primaryTextColor: text,
    primaryBorderColor: nodeBorder,
    lineColor,
    textColor: text,
    mainBkg: nodeBg,
    nodeBorder,
    edgeLabelBackground: bg,
    errorBkgColor: invalid,
    errorTextColor: invalid,
  }
}

/**
 * htmlLabels=false 用于导出/复制成图：屏幕预览用 foreignObject 排版更好，但
 * WebKit 把含 foreignObject 的 SVG 画上 canvas 会污染画布，无法转 PNG。
 * mermaid 的配置是全局的（%%{init}%% 指令对 htmlLabels 实测不生效），因此
 * 这里按「配色+标签模式」记忆当前配置，模式变化时重新 initialize。
 */
async function getMermaid(htmlLabels = true): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default)
  }
  const mermaid = await mermaidPromise
  const themeVariables = mermaidThemeVariables()
  const mode = `${String(htmlLabels)}|${JSON.stringify(themeVariables)}`
  if (currentMode !== mode) {
    // mermaid 11 起各图表的 htmlLabels 子配置已废弃，顶层 htmlLabels 优先生效
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables,
      securityLevel: 'strict',
      htmlLabels,
    })
    currentMode = mode
  }
  return mermaid
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

/**
 * 以「可栅格化」配置（htmlLabels:false，纯 <text> 标签、无 foreignObject）
 * 重新渲染 mermaid 源码，返回 SVG 字符串，专供复制/导出成图片。
 * 不影响屏幕预览：下一次预览渲染会按需切回 htmlLabels:true。
 */
export async function renderMermaidForExport(content: string): Promise<string> {
  const mermaid = await getMermaid(false)
  const id = 'mmdx-' + Math.random().toString(36).slice(2)
  const { svg } = await mermaid.render(id, content)
  return svg
}

/** Render an interactive screen preview using Mermaid's HTML label mode. */
export async function renderMermaidForPreview(content: string): Promise<string> {
  const mermaid = await getMermaid(true)
  const id = 'mmd-screen-' + Math.random().toString(36).slice(2)
  const { svg } = await mermaid.render(id, content)
  return svg
}

/**
 * 供 Crepe code-mirror 的 renderPreview 使用：mermaid 代码块异步渲染为图表。
 * 返回 undefined 表示异步，渲染完成后经 applyPreview 回填 SVG 字符串。
 */
export function renderMermaid() {
  return (
    language: string,
    content: string,
    applyPreview: (value: null | string | HTMLElement) => void,
  ): void | null => {
    if (!language || language.toLowerCase() !== 'mermaid') return null
    if (!content.trim()) return null

    const id = 'mmd-' + Math.random().toString(36).slice(2)
    void (async () => {
      try {
        const mermaid = await getMermaid()
        const { svg } = await mermaid.render(id, content)
        applyPreview(`<div class="mermaid-preview">${svg}</div>`)
      } catch (err: unknown) {
        const msg = escapeHtml(String((err as Error)?.message ?? err))
        applyPreview(`<div class="mermaid-error">${t('图表语法有误')}: ${msg}</div>`)
      }
    })()

    return undefined
  }
}
