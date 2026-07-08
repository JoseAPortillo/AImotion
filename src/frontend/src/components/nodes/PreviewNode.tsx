import { memo, useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType } from '../../types/nodes'
import NodeWrapper from './NodeWrapper'
import { useGraphStore } from '../../store/graph'

function PreviewNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const outputUrl = useGraphStore((s) => s.outputUrl)
  const resultType = useGraphStore((s) => s.resultType)
  const edges = useGraphStore((s) => s.edges)
  const nodeOutputs = useGraphStore((s) => s.nodeOutputs)

  const upstreamOutput = useMemo(() => {
    const incoming = edges.find((e) => e.target === props.id)
    if (!incoming) return 'disconnected'
    const out = nodeOutputs[incoming.source]
    return out ?? null
  }, [edges, props.id, nodeOutputs])

  const isEmpty = upstreamOutput === 'disconnected'
  const src = upstreamOutput && upstreamOutput !== 'disconnected' ? upstreamOutput.url : isEmpty ? null : outputUrl
  const type = upstreamOutput && upstreamOutput !== 'disconnected' ? upstreamOutput.type : isEmpty ? null : resultType
  const isImage = type === 'image' || (!type && src?.endsWith('.png'))

  return (
    <NodeWrapper def={def} selected={props.selected} handles={
      <>
        <Handle type="target" position={Position.Left} id="video_in" style={{ top: '50%', background: getHandleColor('video_in', 'video_tensor') }}>
          <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: getHandleColor('video_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Output</div>
        </Handle>
        <Handle type="source" position={Position.Right} id="video_out" style={{ top: '50%', background: getHandleColor('video_out', 'video_tensor') }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: getHandleColor('video_out', 'video_tensor'), whiteSpace: 'nowrap' }}>Passthrough</div>
        </Handle>
      </>
    }>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
        {src ? (
          isImage ? (
            <img src={src} alt="Generated" style={{ width: '100%', maxWidth: 200, maxHeight: 200, borderRadius: 4, display: 'block', margin: '0 auto' }} />
          ) : (
            <video src={src} controls autoPlay style={{ width: '100%', maxWidth: 200, maxHeight: 120, borderRadius: 4, display: 'block', margin: '0 auto' }} />
          )
        ) : (
          <span style={{ color: '#888' }}>Connect to Generation node</span>
        )}
      </div>
    </NodeWrapper>
  )
}

export default memo(PreviewNode)
