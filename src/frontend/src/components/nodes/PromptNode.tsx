import { memo, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, type NodeType } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'
import { improvePrompt } from '../../api/backend'

function PromptNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const { positive, negative } = props.data as { positive?: string; negative?: string }
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const [improving, setImproving] = useState(false)

  const preview = positive
    ? positive.length > 60
      ? positive.slice(0, 60) + '...'
      : positive
    : 'No prompt'

  const handleImprove = async () => {
    if (!positive || improving) return
    setImproving(true)
    try {
      const improved = await improvePrompt(positive)
      updateNodeData(props.id, { positive: improved })
    } catch (err) {
      console.error('Failed to improve prompt:', err)
    } finally {
      setImproving(false)
    }
  }

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 200, minHeight: 100, position: 'relative' }}>
      <NodeResizer minWidth={150} minHeight={80} />
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{def.label}</span>
        <button
          onClick={handleImprove}
          disabled={improving || !positive}
          style={{
            background: improving ? '#555' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 10,
            cursor: improving || !positive ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {improving ? '⏳' : '✨'} {improving ? 'Improving...' : 'Improve'}
        </button>
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
