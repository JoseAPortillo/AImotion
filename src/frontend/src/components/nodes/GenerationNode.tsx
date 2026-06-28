import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, type NodeType } from '../../types/nodes'

const inputHandles = ['video_in', 'audio_in', 'prompt_pos', 'prompt_neg', 'params', 'strength']

function GenerationNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const { model } = props.data as { model?: string }

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 220, minHeight: 240 }}>
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: 10, fontSize: 12, color: '#ccc' }}>
        {model ? (
          <span style={{ fontFamily: 'monospace' }}>{model}</span>
        ) : (
          <span style={{ color: '#888' }}>Connect inputs to generate</span>
        )}
      </div>
      {inputHandles.map((id, i) => (
        <Handle
          key={id}
          type="target"
          position={Position.Left}
          id={id}
          style={{ top: `${((i + 1) / (inputHandles.length + 1)) * 100}%` }}
        >
          <div style={{ position: 'absolute', left: 14, top: -2, fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>
            {def.inputs.find((inp) => inp.id === id)?.label || id}
          </div>
        </Handle>
      ))}
      <Handle type="source" position={Position.Right} id="video_out" style={{ top: '50%' }}>
        <div style={{ position: 'absolute', right: 14, top: -2, fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    </div>
  )
}

export default memo(GenerationNode)
