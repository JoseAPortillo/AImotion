import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type OutputData } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'

function OutputNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as OutputData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 200, minHeight: 60, position: 'relative' }}>
      {props.selected && <NodeResizer minWidth={150} minHeight={60} handleStyle={{ width: 10, height: 10, border: '2px solid #fff', background: '#555', zIndex: 10 }} lineStyle={{ border: '2px dashed #555' }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: 10, fontSize: 12, color: '#ccc', textAlign: 'center' }}>
        <select
          value={data.format || 'mp4'}
          onChange={(e) => updateNodeData(props.id, { format: e.target.value } as Partial<OutputData>)}
          style={{ background: '#0f0f0f', border: '1px solid #333', borderRadius: 4, color: '#ccc', padding: '4px 8px', fontSize: 12, textTransform: 'uppercase', fontWeight: 600 }}
        >
          <option value="mp4">MP4</option>
          <option value="gif">GIF</option>
        </select>
      </div>
      <Handle type="target" position={Position.Left} id="video_in" style={{ top: '50%', background: getHandleColor('video_in', 'video_tensor') }}>
        <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color: getHandleColor('video_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    </div>
  )
}

export default memo(OutputNode)
