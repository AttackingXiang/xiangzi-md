import { $prose, $view } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type {
  NodeView,
  NodeViewConstructor,
  EditorView as PMEditorView,
} from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark'
import { LanguageDescription } from '@codemirror/language'
import { languages as cmLanguages } from '@codemirror/language-data'
import { highlightCode, classHighlighter } from '@lezer/highlight'
import { renderMermaid } from './mermaidPreview'
import { t } from './i18n'

// ---------- theme ---------

let _theme: 'light' | 'dark' = 'light'
export function setCodeBlockTheme(theme: 'light' | 'dark'): void {
  _theme = theme
}

// ---------- language cache ----------

// null = no highlighter available, undefined = not loaded yet
const langCache = new Map<string, { parser: { parse(code: string): unknown } } | null>()

async function loadLanguage(
  name: string,
): Promise<{ parser: { parse(code: string): unknown } } | null> {
  if (langCache.has(name)) return langCache.get(name)!
  const desc = LanguageDescription.matchLanguageName(cmLanguages, name, true)
  if (!desc) {
    langCache.set(name, null)
    return null
  }
  try {
    const support = await desc.load()
    const lang = support.language as { parser: { parse(code: string): unknown } }
    langCache.set(name, lang)
    return lang
  } catch {
    langCache.set(name, null)
    return null
  }
}

// ---------- decoration spans ----------

interface Span {
  from: number
  to: number
  cls: string
}
// cache highlight spans per (language + content), cleared on language change
const spanCache = new Map<string, Span[]>()

function computeSpans(lang: { parser: { parse(code: string): unknown } }, code: string): Span[] {
  const tree = lang.parser.parse(code)
  const spans: Span[] = []
  let pos = 0
  highlightCode(
    code,
    tree as Parameters<typeof highlightCode>[1],
    classHighlighter,
    (text, classes) => {
      if (classes) spans.push({ from: pos, to: pos + text.length, cls: classes })
      pos += text.length
    },
    () => {
      pos++
    },
  )
  return spans
}

// ---------- ProseMirror highlight plugin ----------

const hlKey = new PluginKey<DecorationSet>('xmd-static-hl')

// reference to the active ProseMirror view so async language loads can re-dispatch
let _pmView: PMEditorView | null = null

function buildDecos(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'code_block') return
    const lang = (node.attrs.language as string) || ''
    if (!lang || lang === 'mermaid') return
    const code = node.textContent
    const key = `${lang}\0${code}`

    if (spanCache.has(key)) {
      for (const s of spanCache.get(key)!) {
        decos.push(Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, { class: s.cls }))
      }
      return
    }

    const cached = langCache.get(lang)
    if (cached === undefined) {
      // kick off async load; when done re-dispatch to rebuild decos
      void loadLanguage(lang).then((language) => {
        if (!language) return
        const spans = computeSpans(language, code)
        spanCache.set(key, spans)
        const view = _pmView
        if (!view || view.isDestroyed) return
        view.dispatch(view.state.tr.setMeta(hlKey, true))
      })
    } else if (cached !== null) {
      const spans = computeSpans(cached, code)
      spanCache.set(key, spans)
      for (const s of spans) {
        decos.push(Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, { class: s.cls }))
      }
    }
  })
  return DecorationSet.create(doc, decos)
}

export const codeHighlightPlugin = $prose(
  () =>
    new Plugin<DecorationSet>({
      key: hlKey,
      state: {
        init(_, { doc }) {
          return buildDecos(doc)
        },
        apply(tr, old, _, { doc }) {
          return tr.docChanged || tr.getMeta(hlKey) ? buildDecos(doc) : old
        },
      },
      props: {
        decorations(state) {
          return this.getState(state)
        },
      },
      view(pv) {
        _pmView = pv
        return {
          destroy() {
            if (_pmView === pv) _pmView = null
          },
        }
      },
    }),
)

// ---------- language auto-detection ----------
// Uses a scoring approach (similar to highlight.js): each language accumulates
// points based on how many of its distinctive patterns appear in the code.
// The highest-scoring language wins. This avoids the false-positive problem
// of first-match-wins when languages share common keywords.

