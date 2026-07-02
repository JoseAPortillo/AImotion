import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType } from '../../../types/nodes'
import NodeWrapper from '../NodeWrapper'

function CVTaskProcessorNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]

  return (
    <NodeWrapper def={def} selected={props.selected}>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#888' }}>
        Computer Vision — coming soon
      </div>
      <Handle type="target" position={Position.Left} id="image_in" style={{ top: '50%', background: getHandleColor('image_in', 'video_tensor') }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: getHandleColor('image_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Image</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="mask_out" style={{ top: '50%', background: '#ef4444' }}>
        <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: '#ef4444', whiteSpace: 'nowrap' }}>Mask</div>
      </Handle>
    </NodeWrapper>
  )
}

export default memo(CVTaskProcessorNode)
