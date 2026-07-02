import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType, type OutputData } from '../../types/nodes'
import NodeWrapper from './NodeWrapper'
import { useGraphStore } from '../../store/graph'

function OutputNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as OutputData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)

  return (
    <NodeWrapper def={def} selected={props.selected} handles={
      <Handle type="target" position={Position.Left} id="video_in" style={{ top: '50%', background: getHandleColor('video_in', 'video_tensor') }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: getHandleColor('video_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    }>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc', textAlign: 'center' }}>
        <select
          value={data.format || 'mp4'}
          onChange={(e) => updateNodeData(props.id, { format: e.target.value } as Partial<OutputData>)}
          style={{ background: '#0f0f0f', border: '1px solid #333', borderRadius: 4, color: '#ccc', padding: '2px 6px', fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}
        >
          <option value="mp4">MP4</option>
          <option value="gif">GIF</option>
        </select>
      </div>
    </NodeWrapper>
  )
}

export default memo(OutputNode)
