import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { WidgetType } from '@codemirror/view'

/** GitHub/Obsidian-style alert kinds recognised at the start of a quote line. */
const CALLOUT_KINDS = new Set(['NOTE', 'TIP', 'WARNING', 'IMPORTANT', 'CAUTION'])

export interface CalloutStart {
  kind: string
  markerFrom: number
  markerTo: number
}

/** GitHub/Obsidian-style alert header at the start of a quote line, if any. */
export function calloutStartAtLine(state: EditorState, lineNumber: number): CalloutStart | null {
  const line = state.doc.line(lineNumber)
  const prefix = /^(?: {0,3}>[ \t]?)+/.exec(line.text)?.[0]
  if (!prefix) return null
  const match = /^\[!([A-Za-z]+)\][ \t]*/.exec(line.text.slice(prefix.length))
  if (!match) return null
  const kind = match[1].toUpperCase()
  if (!CALLOUT_KINDS.has(kind)) return null
  return {
    kind,
    markerFrom: line.from + prefix.length,
    markerTo: line.from + prefix.length + match[0].length,
  }
}

export class CalloutLabelWidget extends WidgetType {
  constructor(readonly kind: string) {
    super()
  }

  eq(other: CalloutLabelWidget): boolean {
    return other.kind === this.kind
  }

  toDOM(): HTMLElement {
    const label = document.createElement('span')
    label.className = `xmd-cm-callout-label xmd-cm-callout-${this.kind.toLowerCase()}`
    label.textContent = this.kind
    return label
  }

  ignoreEvent(): boolean {
    return false
  }
}

export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super()
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('span')
    element.className = `xmd-cm-task-checkbox${this.checked ? ' is-checked' : ''}`
    element.setAttribute('role', 'checkbox')
    element.setAttribute('aria-checked', String(this.checked))
    element.setAttribute('aria-label', this.checked ? '标记为未完成' : '标记为已完成')
    element.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (view.state.readOnly) return
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' },
      })
      view.focus()
    })
    return element
  }

  ignoreEvent(event: Event): boolean {
    return event.type === 'click'
  }
}

export class ListMarkerWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly depth: number,
    readonly task: boolean,
  ) {
    super()
  }

  eq(other: ListMarkerWidget): boolean {
    return other.label === this.label && other.depth === this.depth && other.task === this.task
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = `xmd-cm-list-marker${this.task ? ' is-task' : ''}`
    element.style.setProperty('--xmd-list-depth', String(this.depth))
    element.setAttribute('aria-hidden', 'true')
    element.textContent = this.label
    return element
  }
}

export class HorizontalRuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'xmd-cm-horizontal-rule-widget'
    element.setAttribute('role', 'separator')
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}
