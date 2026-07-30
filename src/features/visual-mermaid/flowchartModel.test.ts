import { describe, expect, it } from 'vitest'
import { parseFlowchart, serializeFlowchart } from './flowchartModel'

describe('visual Mermaid flowchart model', () => {
  it('parses common AI-generated nodes, labels, shapes and chained edges', () => {
    const result = parseFlowchart(`flowchart LR
      Start([开始]) --> Input[提交资料] --> Check{资料完整}
      Check -->|是| Done((完成))
      Check -.->|否| Input`)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.direction).toBe('LR')
    expect(result.model.nodes).toEqual([
      { id: 'Start', label: '开始', shape: 'stadium' },
      { id: 'Input', label: '提交资料', shape: 'rectangle' },
      { id: 'Check', label: '资料完整', shape: 'diamond' },
      { id: 'Done', label: '完成', shape: 'circle' },
    ])
    expect(
      result.model.edges.map(({ source, target, label, style }) => ({
        source,
        target,
        label,
        style,
      })),
    ).toEqual([
      { source: 'Start', target: 'Input', label: '', style: 'arrow' },
      { source: 'Input', target: 'Check', label: '', style: 'arrow' },
      { source: 'Check', target: 'Done', label: '是', style: 'arrow' },
      { source: 'Check', target: 'Input', label: '否', style: 'dotted' },
    ])
  })

  it('round-trips editor layout metadata without exposing it as a node', () => {
    const result = parseFlowchart(`graph TD
%% xmd-layout: {"A":[12,34],"B":[56,78]}
A[One] --> B(Two)`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.model.positions).toEqual({ A: { x: 12, y: 34 }, B: { x: 56, y: 78 } })

    const serialized = serializeFlowchart(result.model)
    expect(serialized).toContain('%% xmd-layout: {"A":[12,34],"B":[56,78]}')
    expect(parseFlowchart(serialized).ok).toBe(true)
  })

  it('normalizes editable source to standard Mermaid syntax', () => {
    const result = parseFlowchart('flowchart TD\nA[Start] -->|go| B(End)')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    result.model.nodes[0].label = '开始'
    result.model.edges[0].label = '继续'
    expect(serializeFlowchart(result.model)).toContain('A["开始"]')
    expect(serializeFlowchart(result.model)).toContain('A -->|继续| B')
  })

  it('round-trips edge labels containing a pipe character', () => {
    const result = parseFlowchart('flowchart TD\nA[Start] --> B(End)')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    result.model.edges[0].label = 'a|b'

    const serialized = serializeFlowchart(result.model)
    const reparsed = parseFlowchart(serialized)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.model.edges[0].label).toBe('a|b')
  })

  it('round-trips node labels containing backslashes and newlines', () => {
    const result = parseFlowchart('flowchart TD\nA[Start] --> B(End)')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    result.model.nodes[0].label = 'C:\\path\nnext line'

    const serialized = serializeFlowchart(result.model)
    const reparsed = parseFlowchart(serialized)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.model.nodes[0].label).toBe('C:\\path\nnext line')
  })

  it('rejects unsupported syntax instead of silently dropping it', () => {
    const result = parseFlowchart(`flowchart TD
      subgraph Group
        A --> B
      end
      classDef important fill:red`)
    expect(result).toEqual({
      ok: false,
      reason: '第 2 行包含第一版暂不支持的 Mermaid 语法：subgraph Group',
    })
  })

  it('rejects non-flowchart Mermaid diagrams', () => {
    expect(parseFlowchart('sequenceDiagram\nA->>B: Hello')).toEqual({
      ok: false,
      reason: '第一版仅支持 flowchart/graph 流程图。',
    })
  })
})
