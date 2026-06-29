import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type DenoisingStrengthData } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'

function DenoisingStrengthNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as DenoisingStrengthData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const pct = Math.round((data.strength ?? 0.8) * 100)

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, position: 'relative' }}>
      {props.selected && <NodeResizer handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
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
      <Handle type="source" position={Position.Right} id="strength" style={{ top: '50%', background: getHandleColor('strength', 'params') }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: getHandleColor('strength', 'params'), whiteSpace: 'nowrap' }}>Strength</div>
      </Handle>
    </div>
  )
}

export default memo(DenoisingStrengthNode)
