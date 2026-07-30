import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  reconnectEdge,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from '@xyflow/react'
import { CirclePlus, LayoutGrid, Trash2, X } from 'lucide-react'
import { useModalFocus } from '../../hooks/useModalFocus'
import {
  serializeFlowchart,
  type FlowchartModel,
  type FlowDirection,
  type FlowEdgeModel,
  type FlowEdgeStyle,
  type FlowNodeModel,
  type FlowNodeShape,
} from './flowchartModel'
import { dagreFlowchartPositions } from './dagreLayout'
import '@xyflow/react/dist/style.css'
import './visualFlowchartEditor.css'

interface FlowNodeData extends Record<string, unknown> {
  label: string
  shape: FlowNodeShape
  direction: FlowDirection
}

interface FlowEdgeData extends Record<string, unknown> {
  label: string
  style: FlowEdgeStyle
}

type EditorNode = Node<FlowNodeData>
type EditorEdge = Edge<FlowEdgeData>

export interface VisualFlowchartEditorProps {
  model: FlowchartModel
  onCancel: () => void
  onSave: (source: string) => Promise<void> | void
}

function handlePositions(direction: FlowDirection): { target: Position; source: Position } {
  if (direction === 'LR') return { target: Position.Left, source: Position.Right }
  if (direction === 'RL') return { target: Position.Right, source: Position.Left }
  if (direction === 'BT') return { target: Position.Bottom, source: Position.Top }
  return { target: Position.Top, source: Position.Bottom }
}

function FlowNode({ data, selected }: NodeProps<EditorNode>): JSX.Element {
  const handles = handlePositions(data.direction)
  return (
    <div className={`xmd-visual-flow-node shape-${data.shape}${selected ? ' is-selected' : ''}`}>
      <Handle type="target" position={handles.target} />
      <span>{data.label}</span>
      <Handle type="source" position={handles.source} />
    </div>
  )
}

const nodeTypes = { flow: FlowNode }

function layoutNodes(
  modelNodes: FlowNodeModel[],
  edges: FlowEdgeModel[],
  direction: FlowDirection,
): EditorNode[] {
  const positions = dagreFlowchartPositions(modelNodes, edges, direction)
  return modelNodes.map((node) => ({
    id: node.id,
    type: 'flow',
    position: positions[node.id] ?? { x: 80, y: 70 },
    data: { label: node.label, shape: node.shape, direction },
  }))
}

function initialNodes(model: FlowchartModel): EditorNode[] {
  const laidOut = layoutNodes(model.nodes, model.edges, model.direction)
  return laidOut.map((node) => ({
    ...node,
    position: model.positions[node.id] ?? node.position,
  }))
}

function edgePresentation(style: FlowEdgeStyle): Pick<EditorEdge, 'markerEnd' | 'style'> {
  if (style === 'line') return { markerEnd: undefined, style: { strokeWidth: 1.5 } }
  if (style === 'dotted') {
    return {
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeDasharray: '6 5', strokeWidth: 1.5 },
    }
  }
  if (style === 'thick') {
    return { markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 3 } }
  }
  return { markerEnd: { type: MarkerType.ArrowClosed }, style: { strokeWidth: 1.5 } }
}

function toEditorEdge(edge: FlowEdgeModel): EditorEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label || undefined,
    data: { label: edge.label, style: edge.style },
    ...edgePresentation(edge.style),
  }
}

function nextNodeId(nodes: readonly EditorNode[]): string {
  const used = new Set(nodes.map((node) => node.id))
  let index = nodes.length + 1
  while (used.has(`N${index}`)) index += 1
  return `N${index}`
}

