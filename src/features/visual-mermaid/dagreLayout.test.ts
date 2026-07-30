import { describe, expect, it } from 'vitest'
import { dagreFlowchartPositions } from './dagreLayout'
import type { FlowEdgeModel, FlowNodeModel } from './flowchartModel'

describe('dagreFlowchartPositions', () => {
  it('keeps a return loop as a branch instead of flattening every node into one row', () => {
    const nodes: FlowNodeModel[] = [
      { id: 'start', label: '开始', shape: 'stadium' },
      { id: 'submit', label: '提交资料', shape: 'rectangle' },
      { id: 'check', label: '资料是否完整', shape: 'diamond' },
      { id: 'approve', label: '进入审批', shape: 'rectangle' },
      { id: 'return', label: '退回补充', shape: 'rectangle' },
      { id: 'done', label: '完成', shape: 'stadium' },
    ]
    const pairs = [
      ['start', 'submit'],
      ['submit', 'check'],
      ['check', 'approve'],
      ['check', 'return'],
      ['return', 'submit'],
      ['approve', 'done'],
    ] as const
    const edges: FlowEdgeModel[] = pairs.map(([source, target], index) => ({
      id: `edge-${index}`,
      source,
      target,
      label: '',
      style: 'arrow',
    }))

    const positions = dagreFlowchartPositions(nodes, edges, 'LR')

    expect(positions.start.x).toBeLessThan(positions.submit.x)
    expect(positions.submit.x).toBeLessThan(positions.check.x)
    expect(new Set(Object.values(positions).map(({ y }) => y)).size).toBeGreaterThan(1)
    expect(positions.approve.y).not.toBe(positions.return.y)
    expect(positions.return.x).toBeGreaterThan(positions.check.x)
  })
})
