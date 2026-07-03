import { $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { EditorView as PMEditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import { LanguageDescription } from '@codemirror/language'
import { languages as cmLanguages } from '@codemirror/language-data'
import { highlightCode, classHighlighter } from '@lezer/highlight'

// ---------- language loader ----------

type LangParser = { parser: { parse(code: string): unknown } }

// null = no highlighter available for this name, undefined = not yet attempted
const langCache = new Map<string, LangParser | null>()

export async function loadLanguage(name: string): Promise<LangParser | null> {
  if (langCache.has(name)) return langCache.get(name)!
  const desc = LanguageDescription.matchLanguageName(cmLanguages, name, true)
  if (!desc) {
    langCache.set(name, null)
    return null
  }
  try {
    const support = await desc.load()
    const lang = support.language as LangParser
    langCache.set(name, lang)
    return lang
  } catch {
    langCache.set(name, null)
    return null
  }
}

// ---------- span computation ----------

interface Span {
  from: number
  to: number
  cls: string
}

// Keyed by `${lang}\0${code}` — cleared automatically when language changes
const spanCache = new Map<string, Span[]>()

function computeSpans(lang: LangParser, code: string): Span[] {
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

// Module-level ref to the active PM view so async loads can trigger a re-dispatch
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
      for (const s of spanCache.get(key)!)
        decos.push(Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, { class: s.cls }))
      return
    }

    const cached = langCache.get(lang)
    if (cached === undefined) {
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
      for (const s of spans)
        decos.push(Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, { class: s.cls }))
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