export function autoDetectLanguage(code: string): string | null {
  const t = code.trim()
  if (!t) return null
  const first = t.split('\n')[0].trim()

  // ── Deterministic (shebang & unambiguous markers) ───────────────────────
  if (first.startsWith('#!')) {
    if (/python/.test(first)) return 'Python'
    if (/node|nodejs/.test(first)) return 'JavaScript'
    if (/deno|ts-node/.test(first)) return 'TypeScript'
    if (/ruby/.test(first)) return 'Ruby'
    if (/php/.test(first)) return 'PHP'
    if (/perl/.test(first)) return 'Perl'
    return 'Shell'
  }
  if (first.startsWith('<?xml')) return 'XML'
  if (/^<!DOCTYPE|^<html[\s>]/i.test(first)) return 'HTML'
  if (first.startsWith('<?php')) return 'PHP'
  if (/^FROM\s+\S/.test(first)) return 'Dockerfile'
  if (/^(SELECT|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s+(TABLE|DATABASE|INDEX)|DROP\s+(TABLE|DATABASE))\b/i.test(first))
    return 'SQL'
  if (/^[{[]/.test(first)) {
    try { JSON.parse(t); return 'JSON' } catch { /* not json */ }
  }
  if (first === '---') return 'YAML'

  // ── Scoring pass ────────────────────────────────────────────────────────
  const h = (rx: RegExp): number => (rx.test(t) ? 1 : 0)

  const scores: [string, number][] = [
    ['TypeScript',
      h(/\binterface\s+\w/) * 10 +
      h(/\benum\s+\w/) * 8 +
      h(/\btype\s+\w+\s*=/) * 8 +
      h(/:\s*(string|number|boolean|void|never|any|unknown)\b/) * 7 +
      h(/\bimport\s+type\b/) * 8 +
      h(/\bas\s+[A-Z]\w*/) * 5 +
      h(/<[A-Z]\w*>/) * 5 +
      h(/\bnull\s*\||\|\s*undefined/) * 6 +
      h(/\b(Readonly|Partial|Record|Pick|Omit|Required)</) * 6],
    ['JavaScript',
      h(/\brequire\s*\(['"]/) * 8 +
      h(/\bmodule\.exports\b/) * 9 +
      h(/\bconsole\.(log|error|warn|info)\b/) * 5 +
      h(/=>\s*[\w({]/) * 4 +
      h(/\bPromise\.(then|catch|all|race)\b/) * 5 +
      h(/\bimport\s+.+\s+from\s+['"]/) * 5 +
      h(/\bexport\s+(default|function|class|const)\b/) * 5 +
      h(/document\.(getElementById|querySelector|addEventListener)/) * 7 +
      h(/\bJSON\.(parse|stringify)\b/) * 5 +
      h(/\bwindow\.\w/) * 5],
    ['Python',
      h(/\bdef\s+\w+\s*\(/) * 8 +
      h(/\bclass\s+\w+.*:/) * 7 +
      h(/\belif\b/) * 9 +
      h(/\bTrue\b|\bFalse\b|\bNone\b/) * 6 +
      h(/\bfrom\s+\w[\w.]*\s+import\b/) * 8 +
      h(/\bself\b/) * 6 +
      h(/\bprint\s*\(/) * 4 +
      h(/^\s*@\w+/m) * 6 +
      h(/\bif\s+__name__\s*==/) * 10 +
      h(/"""/) * 4 +
      h(/\blambda\s+\w/) * 6 +
      h(/\byield\b/) * 5],
    ['Go',
      h(/\bpackage\s+\w+/) * 7 +
      h(/\bfunc\s+\w+\s*\(/) * 7 +
      h(/:=/) * 10 +
      h(/\bimport\s+\(/) * 9 +
      h(/\bfmt\./) * 7 +
      h(/\berr\s*!=\s*nil/) * 10 +
      h(/\bgo\s+func\b/) * 9 +
      h(/\bchan\s+/) * 8 +
      h(/\bdefer\s+/) * 6],
    ['Rust',
      h(/\bfn\s+\w+\s*\(/) * 7 +
      h(/\blet\s+mut\b/) * 10 +
      h(/\bimpl\s+\w/) * 7 +
      h(/\buse\s+std::/) * 10 +
      h(/\bpub\s+fn\b/) * 7 +
      h(/println!\s*\(/) * 9 +
      h(/\bvec!\[/) * 8 +
      h(/\b(Option|Result)</) * 6 +
      h(/#\[derive\(/) * 8 +
      h(/\bunsafe\s*\{/) * 7],
    ['Java',
      h(/\bpublic\s+(static\s+)?class\s+\w/) * 9 +
      h(/\bpublic\s+static\s+void\s+main\b/) * 10 +
      h(/\bSystem\.out\.\w+\b/) * 8 +
      h(/\bimport\s+java\./) * 10 +
      h(/@Override\b/) * 7 +
      h(/@(Autowired|Component|Service|Repository|Controller)\b/) * 8 +
      h(/\bString\[\]\s+args/) * 9 +
      h(/\bthrows\s+\w+Exception\b/) * 7],
    ['Kotlin',
      h(/\bfun\s+\w+\s*\(/) * 9 +
      h(/\bdata\s+class\s+/) * 10 +
      h(/\bcompanion\s+object\b/) * 10 +
      h(/\bwhen\s*\(/) * 7 +
      h(/\bimport\s+kotlin\./) * 9 +
      h(/\?\.\w+/) * 6 +
      h(/\bval\s+\w+\s*[:=]/) * 5 +
      h(/\bobject\s+\w+\s*[\{:]/) * 7],
    ['C#',
      h(/\busing\s+System\b/) * 10 +
      h(/\bnamespace\s+\w/) * 8 +
      h(/\bConsole\.(Write|WriteLine|ReadLine)\b/) * 9 +
      h(/\basync\s+Task\b/) * 9 +
      h(/\bforeach\s*\(/) * 5 +
      h(/\[(Serializable|DataContract|HttpGet|HttpPost)\]/) * 9 +
      h(/\.(Where|Select|ToList|FirstOrDefault)\(/) * 6 +
      h(/\bpartial\s+class\b/) * 8],
    ['C++',
      h(/#include\s*<(iostream|vector|string|map|algorithm|memory|stdexcept)>/) * 10 +
      h(/\bstd::/) * 9 +
      h(/\bcout\s*<</) * 10 +
      h(/\bcin\s*>>/) * 9 +
      h(/\btemplate\s*</) * 10 +
      h(/\bnullptr\b/) * 8 +
      h(/::\w+/) * 4 +
      h(/\bdelete\s+\w/) * 6],
    ['C',
      h(/#include\s*<(stdio|stdlib|string|math|time)\.h>/) * 10 +
      h(/\bprintf\s*\(/) * 9 +
      h(/\bscanf\s*\(/) * 8 +
      h(/\bmalloc\s*\(/) * 10 +
      h(/\bfree\s*\(/) * 7 +
      h(/#define\s+\w/) * 5 +
      h(/\bvoid\s*\*/) * 6 +
      h(/\bNULL\b/) * 5 +
      h(/\bsizeof\s*\(/) * 6],
    ['Shell',
      h(/\bif\s+\[{1,2}/) * 8 +
      h(/\bfi\b/) * 10 +
      h(/\bthen\b/) * 6 +
      h(/\bfor\s+\w+\s+in\b/) * 7 +
      h(/\becho\s+/) * 4 +
      h(/\bexport\s+\w+=/) * 8 +
      h(/\$\{?\w+\}?/) * 3 +
      h(/\|\s*(grep|awk|sed|cut|xargs)\b/) * 8 +
      h(/\bsudo\s+/) * 5 +
      h(/\bdone\b/) * 6],
    ['PHP',
      h(/\$\w+/) * 5 +
      h(/\becho\s+['"]/) * 6 +
      h(/->\w+\s*\(/) * 5 +
      h(/\bforeach\s*\(\$/) * 9 +
      h(/\bpublic\s+function\b/) * 6 +
      h(/\b__(construct|destruct|toString)\b/) * 8 +
      h(/\bnew\s+\w+\s*\(/) * 3 +
      h(/\barray\s*\(/) * 4],
    ['Ruby',
      h(/\bdef\s+\w+/) * 7 +
      h(/\bend\b/) * 5 +
      h(/\bputs\s+/) * 9 +
      h(/\brequire\s+['"]/) * 6 +
      h(/\battr_(reader|writer|accessor)\b/) * 10 +
      h(/\.each\s*(\{|\bdo\b)/) * 7 +
      h(/@\w+/) * 4 +
      h(/\bnil\b/) * 6 +
      h(/\|\w+\|/) * 5],
    ['Swift',
      h(/\bimport\s+(Foundation|UIKit|SwiftUI|AppKit|Combine)\b/) * 10 +
      h(/\bguard\s+let\b/) * 10 +
      h(/\bif\s+let\b/) * 7 +
      h(/@objc\b|@IBOutlet\b|@IBAction\b|@State\b|@Binding\b/) * 10 +
      h(/\bprotocol\s+\w+/) * 7 +
      h(/\bextension\s+\w+/) * 6 +
      h(/\bfunc\s+\w+.*->/) * 6],
    ['CSS',
      h(/\b(color|background(-color)?|font-(size|family|weight)|margin|padding|display|flex|grid|border)\s*:/) * 8 +
      h(/:\s*(px|em|rem|vh|vw|%|auto|none|block|flex|grid|solid|transparent)\b/) * 6 +
      h(/\.[a-z][\w-]*\s*\{/) * 6 +
      h(/#[a-z][\w-]+\s*\{/) * 6 +
      h(/@media\s*\(/) * 9 +
      h(/\b(:hover|:focus|::before|::after)\b/) * 7],
    ['SCSS',
      h(/\$[\w-]+\s*:/) * 10 +
      h(/@(mixin|include|extend|function|each|for|if)\b/) * 9 +
      h(/&\s*(:|\.)/) * 8 +
      h(/\bdarken\s*\(|\blighten\s*\(/) * 8],
    ['YAML',
      h(/^[a-z_][\w-]*:\s*\S/m) * 6 +
      h(/^\s*-\s+\S/m) * 5 +
      h(/^---\s*$/m) * 8 +
      h(/&\w+|<<:\s*\*\w+/) * 9 +
      h(/^\s{2,}\w[\w-]*:\s/m) * 4],
    ['Markdown',
      h(/^#{1,6}\s+\S/m) * 8 +
      h(/^\s*[-*+]\s+\S/m) * 5 +
      h(/^\s*>\s+/m) * 5 +
      h(/\[.+\]\(.+\)/) * 6 +
      h(/^```\w*/m) * 9 +
      h(/!\[.*\]\(.*\)/) * 6],
    ['Scala',
      h(/\bobject\s+\w+/) * 7 +
      h(/\bcase\s+class\s+\w+/) * 10 +
      h(/\bimport\s+scala\./) * 10 +
      h(/\btraits?\s+\w+/) * 8 +
      h(/\bdef\s+\w+\s*[:=(]/) * 5],
    ['R',
      h(/<-\s*/) * 9 +
      h(/\bc\s*\(/) * 5 +
      h(/\blibrary\s*\(/) * 9 +
      h(/\bggplot\s*\(|\bdplyr\b|\btidyverse\b/) * 10 +
      h(/\bdata\.frame\s*\(/) * 9 +
      h(/\bprint\s*\(\w+\)/) * 3],
  ]

  const MIN = 8
  let best: string | null = null
  let bestScore = MIN - 1
  for (const [lang, score] of scores) {
    if (score > bestScore) { bestScore = score; best = lang }
  }

  // C vs C++: any C++ signal overrides a C-only match
  if (best === 'C') {
    const cppScore = scores.find(([l]) => l === 'C++')?.[1] ?? 0
    if (cppScore >= MIN) best = 'C++'
  }

  return best
}

// ---------- language list for picker ----------

interface LangEntry {
  name: string
  lower: string
}
const LANG_LIST: LangEntry[] = cmLanguages
  .map((d) => ({ name: d.name, lower: d.name.toLowerCase() }))
  .sort((a, b) => a.name.localeCompare(b.name))

// ---------- NodeView ----------

const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`
const CODE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`
const EYE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
const CHEVRON_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`

// singleton language picker panel (shared across all instances)
let pickerVisible = false

const AUTO_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`

class LanguagePicker {
  private readonly panel: HTMLElement
  private readonly input: HTMLInputElement
  private readonly autoBtn: HTMLButtonElement
  private readonly list: HTMLElement
  private onSelect: ((lang: string) => void) | null = null
  private getCode: (() => string) | null = null
  private filtered: LangEntry[] = LANG_LIST

  constructor() {
    this.panel = document.createElement('div')
    this.panel.className = 'xmd-lang-picker'

    // 搜索框行：input + 自动按钮
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

    // scroll active item into view
    const active = this.list.querySelector<HTMLElement>('.xmd-lang-item.active')
    if (active) active.scrollIntoView({ block: 'nearest' })

    requestAnimationFrame(() => this.input.focus())
    pickerVisible = true
  }

  private doAutoDetect(): void {
    const code = this.getCode?.() ?? ''
    const detected = autoDetectLanguage(code)
    if (detected) {
      this.onSelect?.(detected)
      this.hide()
    } else {
      // 未识别：高亮搜索框提示用户手动选
      this.input.focus()
      this.input.placeholder = t('未能识别，请手动选择')
      setTimeout(() => {
        this.input.placeholder = t('搜索语言…')
      }, 2000)
    }
  }

  hide(): void {
    this.panel.style.display = 'none'
    this.onSelect = null
    pickerVisible = false
  }

  private filterList(highlight?: string): void {
    const q = this.input.value.toLowerCase()
    this.filtered = q ? LANG_LIST.filter((l) => l.lower.includes(q)) : LANG_LIST
    this.list.innerHTML = ''
    for (const entry of this.filtered.slice(0, 80)) {
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
  // 防止在文档加载时触发自动检测：只有用户首次点击聚焦后才检测
  private _autoDetectArmed = false

  private readonly _view: PMEditorView
  private readonly _getPos: () => number | undefined

  constructor(node: PMNode, view: PMEditorView, getPos: () => number | undefined) {
    this._view = view
    this._getPos = getPos
    this.language = (node.attrs.language as string) || ''
    this.content = node.textContent

    // outer wrapper
    this.dom = document.createElement('div')
    this.dom.className = 'xmd-code-block'

    // 首次点击聚焦时，若无语言则自动检测
    this.dom.addEventListener(
      'focusin',
      () => {
        if (!this._autoDetectArmed) {
          this._autoDetectArmed = true
          return // 第一次 focus 是文档加载后的初始化，不触发
        }
        if (!this.language && this.content.trim()) {
          const detected = autoDetectLanguage(this.content)
          if (detected) this.setLanguage(detected)
        }
      },
      { once: false },
    )
    // 第一次用户主动点击才算"armed"
    this.dom.addEventListener(
      'pointerdown',
      () => {
        this._autoDetectArmed = true
      },
      { once: true },
    )

    // header row
    const header = document.createElement('div')
    header.className = 'xmd-code-header'

    // language selector button (left side)
    this.langBtn = document.createElement('button')
    this.langBtn.className = 'xmd-lang-btn'
    this.langBtn.addEventListener('mousedown', (e) => e.preventDefault())
    this.langBtn.addEventListener('click', () => this.openPicker())
    header.appendChild(this.langBtn)
    this.updateLangLabel()

    // right-side buttons
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

    // code pre/code (contentDOM lives here)
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
    this.langBtn.innerHTML = `<span>${this.language || 'text'}</span>${CHEVRON_ICON}`
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
    const renderer = renderMermaid(_theme)
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

  private doCopy(): void {
    void navigator.clipboard.writeText(this.content).then(() => {
      this.copyBtn.innerHTML = CHECK_ICON
      setTimeout(() => {
        this.copyBtn.innerHTML = COPY_ICON
      }, 1400)
    })
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

    if (newLang === 'mermaid' && contentChanged) {
      this.renderMermaid(newContent)
    }
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
