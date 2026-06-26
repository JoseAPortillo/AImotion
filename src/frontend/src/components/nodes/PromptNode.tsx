import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, type NodeType } from '../../types/nodes'

function PromptNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const { positive, negative } = props.data as { positive?: string; negative?: string }
  const preview = positive
    ? positive.length > 60
      ? positive.slice(0, 60) + '...'
      : positive
    : 'No prompt'

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 200, overflow: 'hidden' }}>
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: 10, fontSize: 12, color: '#ccc' }}>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: '#999' }}>Positive: </span>
          <span>{preview}</span>
        </div>
        <div>
          <span style={{ color: '#999' }}>Negative: </span>
          <span style={{ color: '#888' }}>{negative || '(none)'}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Top} id="positive" style={{ top: -4 }}>
        <div style={{ position: 'absolute', left: 14, top: -2, fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>Positive</div>
      </Handle>
      <Handle type="source" position={Position.Bottom} id="negative" style={{ bottom: -4 }}>
        <div style={{ position: 'absolute', left: 14, top: -2, fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>Negative</div>
      </Handle>
    </div>
  )
}

export default memo(PromptNode)
