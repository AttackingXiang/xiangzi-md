import { graphlib, layout } from '@dagrejs/dagre'
import type { FlowDirection, FlowEdgeModel, FlowNodeModel, FlowPosition } from './flowchartModel'

interface NodeDimensions {
  width: number
  height: number
}

function estimatedNodeDimensions(node: FlowNodeModel): NodeDimensions {
  const labelWidth = Math.max(50, Array.from(node.label).length * 14 + 34)
  if (node.shape === 'diamond') {
    const side = Math.max(110, Math.ceil(labelWidth * 0.82))
    return { width: side, height: side }
  }
  if (node.shape === 'circle') {
    const diameter = Math.max(86, labelWidth)
    return { width: diameter, height: diameter }
  }
  return {
    width: Math.max(node.shape === 'stadium' ? 148 : 132, labelWidth),
    height: 54,
  }
}

/** Dagre is also Mermaid flowchart's default layout family, so cycles and branches keep the same semantics. */
export function dagreFlowchartPositions(
  nodes: readonly FlowNodeModel[],
  edges: readonly FlowEdgeModel[],
  direction: FlowDirection,
): Record<string, FlowPosition> {
  const graph = new graphlib.Graph({ directed: true, multigraph: true })
  graph.setGraph({
    rankdir: direction === 'TD' ? 'TB' : direction,
    ranker: 'network-simplex',
    nodesep: 55,
    edgesep: 24,
    ranksep: 78,
    marginx: 80,
    marginy: 70,
  })
  graph.setDefaultEdgeLabel(() => ({}))

  const dimensions = new Map<string, NodeDimensions>()
  for (const node of nodes) {
    const size = estimatedNodeDimensions(node)
    dimensions.set(node.id, size)
    graph.setNode(node.id, size)
  }
  for (const edge of edges) {
    if (!dimensions.has(edge.source) || !dimensions.has(edge.target)) continue
    graph.setEdge(edge.source, edge.target, {}, edge.id)
  }
  layout(graph)

  return Object.fromEntries(
    nodes.map((node) => {
      const size = dimensions.get(node.id) ?? { width: 132, height: 54 }
      const point = graph.node(node.id)
      return [
        node.id,
        {
          x: Math.round(point.x - size.width / 2),
          y: Math.round(point.y - size.height / 2),
        },
      ]
    }),
  )
}
