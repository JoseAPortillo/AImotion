import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType } from '../../types/nodes'
import NodeWrapper from './NodeWrapper'
import { useGraphStore } from '../../store/graph'

function PreviewNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const outputUrl = useGraphStore((s) => s.outputUrl)
  const resultType = useGraphStore((s) => s.resultType)

  const isImage = resultType === 'image' || (!resultType && outputUrl?.endsWith('.png'))

  return (
    <NodeWrapper def={def} selected={props.selected}>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
        {outputUrl ? (
          isImage ? (
            <img src={outputUrl} alt="Generated" style={{ width: '100%', maxWidth: 200, maxHeight: 200, borderRadius: 4, display: 'block', margin: '0 auto' }} />
          ) : (
            <video src={outputUrl} controls autoPlay style={{ width: '100%', maxWidth: 200, maxHeight: 120, borderRadius: 4, display: 'block', margin: '0 auto' }} />
          )
        ) : (
          <span style={{ color: '#888' }}>Connect to Generation node</span>
        )}
      </div>
      <Handle type="target" position={Position.Left} id="video_in" style={{ top: '50%', background: getHandleColor('video_in', 'video_tensor') }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: getHandleColor('video_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Output</div>
      </Handle>
    </NodeWrapper>
  )
}

export default memo(PreviewNode)
