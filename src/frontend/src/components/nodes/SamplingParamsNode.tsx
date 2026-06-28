import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, type NodeType } from '../../types/nodes'
import type { SamplingParamsData } from '../../types/nodes'

function SamplingParamsNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as SamplingParamsData
  const summary = `steps=${data.steps}, cfg=${data.cfg}, seed=${data.seed}`

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 200, minHeight: 60, position: 'relative' }}>
      {props.selected && <NodeResizer minWidth={150} minHeight={60} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: 10, fontSize: 12, color: '#ccc', fontFamily: 'monospace' }}>
        {summary}
      </div>
      <Handle type="source" position={Position.Bottom} id="params" style={{ bottom: -4 }}>
        <div style={{ position: 'absolute', left: 14, top: -2, fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>Params</div>
      </Handle>
    </div>
  )
}

export default memo(SamplingParamsNode)
