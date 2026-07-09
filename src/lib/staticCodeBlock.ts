import { $view } from '@milkdown/kit/utils'
import type {
  NodeView,
  NodeViewConstructor,
  EditorView as PMEditorView,
} from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { languages as cmLanguages } from '@codemirror/language-data'
import { desktop } from '../platform'
import { renderMermaid, renderMermaidForExport } from './mermaidPreview'
import { copySvgMarkupAsImage } from './richClipboard'
import { getMermaidCopyMode } from './copyPreferences'
import { t } from './i18n'
import { autoDetectLanguage } from './languageDetection'

// ---------- language list for picker ----------

interface LangEntry {
  name: string
  lower: string
}
const LANG_LIST: LangEntry[] = cmLanguages
  .map((d) => ({ name: d.name, lower: d.name.toLowerCase() }))
  .sort((a, b) => a.name.localeCompare(b.name))

// ---------- SVG icons ----------

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
const CODE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
const EYE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
const CHEVRON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`
const AUTO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`

// ---------- LanguagePicker ----------

// Singleton panel shared across all code block instances
let pickerVisible = false

class LanguagePicker {
  private readonly panel: HTMLElement
  private readonly input: HTMLInputElement
  private readonly autoBtn: HTMLButtonElement
  private readonly list: HTMLElement
  private onSelect: ((lang: string) => void) | null = null
  private getCode: (() => string) | null = null

  constructor() {
    this.panel = document.createElement('div')
    this.panel.className = 'xmd-lang-picker'

    const searchRow = document.createElement('div')
    searchRow.className = 'xmd-lang-search-row'

    this.input = document.createElement('input')
    this.input.className = 'xmd-lang-search'
    this.input.placeholder = t('搜索语言…')
    this.input.addEventListener('input', () => this.filterList())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide()
    })
    searchRow.appendChild(this.input)

    this.autoBtn = document.createElement('button')
    this.autoBtn.className = 'xmd-lang-auto-btn'
    this.autoBtn.title = t('自动检测语言')
    this.autoBtn.innerHTML = AUTO_ICON + `<span>${t('自动')}</span>`
    this.autoBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.autoBtn.addEventListener('click', () => this.doAutoDetect())
    searchRow.appendChild(this.autoBtn)

    this.panel.appendChild(searchRow)

    this.list = document.createElement('ul')
    this.list.className = 'xmd-lang-list'
    this.panel.appendChild(this.list)

    document.body.appendChild(this.panel)
    document.addEventListener('mousedown', this.onOutsideClick, true)
  }

  show(
    anchor: HTMLElement,
    currentLang: string,
    onSelect: (lang: string) => void,
    getCode: () => string,
  ): void {
    this.onSelect = onSelect
    this.getCode = getCode
    this.input.value = ''
    this.filterList(currentLang)

    const rect = anchor.getBoundingClientRect()
    this.panel.style.left = `${rect.left}px`
    this.panel.style.top = `${rect.bottom + 4}px`
    this.panel.style.display = 'block'

    const active = this.list.querySelector<HTMLElement>('.xmd-lang-item.active')
    if (active) active.scrollIntoView({ block: 'nearest' })

    requestAnimationFrame(() => this.input.focus())
    pickerVisible = true
  }

  hide(): void {
    this.panel.style.display = 'none'
    this.onSelect = null
    pickerVisible = false
  }

  private doAutoDetect(): void {
    const detected = autoDetectLanguage(this.getCode?.() ?? '')
    if (detected) {
      this.onSelect?.(detected)
      this.hide()
    } else {
      this.input.focus()
      this.input.placeholder = t('未能识别，请手动选择')
      setTimeout(() => {
        this.input.placeholder = t('搜索语言…')
      }, 2000)
    }
  }

  private filterList(highlight?: string): void {
    const q = this.input.value.toLowerCase()
    const filtered = q ? LANG_LIST.filter((l) => l.lower.includes(q)) : LANG_LIST
    this.list.innerHTML = ''
    for (const entry of filtered.slice(0, 80)) {
      const li = document.createElement('li')
      li.className = 'xmd-lang-item'
      li.textContent = entry.name
      if (entry.lower === (highlight ?? '').toLowerCase()) li.classList.add('active')
      li.addEventListener('mousedown', (e) => {
        e.preventDefault()
        this.onSelect?.(entry.name)
        this.hide()
      })
      this.list.appendChild(li)
    }
  }

  private readonly onOutsideClick = (e: MouseEvent): void => {
    if (this.panel.style.display === 'none') return
    if (!this.panel.contains(e.target as globalThis.Node)) this.hide()
  }

  destroy(): void {
    document.removeEventListener('mousedown', this.onOutsideClick, true)
    this.panel.remove()
    pickerVisible = false
  }
}

