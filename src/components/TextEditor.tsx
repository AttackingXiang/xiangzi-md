import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Undo2,
  Redo2,
  Search,
  WrapText,
  ChevronsDownUp,
  ChevronsUpDown,
  Braces,
  Minimize2,
  ExternalLink,
} from 'lucide-react'
import { EditorState, EditorSelection, Compartment, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  type ViewUpdate,
} from '@codemirror/view'
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
  undo,
  redo,
  addCursorAbove,
  addCursorBelow,
} from '@codemirror/commands'
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
  selectNextOccurrence,
  openSearchPanel,
} from '@codemirror/search'
import {
  foldGutter,
  foldKeymap,
  foldAll,
  unfoldAll,
  indentOnInput,
  indentUnit,
  bracketMatching,
} from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { codeMirrorTheme } from '../lib/codeTheme'
import { resolveTextLanguage, isJsonFile, isFoldableFile } from '../lib/textLanguages'
import { unwrapText, wrapText, type TextEnvelope } from '../lib/textFidelity'
import { textEditorBridge } from '../lib/textEditorBridge'
import { getLang, t } from '../lib/i18n'

/** CodeMirror 搜索面板的中文文案（英文用其内置默认值，故只在中文时注入）。 */
const SEARCH_PHRASES_ZH: Record<string, string> = {
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  'by word': '全字匹配',
  regexp: '正则',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'current match': '当前匹配',
  'Go to line': '跳转到行',
  go: '跳转',
}

/** 光标/选区信息，供外部状态栏展示 */
export interface TextCursorInfo {
  line: number
  col: number
  /** 光标（选区）数量，>1 时状态栏提示多光标 */
  selections: number
  /** 选中字符总数，0 表示无选择 */
  selected: number
  /** 换行符，用于状态栏展示 LF / CRLF */
  eol: '\n' | '\r\n'
}

/** 需要跨标签切换保留的视图状态 */
export interface TextViewState {
  scrollTop: number
  /** EditorSelection.toJSON() 结果 */
  selection: unknown
}

interface Props {
  content: string
  fileName: string
  readOnly: boolean
  initialState?: TextViewState
  onStateChange?: (state: TextViewState) => void
  onCursorChange?: (info: TextCursorInfo) => void
  onChange: (raw: string) => void
  /** 用系统默认应用打开当前文件；未保存（无路径）时不传，按钮禁用 */
  onOpenWithDefaultApp?: () => void
}

function cursorInfo(state: EditorState, eol: '\n' | '\r\n'): TextCursorInfo {
  const main = state.selection.main
  const line = state.doc.lineAt(main.head)
  const selected = state.selection.ranges.reduce((sum, r) => sum + (r.to - r.from), 0)
  return {
    line: line.number,
    col: main.head - line.from + 1,
    selections: state.selection.ranges.length,
    selected,
    eol,
  }
}

/**
 * 纯文本 / 代码 / 结构化数据编辑器，基于 CodeMirror 6。与 Milkdown 完全隔离：
 * 不解析 Markdown、不显示文档属性面板。原文的 BOM 与换行由 textFidelity 保真，
 * 组件内部只跟 \n 归一化文本打交道。
 */
