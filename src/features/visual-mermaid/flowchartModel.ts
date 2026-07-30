export type FlowDirection = 'TB' | 'TD' | 'BT' | 'LR' | 'RL'
export type FlowNodeShape = 'rectangle' | 'rounded' | 'stadium' | 'diamond' | 'circle'
export type FlowEdgeStyle = 'arrow' | 'line' | 'dotted' | 'thick'

export interface FlowPosition {
  x: number
  y: number
}

export interface FlowNodeModel {
  id: string
  label: string
  shape: FlowNodeShape
}

export interface FlowEdgeModel {
  id: string
  source: string
  target: string
  label: string
  style: FlowEdgeStyle
}

export interface FlowchartModel {
  declaration: 'flowchart' | 'graph'
  direction: FlowDirection
  nodes: FlowNodeModel[]
  edges: FlowEdgeModel[]
  positions: Record<string, FlowPosition>
  comments: string[]
}

export type FlowchartParseResult =
  | { ok: true; model: FlowchartModel }
  | { ok: false; reason: string }

interface ParsedNode {
  id: string
  label: string
  shape: FlowNodeShape
  explicit: boolean
  end: number
}

interface ParsedStatement {
  nodes: ParsedNode[]
  edges: Array<Omit<FlowEdgeModel, 'id'>>
}

const HEADER = /^(flowchart|graph)\s+(TB|TD|BT|LR|RL)\s*;?$/i
const NODE_ID = /^[A-Za-z_][A-Za-z0-9_-]*/
const LAYOUT_PREFIX = '%% xmd-layout:'
const EDGE_TOKENS: Array<{ token: string; style: FlowEdgeStyle }> = [
  { token: '-.->', style: 'dotted' },
  { token: '==>', style: 'thick' },
  { token: '-->', style: 'arrow' },
  { token: '---', style: 'line' },
]

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed.at(-1)
    if ((first === '"' || first === "'") && last === first) {
      return trimmed.slice(1, -1).split(`\\${first}`).join(first)
    }
  }
  return trimmed
}

function skipSpaces(source: string, start: number): number {
  let index = start
  while (index < source.length && /\s/.test(source[index])) index += 1
  return index
}

function parseNodeAt(source: string, start: number): ParsedNode | null {
  const from = skipSpaces(source, start)
  const idMatch = NODE_ID.exec(source.slice(from))
  if (!idMatch) return null
  const id = idMatch[0]
  let index = skipSpaces(source, from + id.length)
  const variants: Array<{
    opening: string
    closing: string
    shape: FlowNodeShape
  }> = [
    { opening: '([', closing: '])', shape: 'stadium' },
    { opening: '((', closing: '))', shape: 'circle' },
    { opening: '[', closing: ']', shape: 'rectangle' },
    { opening: '{', closing: '}', shape: 'diamond' },
    { opening: '(', closing: ')', shape: 'rounded' },
  ]
  const variant = variants.find(({ opening }) => source.startsWith(opening, index))
  if (!variant) {
    return { id, label: id, shape: 'rectangle', explicit: false, end: index }
  }
  const labelFrom = index + variant.opening.length
  const closingAt = source.indexOf(variant.closing, labelFrom)
  if (closingAt < 0) return null
  index = closingAt + variant.closing.length
  return {
    id,
    label: unquote(source.slice(labelFrom, closingAt)) || id,
    shape: variant.shape,
    explicit: true,
    end: index,
  }
}

function parseEdgeAt(
  source: string,
  start: number,
): { style: FlowEdgeStyle; label: string; end: number } | null {
  let index = skipSpaces(source, start)
  const token = EDGE_TOKENS.find((candidate) => source.startsWith(candidate.token, index))
  if (!token) return null
  index = skipSpaces(source, index + token.token.length)
  let label = ''
  if (source[index] === '|') {
    const closing = source.indexOf('|', index + 1)
    if (closing < 0) return null
    label = unquote(source.slice(index + 1, closing))
    index = closing + 1
  }
  return { style: token.style, label, end: index }
}

function parseStatement(source: string): ParsedStatement | null {
  const statement = source.trim().replace(/;$/, '').trim()
  const first = parseNodeAt(statement, 0)
  if (!first) return null
  const nodes = [first]
  const edges: ParsedStatement['edges'] = []
  let previous = first
  let index = skipSpaces(statement, first.end)
  while (index < statement.length) {
    const edge = parseEdgeAt(statement, index)
    if (!edge) return null
    const next = parseNodeAt(statement, edge.end)
    if (!next) return null
    edges.push({
      source: previous.id,
      target: next.id,
      label: edge.label,
      style: edge.style,
    })
    nodes.push(next)
    previous = next
    index = skipSpaces(statement, next.end)
  }
  return { nodes, edges }
}