const picker = new LanguagePicker()

// ---------- StaticCodeBlockView ----------

class StaticCodeBlockView implements NodeView {
  readonly dom: HTMLElement
  readonly contentDOM: HTMLElement

  private readonly langBtn: HTMLButtonElement
  private readonly preEl: HTMLElement
  private readonly btnGroup: HTMLElement
  private mermaidEl: HTMLElement | null = null
  private toggleBtn: HTMLButtonElement | null = null
  private copyBtn: HTMLButtonElement

  private language: string
  private content: string
  private showPreview = true
  private mermaidSeq = 0
  // Armed after first user pointer-down; prevents auto-detect firing on document load
  private _autoDetectArmed = false

  private readonly _view: PMEditorView
  private readonly _getPos: () => number | undefined

  constructor(node: PMNode, view: PMEditorView, getPos: () => number | undefined) {
    this._view = view
    this._getPos = getPos
    this.language = (node.attrs.language as string) || ''
    this.content = node.textContent

    this.dom = document.createElement('div')
    this.dom.className = 'xmd-code-block'

    this.dom.addEventListener('focusin', () => {
      if (!this._autoDetectArmed) {
        this._autoDetectArmed = true
        return
      }
      if (!this.language && this.content.trim()) {
        const detected = autoDetectLanguage(this.content)
        if (detected) this.setLanguage(detected)
      }
    })
    this.dom.addEventListener(
      'pointerdown',
      () => {
        this._autoDetectArmed = true
      },
      { once: true },
    )

    // Header
    const header = document.createElement('div')
    header.className = 'xmd-code-header'

    this.langBtn = document.createElement('button')
    this.langBtn.className = 'xmd-lang-btn'
    this.langBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.langBtn.addEventListener('click', () => this.openPicker())
    header.appendChild(this.langBtn)
    this.updateLangLabel()

    this.btnGroup = document.createElement('div')
    this.btnGroup.className = 'xmd-code-btns'

    this.copyBtn = document.createElement('button')
    this.copyBtn.className = 'xmd-code-btn'
    this.copyBtn.title = t('复制')
    this.copyBtn.innerHTML = COPY_ICON
    this.copyBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.copyBtn.addEventListener('click', () => this.doCopy())
    this.btnGroup.appendChild(this.copyBtn)

    header.appendChild(this.btnGroup)
    this.dom.appendChild(header)

    this.preEl = document.createElement('pre')
    this.preEl.className = 'xmd-code-pre'
    const codeEl = document.createElement('code')
    codeEl.className = 'xmd-code-content'
    this.preEl.appendChild(codeEl)
    this.dom.appendChild(this.preEl)
    this.contentDOM = codeEl

    if (this.language === 'mermaid') this.initMermaid()
  }

  private updateLangLabel(): void {
    // 语言标签来自 markdown 围栏信息串（用户可控内容），禁止用 innerHTML 拼接，
    // 否则恶意文档可用 `<svg/onload=...>` 之类的围栏语言注入脚本。
    // 先用常量图标重置内容，再用 textContent 安全插入语言文本。
    this.langBtn.innerHTML = CHEVRON_ICON
    const span = document.createElement('span')
    span.textContent = this.language || 'text'
    this.langBtn.insertBefore(span, this.langBtn.firstChild)
  }

  private setLanguage(lang: string): void {
    const pos = this._getPos()
    if (pos === undefined) return
    this._view.dispatch(
      this._view.state.tr.setNodeMarkup(pos, undefined, {
        ...this._view.state.doc.nodeAt(pos)?.attrs,
        language: lang,
      }),
    )
  }

  private openPicker(): void {
    picker.show(
      this.langBtn,
      this.language,
      (lang) => this.setLanguage(lang),
      () => this.content,
    )
  }

  private initMermaid(): void {
    this.mermaidEl = document.createElement('div')
    this.mermaidEl.className = 'xmd-mermaid-preview'
    this.dom.insertBefore(this.mermaidEl, this.preEl)

    this.toggleBtn = document.createElement('button')
    this.toggleBtn.className = 'xmd-code-btn'
    this.toggleBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.toggleBtn.addEventListener('click', () => {
      this.showPreview = !this.showPreview
      this.applyMermaidVisibility()
    })
    this.btnGroup.insertBefore(this.toggleBtn, this.copyBtn)

    this.applyMermaidVisibility()
    this.renderMermaid(this.content)
  }

