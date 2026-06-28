import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, type NodeType, type DenoisingStrengthData } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'

function DenoisingStrengthNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as DenoisingStrengthData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const pct = Math.round((data.strength ?? 0.8) * 100)

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 200, minHeight: 80, position: 'relative' }}>
      {props.selected && <NodeResizer minWidth={150} minHeight={60} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: '8px 10px', fontSize: 12, color: '#ccc' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            style={{ flex: 1, accentColor: def.color }}
            min={0}
            max={1}
            step={0.05}
            value={data.strength ?? 0.8}
            onChange={(e) => updateNodeData(props.id, { strength: parseFloat(e.target.value) } as Partial<DenoisingStrengthData>)}
          />
          <span style={{ fontSize: 14, fontWeight: 700, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="strength" style={{ top: '50%' }}>
        <div style={{ position: 'absolute', right: 14, top: -2, fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>Strength</div>
      </Handle>
    </div>
  )
}

export default memo(DenoisingStrengthNode)