export default function TextEditor({
  content,
  fileName,
  readOnly,
  initialState,
  onStateChange,
  onCursorChange,
  onChange,
  onOpenWithDefaultApp,
}: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const envelopeRef = useRef<TextEnvelope>({ bom: false, eol: '\n' })

  // 稳定引用，供在编辑器生命周期回调里读取最新值
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange
  const onCursorChangeRef = useRef(onCursorChange)
  onCursorChangeRef.current = onCursorChange

  const [wrap, setWrap] = useState(() => resolveTextLanguage(fileName) === null)
  const isJson = isJsonFile(fileName)
  // 只有带折叠结构的语言（JSON/JS/TS/CSS/HTML/XML/YAML）才显示折叠 UI；纯文本、
  // TOML/INI/Shell、SQL 没有折叠范围，隐藏折叠栏与「折叠/展开全部」按钮。
  const foldable = isFoldableFile(fileName)

  const wrapCompartment = useRef(new Compartment())
  const languageCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())

  // ── 创建编辑器（仅挂载时一次；内容后续由 CodeMirror 内部维护） ──────────────
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    const unwrapped = unwrapText(content)
    envelopeRef.current = { bom: unwrapped.bom, eol: unwrapped.eol }

    const multiCursorKeymap = [
      { key: 'Mod-Alt-ArrowUp', run: addCursorAbove, preventDefault: true },
      { key: 'Mod-Alt-ArrowDown', run: addCursorBelow, preventDefault: true },
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
    ]

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      ...(foldable ? [foldGutter()] : []),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of('  '),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches(),
      search({ top: true }),
      ...(getLang() === 'zh' ? [EditorState.phrases.of(SEARCH_PHRASES_ZH)] : []),
      keymap.of([
        ...closeBracketsKeymap,
        ...multiCursorKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      codeMirrorTheme(),
      EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
      wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
      languageCompartment.current.of([]),
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          const raw = wrapText(envelopeRef.current, update.state.doc.toString())
          onChangeRef.current(raw)
        }
        if (update.docChanged || update.selectionSet) {
          onCursorChangeRef.current?.(cursorInfo(update.state, envelopeRef.current.eol))
        }
      }),
      EditorView.domEventHandlers({
        scroll: (_event, view) => {
          onStateChangeRef.current?.({
            scrollTop: view.scrollDOM.scrollTop,
            selection: view.state.selection.toJSON(),
          })
        },
      }),
    ]

    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: unwrapped.text, extensions }),
    })
    viewRef.current = view
    // 让全局 ⌘F / 查找命令能打开这个编辑器的搜索面板（见 App 对 textEditorBridge 的接线）。
    textEditorBridge.set(() => {
      openSearchPanel(view)
      view.focus()
    })

    // 恢复选区（越界时忽略）与滚动位置
    if (initialState?.selection) {
      try {
        const restored = EditorSelection.fromJSON(initialState.selection)
        const docLength = view.state.doc.length
        if (restored.ranges.every((range) => range.to <= docLength)) {
          view.dispatch({ selection: restored })
        }
      } catch {
        /* 选区格式不符或越界，保持默认 */
      }
    }
    onCursorChangeRef.current?.(cursorInfo(view.state, envelopeRef.current.eol))
    const scrollTop = initialState?.scrollTop ?? 0
    view.scrollDOM.scrollTop = scrollTop
    requestAnimationFrame(() => {
      if (viewRef.current === view) view.scrollDOM.scrollTop = scrollTop
    })

    return () => {
      // 卸载前若还有未提交的编辑，补交一次（与切标签同帧的输入）
      textEditorBridge.set(null)
      viewRef.current = null
      view.destroy()
    }
  }, [])

  // ── 异步加载语言支持 ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const lang = resolveTextLanguage(fileName)
    if (!lang) {
      viewRef.current?.dispatch({
        effects: languageCompartment.current.reconfigure([]),
      })
      return
    }
    void lang.load().then((extension) => {
      if (cancelled) return
      viewRef.current?.dispatch({
        effects: languageCompartment.current.reconfigure(extension),
      })
    })
    return () => {
      cancelled = true
    }
  }, [fileName])

  // ── 自动换行开关 ────────────────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  }, [wrap])

  // ── 只读切换 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly])

  const run = (fn: (view: EditorView) => void): void => {
    const view = viewRef.current
    if (!view) return
    fn(view)
    view.focus()
  }

  const formatJson = (compact: boolean): void => {
    const view = viewRef.current
    if (!view) return
    const source = view.state.doc.toString()
    try {
      const value: unknown = JSON.parse(source)
      const formatted = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: formatted },
      })
      view.focus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      void window.alert(`${t('JSON 解析失败')}: ${message}`)
    }
  }

  return (
    <div className="text-editor">
      <div className="text-editor-toolbar" role="toolbar">
        <button
          type="button"
          className="text-editor-btn"
          title={t('撤销')}
          disabled={readOnly}
          onClick={() => run(undo)}
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="text-editor-btn"
          title={t('重做')}
          disabled={readOnly}
          onClick={() => run(redo)}
        >
          <Redo2 size={16} />
        </button>
        <span className="text-editor-sep" />
        <button
          type="button"
          className="text-editor-btn"
          title={t('查找替换')}
          onClick={() => run(openSearchPanel)}
        >
          <Search size={16} />
        </button>
        <button
          type="button"
          className={`text-editor-btn${wrap ? ' active' : ''}`}
          title={t('自动换行')}
          aria-pressed={wrap}
          onClick={() => setWrap((v) => !v)}
        >
          <WrapText size={16} />
        </button>
        {foldable && (
          <>
            <span className="text-editor-sep" />
            <button
              type="button"
              className="text-editor-btn"
              title={t('折叠全部')}
              onClick={() => run(foldAll)}
            >
              <ChevronsDownUp size={16} />
            </button>
            <button
              type="button"
              className="text-editor-btn"
              title={t('展开全部')}
              onClick={() => run(unfoldAll)}
            >
              <ChevronsUpDown size={16} />
            </button>
          </>
        )}
        {isJson && (
          <>
            <span className="text-editor-sep" />
            <button
              type="button"
              className="text-editor-btn"
              title={t('格式化 JSON')}
              disabled={readOnly}
              onClick={() => formatJson(false)}
            >
              <Braces size={16} />
            </button>
            <button
              type="button"
              className="text-editor-btn"
              title={t('压缩 JSON')}
              disabled={readOnly}
              onClick={() => formatJson(true)}
            >
              <Minimize2 size={16} />
            </button>
          </>
        )}
        <span className="text-editor-spacer" />
        <button
          type="button"
          className="text-editor-btn"
          title={t('用默认应用打开')}
          disabled={!onOpenWithDefaultApp}
          onClick={() => onOpenWithDefaultApp?.()}
        >
          <ExternalLink size={16} />
        </button>
      </div>
      <div className="text-editor-host" ref={hostRef} />
    </div>
  )
}