  private applyMermaidVisibility(): void {
    if (!this.mermaidEl || !this.toggleBtn) return
    if (this.showPreview) {
      this.mermaidEl.style.display = ''
      this.preEl.style.display = 'none'
      this.toggleBtn.title = t('切换源码')
      this.toggleBtn.innerHTML = CODE_ICON
    } else {
      this.mermaidEl.style.display = 'none'
      this.preEl.style.display = ''
      this.toggleBtn.title = t('切换预览')
      this.toggleBtn.innerHTML = EYE_ICON
    }
  }

  private renderMermaid(code: string): void {
    const seq = ++this.mermaidSeq
    if (!this.mermaidEl) return
    if (!code.trim()) {
      this.mermaidEl.innerHTML = ''
      return
    }
    const renderer = renderMermaid()
    renderer('mermaid', code, (result) => {
      if (this.mermaidSeq !== seq || !this.mermaidEl) return
      if (typeof result === 'string') {
        this.mermaidEl.innerHTML = result
      } else if (result instanceof HTMLElement) {
        this.mermaidEl.innerHTML = ''
        this.mermaidEl.appendChild(result)
      } else {
        this.mermaidEl.innerHTML = ''
      }
    })
  }

  private flashCopied(): void {
    this.copyBtn.innerHTML = CHECK_ICON
    setTimeout(() => {
      this.copyBtn.innerHTML = COPY_ICON
    }, 1400)
  }

  private copyTextFallback(): void {
    // Web Clipboard 的写入依赖「用户手势有效期」，若这次复制经过了异步栅格化
    // 再兜底到这里，手势可能已过期被拒（NotAllowedError）；此时改走 Tauri
    // 原生剪贴板通道，它不受手势时效限制。
    navigator.clipboard
      .writeText(this.content)
      .catch(() => desktop.writeClipboardText(this.content))
      .then(() => this.flashCopied())
      .catch((error: unknown) => console.error('复制源码失败', error))
  }

  /** Mermaid 图表处于预览态时复制渲染出的图片；否则（源码态、非图表代码块、或
   * 复制控制里选了「复制源文本」）复制文本源码。 */
  private doCopy(): void {
    if (
      this.language === 'mermaid' &&
      this.showPreview &&
      this.content.trim() &&
      getMermaidCopyMode() === 'image'
    ) {
      // 读当前生效的卡片底色（随 [data-theme] 走，不再按 light/dark 二选一），
      // 保证栅格化出的 PNG 背景和屏幕上看到的代码卡片一致。
      const background = getComputedStyle(document.documentElement)
        .getPropertyValue('--code-card-bg')
        .trim()
      // 屏幕预览的 SVG 含 foreignObject，无法栅格化（WebKit 会污染画布）；
      // 用 htmlLabels:false 重新渲染一份纯 SVG 专供转图，再写入剪贴板。
      renderMermaidForExport(this.content)
        .then((svgMarkup) => copySvgMarkupAsImage(svgMarkup, background || '#f7f7f7'))
        .then((ok) => {
          if (ok) this.flashCopied()
          else this.copyTextFallback()
        })
        .catch((error: unknown) => {
          // 渲染/栅格化任何一步失败都不能让复制按钮没反应：退回复制源码。
          console.error('复制图表图片失败，已退回复制源码', error)
          this.copyTextFallback()
        })
      return
    }
    this.copyTextFallback()
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'code_block') return false
    const newLang = (node.attrs.language as string) || ''
    const newContent = node.textContent
    const langChanged = newLang !== this.language
    const contentChanged = newContent !== this.content

    if (!langChanged && !contentChanged) return true

    this.language = newLang
    this.content = newContent

    if (langChanged) {
      this.updateLangLabel()
      if (newLang === 'mermaid' && !this.mermaidEl) this.initMermaid()
      if (newLang !== 'mermaid' && this.mermaidEl) {
        this.mermaidEl.remove()
        this.mermaidEl = null
        this.toggleBtn?.remove()
        this.toggleBtn = null
        this.preEl.style.display = ''
        this.showPreview = true
      }
    }

    if (newLang === 'mermaid' && contentChanged) this.renderMermaid(newContent)
    return true
  }

  destroy(): void {
    if (pickerVisible) picker.hide()
  }

  stopEvent(event: Event): boolean {
    if (!(event.target instanceof globalThis.Node)) return false
    return !this.contentDOM.contains(event.target)
  }

  ignoreMutation(record: Parameters<NonNullable<NodeView['ignoreMutation']>>[0]): boolean {
    if (record.type === 'selection') return false
    if (this.contentDOM.contains(record.target)) return false
    return true
  }
}

export const codeBlockView = $view(
  codeBlockSchema.node,
  (): NodeViewConstructor => (node, view, getPos) => new StaticCodeBlockView(node, view, getPos),
)