export default function VisualFlowchartEditor({
  model,
  onCancel,
  onSave,
}: VisualFlowchartEditorProps): JSX.Element {
  const dialogRef = useModalFocus<HTMLElement>()
  const [direction, setDirection] = useState(model.direction)
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(initialNodes(model))
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorEdge>(model.edges.map(toEditorEdge))
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedEdge = edges.find((edge) => edge.id === selectedEdgeId) ?? null

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [onCancel])

  const onConnect = useCallback(
    (connection: Connection) => {
      const id = `edge-${crypto.randomUUID()}`
      setEdges((current) =>
        addEdge<EditorEdge>(
          {
            ...connection,
            id,
            data: { label: '', style: 'arrow' },
            ...edgePresentation('arrow'),
          },
          current,
        ),
      )
      setSelectedNodeId(null)
      setSelectedEdgeId(id)
    },
    [setEdges],
  )

  const onReconnect = useCallback(
    (oldEdge: EditorEdge, connection: Connection) => {
      setEdges((current) => reconnectEdge(oldEdge, connection, current))
    },
    [setEdges],
  )

  const addNode = (): void => {
    const id = nextNodeId(nodes)
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'flow',
        position: { x: 100 + current.length * 24, y: 90 + current.length * 20 },
        data: { label: '新节点', shape: 'rectangle', direction },
      },
    ])
    setSelectedEdgeId(null)
    setSelectedNodeId(id)
  }

  const updateNode = (patch: Partial<Pick<FlowNodeData, 'label' | 'shape'>>): void => {
    if (!selectedNodeId) return
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
    )
  }

  const deleteNode = (): void => {
    if (!selectedNodeId) return
    setNodes((current) => current.filter((node) => node.id !== selectedNodeId))
    setEdges((current) =>
      current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
    )
    setSelectedNodeId(null)
  }

  const updateEdge = (patch: Partial<FlowEdgeData>): void => {
    if (!selectedEdgeId) return
    setEdges((current) =>
      current.map((edge) => {
        if (edge.id !== selectedEdgeId) return edge
        const data = { ...edge.data, ...patch } as FlowEdgeData
        return {
          ...edge,
          label: data.label || undefined,
          data,
          ...edgePresentation(data.style),
        }
      }),
    )
  }

  const deleteEdge = (): void => {
    if (!selectedEdgeId) return
    setEdges((current) => current.filter((edge) => edge.id !== selectedEdgeId))
    setSelectedEdgeId(null)
  }

  const relayout = (nextDirection = direction): void => {
    const modelNodes = nodes.map((node) => ({
      id: node.id,
      label: node.data.label,
      shape: node.data.shape,
    }))
    const modelEdges = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.data?.label ?? '',
      style: edge.data?.style ?? 'arrow',
    }))
    setNodes(layoutNodes(modelNodes, modelEdges, nextDirection))
  }

  const changeDirection = (next: FlowDirection): void => {
    setDirection(next)
    setNodes((current) =>
      current.map((node) => ({ ...node, data: { ...node.data, direction: next } })),
    )
  }

  const sourceModel = useMemo<FlowchartModel>(
    () => ({
      declaration: model.declaration,
      direction,
      comments: model.comments,
      nodes: nodes.map((node) => ({
        id: node.id,
        label: node.data.label,
        shape: node.data.shape,
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.data?.label ?? '',
        style: edge.data?.style ?? 'arrow',
      })),
      positions: Object.fromEntries(nodes.map((node) => [node.id, node.position])),
    }),
    [direction, edges, model.comments, model.declaration, nodes],
  )

  const save = async (): Promise<void> => {
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(serializeFlowchart(sourceModel))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  return (
    <div className="xmd-visual-flow-backdrop" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        className="xmd-visual-flow-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="xmd-visual-flow-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="xmd-visual-flow-header">
          <div>
            <div className="xmd-visual-flow-title-row">
              <h2 id="xmd-visual-flow-title">可视化编辑流程图</h2>
              <span>试用版</span>
            </div>
            <p>拖动节点调整编辑布局，从节点连接点拖出新连线；保存后自动生成 Mermaid。</p>
          </div>
          <button type="button" aria-label="关闭可视化流程图编辑器" onClick={onCancel}>
            <X size={18} />
          </button>
        </header>

        <div className="xmd-visual-flow-toolbar">
          <button type="button" onClick={addNode}>
            <CirclePlus size={16} />
            添加节点
          </button>
          <button type="button" onClick={() => relayout()}>
            <LayoutGrid size={16} />
            自动排列
          </button>
          <label>
            方向
            <select
              value={direction}
              onChange={(event) => changeDirection(event.target.value as FlowDirection)}
            >
              <option value="TD">从上到下（TD）</option>
              <option value="TB">从上到下（TB）</option>
              <option value="LR">从左到右</option>
              <option value="RL">从右到左</option>
              <option value="BT">从下到上</option>
            </select>
          </label>
          <span className="xmd-visual-flow-hint">双击节点可快速选中并在右侧修改</span>
        </div>

        <div className="xmd-visual-flow-workspace">
          <div className="xmd-visual-flow-canvas">
            <ReactFlow<EditorNode, EditorEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onNodeClick={(_, node) => {
                setSelectedEdgeId(null)
                setSelectedNodeId(node.id)
              }}
              onNodeDoubleClick={(_, node) => {
                setSelectedEdgeId(null)
                setSelectedNodeId(node.id)
              }}
              onEdgeClick={(_, edge) => {
                setSelectedNodeId(null)
                setSelectedEdgeId(edge.id)
              }}
              onPaneClick={() => {
                setSelectedNodeId(null)
                setSelectedEdgeId(null)
              }}
              fitView
              minZoom={0.25}
              maxZoom={2}
              deleteKeyCode={null}
            >
              <Background gap={20} size={1} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable />
            </ReactFlow>
          </div>

          <aside className="xmd-visual-flow-inspector" aria-label="图形属性">
            {selectedNode ? (
              <>
                <h3>节点属性</h3>
                <label>
                  节点 ID
                  <input value={selectedNode.id} disabled />
                </label>
                <label>
                  文字
                  <textarea
                    value={selectedNode.data.label}
                    rows={3}
                    onChange={(event) => updateNode({ label: event.target.value })}
                  />
                </label>
                <label>
                  形状
                  <select
                    value={selectedNode.data.shape}
                    onChange={(event) => updateNode({ shape: event.target.value as FlowNodeShape })}
                  >
                    <option value="rectangle">矩形</option>
                    <option value="rounded">圆角矩形</option>
                    <option value="stadium">起止节点</option>
                    <option value="diamond">判断节点</option>
                    <option value="circle">圆形</option>
                  </select>
                </label>
                <button type="button" className="danger" onClick={deleteNode}>
                  <Trash2 size={15} />
                  删除节点
                </button>
              </>
            ) : selectedEdge ? (
              <>
                <h3>连线属性</h3>
                <label>
                  文字
                  <input
                    value={selectedEdge.data?.label ?? ''}
                    placeholder="可选"
                    onChange={(event) => updateEdge({ label: event.target.value })}
                  />
                </label>
                <label>
                  样式
                  <select
                    value={selectedEdge.data?.style ?? 'arrow'}
                    onChange={(event) => updateEdge({ style: event.target.value as FlowEdgeStyle })}
                  >
                    <option value="arrow">箭头</option>
                    <option value="line">直线</option>
                    <option value="dotted">虚线箭头</option>
                    <option value="thick">粗箭头</option>
                  </select>
                </label>
                <button type="button" className="danger" onClick={deleteEdge}>
                  <Trash2 size={15} />
                  删除连线
                </button>
              </>
            ) : (
              <div className="xmd-visual-flow-empty-inspector">
                <h3>编辑提示</h3>
                <p>选择节点或连线后，可以在这里修改文字和样式。</p>
                <p>拖动节点只保存 Xiangzi MD 编辑布局；标准 Mermaid 仍会自动排版。</p>
              </div>
            )}
          </aside>
        </div>

        <footer className="xmd-visual-flow-footer">
          <div aria-live="polite">
            {saveError ?? '第一版暂不支持子图、classDef 和复杂 Mermaid 指令。'}
          </div>
          <button type="button" className="secondary" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? '正在保存…' : '保存到文档'}
          </button>
        </footer>
      </section>
    </div>
  )
}