function parsePositions(raw: string): Record<string, FlowPosition> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const positions: Record<string, FlowPosition> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (
        !Array.isArray(value) ||
        value.length !== 2 ||
        !Number.isFinite(value[0]) ||
        !Number.isFinite(value[1])
      ) {
        return null
      }
      positions[id] = { x: Number(value[0]), y: Number(value[1]) }
    }
    return positions
  } catch {
    return null
  }
}

export function parseFlowchart(source: string): FlowchartParseResult {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const headerIndex = lines.findIndex((line) => line.trim() && !line.trim().startsWith('%%'))
  const match = headerIndex >= 0 ? HEADER.exec(lines[headerIndex].trim()) : null
  if (!match) {
    return { ok: false, reason: '第一版仅支持 flowchart/graph 流程图。' }
  }

  const nodes = new Map<string, FlowNodeModel>()
  const edges: FlowEdgeModel[] = []
  const comments: string[] = []
  let positions: Record<string, FlowPosition> = {}

  for (let index = 0; index < lines.length; index += 1) {
    if (index === headerIndex) continue
    const line = lines[index].trim()
    if (!line) continue
    if (line.startsWith(LAYOUT_PREFIX)) {
      const parsed = parsePositions(line.slice(LAYOUT_PREFIX.length).trim())
      if (!parsed) {
        return { ok: false, reason: `第 ${index + 1} 行的可视化布局信息无效。` }
      }
      positions = parsed
      continue
    }
    if (line.startsWith('%%')) {
      comments.push(line)
      continue
    }
    const statement = parseStatement(line)
    if (!statement) {
      return {
        ok: false,
        reason: `第 ${index + 1} 行包含第一版暂不支持的 Mermaid 语法：${line}`,
      }
    }
    for (const parsed of statement.nodes) {
      const current = nodes.get(parsed.id)
      if (!current || parsed.explicit) {
        nodes.set(parsed.id, { id: parsed.id, label: parsed.label, shape: parsed.shape })
      }
    }
    for (const edge of statement.edges) {
      edges.push({ ...edge, id: `edge-${edges.length + 1}` })
    }
  }

  if (nodes.size === 0) return { ok: false, reason: '流程图中没有可编辑节点。' }
  const nodeIds = new Set(nodes.keys())
  positions = Object.fromEntries(Object.entries(positions).filter(([id]) => nodeIds.has(id)))
  return {
    ok: true,
    model: {
      declaration: match[1].toLowerCase() as 'flowchart' | 'graph',
      direction: match[2].toUpperCase() as FlowDirection,
      nodes: Array.from(nodes.values()),
      edges,
      positions,
      comments,
    },
  }
}

function safeLabel(label: string): string {
  return JSON.stringify(label.trim() || '节点')
}

function formatNode(node: FlowNodeModel): string {
  const label = safeLabel(node.label)
  switch (node.shape) {
    case 'rounded':
      return `${node.id}(${label})`
    case 'stadium':
      return `${node.id}([${label}])`
    case 'diamond':
      return `${node.id}{${label}}`
    case 'circle':
      return `${node.id}((${label}))`
    default:
      return `${node.id}[${label}]`
  }
}

const EDGE_SYNTAX: Record<FlowEdgeStyle, string> = {
  arrow: '-->',
  line: '---',
  dotted: '-.->',
  thick: '==>',
}

function layoutComment(positions: Record<string, FlowPosition>): string | null {
  const compact = Object.fromEntries(
    Object.entries(positions).map(([id, position]) => [
      id,
      [Math.round(position.x), Math.round(position.y)],
    ]),
  )
  return Object.keys(compact).length > 0 ? `${LAYOUT_PREFIX} ${JSON.stringify(compact)}` : null
}

export function serializeFlowchart(model: FlowchartModel): string {
  const lines = [`${model.declaration} ${model.direction}`]
  lines.push(...model.comments)
  const layout = layoutComment(model.positions)
  if (layout) lines.push(layout)
  if (model.comments.length > 0 || layout) lines.push('')
  for (const node of model.nodes) lines.push(`    ${formatNode(node)}`)
  if (model.edges.length > 0) lines.push('')
  for (const edge of model.edges) {
    const label = edge.label.trim().split('|').join('&#124;')
    const syntax = EDGE_SYNTAX[edge.style]
    lines.push(`    ${edge.source} ${syntax}${label ? `|${label}|` : ''} ${edge.target}`)
  }
  return lines.join('\n')
}
