import { memo, useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, type NodeType, type TextOutputData } from '../../types/nodes'
import NodeWrapper from './NodeWrapper'
import { useGraphStore } from '../../store/graph'

function TextOutputNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as TextOutputData
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)

  const text = useMemo(() => {
    const inEdges = edges.filter((e) => e.target === props.id && e.targetHandle === 'text_in')
    if (inEdges.length === 0) return data.text || ''
    const sourceNode = nodes.find((n) => n.id === inEdges[0].source)
    if (!sourceNode) return data.text || ''
    const sd = sourceNode.data as Record<string, unknown>
    if (typeof sd.result === 'string' && sd.result) return sd.result
    if (typeof sd.text === 'string' && sd.text) return sd.text
    return data.text || ''
  }, [nodes, edges, props.id, data.text])

  return (
    <NodeWrapper def={def} selected={props.selected    } handles={
      <>
        <Handle type="target" position={Position.Left} id="text_in" style={{ top: '50%', background: PORT_COLORS.prompt }}>
          <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Text</div>
        </Handle>
        <Handle type="source" position={Position.Right} id="text_out" style={{ top: '50%', background: PORT_COLORS.prompt }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Text</div>
        </Handle>
      </>
    }>
      <div
        className="nodrag"
        style={{ padding: '4px 6px', fontSize: 10, color: '#ccc', maxHeight: 200, overflowY: 'auto', userSelect: 'text', cursor: 'text' }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {text ? (
          <div style={{ fontSize: 10, lineHeight: 1.3, whiteSpace: 'pre-wrap', color: '#e0e0e0' }}>
            {text}
          </div>
        ) : (
          <span style={{ color: '#888', fontSize: 10 }}>Connect a text source to display output</span>
        )}
      </div>
    </NodeWrapper>
  )
}

export default memo(TextOutputNode)
