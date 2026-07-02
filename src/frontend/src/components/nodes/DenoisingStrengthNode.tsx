import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType, type DenoisingStrengthData } from '../../types/nodes'
import NodeWrapper from './NodeWrapper'
import { useGraphStore } from '../../store/graph'

function DenoisingStrengthNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as DenoisingStrengthData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const pct = Math.round((data.strength ?? 0.8) * 100)

  return (
    <NodeWrapper def={def} selected={props.selected}>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="range"
            style={{ flex: 1, accentColor: def.color }}
            min={0}
            max={1}
            step={0.05}
            value={data.strength ?? 0.8}
            onChange={(e) => updateNodeData(props.id, { strength: parseFloat(e.target.value) } as Partial<DenoisingStrengthData>)}
          />
          <span style={{ fontSize: 11, fontWeight: 700, minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="strength" style={{ top: '50%', background: getHandleColor('strength', 'params') }}>
        <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: getHandleColor('strength', 'params'), whiteSpace: 'nowrap' }}>Strength</div>
      </Handle>
    </NodeWrapper>
  )
}

export default memo(DenoisingStrengthNode)
