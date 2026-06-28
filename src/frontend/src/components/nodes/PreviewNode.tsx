import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'

function PreviewNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const outputUrl = useGraphStore((s) => s.outputUrl)

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 280, minHeight: 200, position: 'relative' }}>
      {props.selected && <NodeResizer minWidth={200} minHeight={160} handleStyle={{ width: 10, height: 10, border: '2px solid #fff', background: '#555', zIndex: 10 }} lineStyle={{ border: '2px dashed #555' }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: 10, fontSize: 12, color: '#ccc' }}>
        {outputUrl ? (
          <video src={outputUrl} controls autoPlay style={{ width: '100%', maxWidth: 320, maxHeight: 180, borderRadius: 4, display: 'block', margin: '0 auto' }} />
        ) : (
          <span style={{ color: '#888' }}>Connect to Generation node</span>
        )}
      </div>
      <Handle type="target" position={Position.Left} id="video_in" style={{ top: '50%', background: getHandleColor('video_in', 'video_tensor') }}>
        <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color: getHandleColor('video_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    </div>
  )
}

export default memo(PreviewNode)
