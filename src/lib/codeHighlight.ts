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

// Languages currently awaiting a loadLanguage() resolution + pending re-decoration notify.
// Prevents scheduling one async callback + dispatch per code block during a bulk decorate pass.
const pendingNotify = new Set<string>()

function decorateBlock(node: PMNode, pos: number, out: Decoration[]): void {
  if (node.type.name !== 'code_block') return
  const lang = (node.attrs.language as string) || ''
  if (!lang || lang === 'mermaid') return
  const code = node.textContent
  const key = `${lang}\0${code}`

  if (spanCache.has(key)) {
    for (const s of spanCache.get(key)!)
      out.push(Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, { class: s.cls }))
    return
  }

  const cached = langCache.get(lang)
  if (cached === undefined) {
    if (!pendingNotify.has(lang)) {
      pendingNotify.add(lang)
      void loadLanguage(lang).then(() => {
        pendingNotify.delete(lang)
        const view = _pmView
        if (!view || view.isDestroyed) return
        view.dispatch(view.state.tr.setMeta(hlKey, { lang }))
      })
    }
  } else if (cached !== null) {
    const spans = computeSpans(cached, code)
    spanCache.set(key, spans)
    for (const s of spans)
      out.push(Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, { class: s.cls }))
  }
}

function buildDecos(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    decorateBlock(node, pos, decos)
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
          const meta = tr.getMeta(hlKey) as { lang: string } | undefined
          if (meta) {
            // A language finished loading. Re-decorate only that language's code blocks.
            // A bare meta transaction has no doc change, so positions in `old` remain valid.
            let set = old
            const add: Decoration[] = []
            const ranges: { from: number; to: number }[] = []
            doc.descendants((node, pos) => {
              if (node.type.name !== 'code_block') return
              if (((node.attrs.language as string) || '') !== meta.lang) return
              ranges.push({ from: pos, to: pos + node.nodeSize })
              decorateBlock(node, pos, add)
            })
            for (const r of ranges) set = set.remove(set.find(r.from, r.to))
            return set.add(doc, add)
          }
          if (!tr.docChanged) return old

          let set = old.map(tr.mapping, tr.doc)

          let changeFrom = Infinity
          let changeTo = -Infinity
          tr.mapping.maps.forEach((stepMap, i) => {
            stepMap.forEach((_os, _oe, ns, ne) => {
              const rest = tr.mapping.slice(i + 1)
              changeFrom = Math.min(changeFrom, rest.map(ns, -1))
              changeTo = Math.max(changeTo, rest.map(ne, 1))
            })
          })
          if (changeTo < changeFrom) return set

          changeFrom = Math.max(0, Math.min(changeFrom, doc.content.size))
          changeTo = Math.max(0, Math.min(changeTo, doc.content.size))

          let expandFrom = changeFrom
          let expandTo = changeTo
          doc.nodesBetween(changeFrom, changeTo, (node, pos) => {
            if (node.type.name !== 'code_block') return
            expandFrom = Math.min(expandFrom, pos)
            expandTo = Math.max(expandTo, pos + node.nodeSize)
          })
          expandFrom = Math.max(0, Math.min(expandFrom, doc.content.size))
          expandTo = Math.max(0, Math.min(expandTo, doc.content.size))

          set = set.remove(set.find(expandFrom, expandTo))

          const rebuilt: Decoration[] = []
          doc.nodesBetween(expandFrom, expandTo, (node, pos) => {
            decorateBlock(node, pos, rebuilt)
          })
          set = set.add(doc, rebuilt)

          return set
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
