import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, type NodeType } from '../../types/nodes'
import type { OutputData } from '../../types/nodes'

function OutputNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as OutputData

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 200 }}>
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: 10, fontSize: 12, color: '#ccc', textAlign: 'center' }}>
        <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{data.format || 'MP4'}</span>
      </div>
      <Handle type="target" position={Position.Left} id="video_in" style={{ top: '50%' }}>
        <div style={{ position: 'absolute', left: 14, top: -2, fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    </div>
  )
}

export default memo(OutputNode)
