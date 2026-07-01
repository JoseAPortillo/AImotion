import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType } from '../../../types/nodes'

function VLMNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, position: 'relative' }}>
      {props.selected && <NodeResizer handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: '8px 8px 0 0' }}>
        {def.label}
      </div>
      <div style={{ padding: '6px 10px', fontSize: 11, color: '#888' }}>
        Vision-Language Model
      </div>
      <Handle type="target" position={Position.Left} id="image_in" style={{ top: '33%', background: getHandleColor('image_in', 'video_tensor') }}>
        <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color: getHandleColor('image_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Image</div>
      </Handle>
      <Handle type="target" position={Position.Left} id="prompt_pos" style={{ top: '66%', background: PORT_COLORS.prompt }}>
        <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Prompt</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="text_out" style={{ top: '50%', background: PORT_COLORS.prompt }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Text</div>
      </Handle>
    </div>
  )
}

export default memo(VLMNode)
