import { memo, useCallback, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type PromptData } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'
import { improvePrompt } from '../../api/backend'

function PromptNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as PromptData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const [improving, setImproving] = useState(false)
  const [inlineNegOpen, setInlineNegOpen] = useState(false)

  const handleImprove = async () => {
    if (!data.positive || improving) return
    setImproving(true)
    try {
      const improved = await improvePrompt(data.positive)
      updateNodeData(props.id, { positive: improved } as Partial<PromptData>)
    } catch (err) {
      console.error('Failed to improve prompt:', err)
    } finally {
      setImproving(false)
    }
  }

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, position: 'relative' }}>
      {props.selected && <NodeResizer handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <span>{def.label}</span>
        <button
          onClick={handleImprove}
          disabled={improving || !data.positive}
          style={{
            background: improving ? '#555' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 10,
            cursor: improving || !data.positive ? 'not-allowed' : 'pointer',
            lineHeight: 1.4,
          }}
        >
          {improving ? '...' : '✨ Improve'}
        </button>
      </div>
      <div style={{ padding: '6px 10px', fontSize: 12, color: '#ccc' }}>
        <textarea
          placeholder="Positive prompt..."
          value={data.positive || ''}
          onChange={(e) => updateNodeData(props.id, { positive: e.target.value } as Partial<PromptData>)}
          style={{
            width: '100%',
            background: '#0f0f0f',
            border: '1px solid #333',
            borderRadius: 4,
            color: '#e0e0e0',
            padding: '6px 8px',
            fontSize: 12,
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: 40,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            onClick={() => setInlineNegOpen((v) => !v)}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 11, padding: 0 }}
          >
            {inlineNegOpen ? '▲ Hide negative' : '▼ Negative prompt'}
          </button>
          {inlineNegOpen && (
            <textarea
              placeholder="Negative prompt (optional)..."
              value={data.negative || ''}
              onChange={(e) => updateNodeData(props.id, { negative: e.target.value } as Partial<PromptData>)}
              style={{
                width: '100%',
                background: '#0f0f0f',
                border: '1px solid #333',
                borderRadius: 4,
                color: '#e0e0e0',
                padding: '6px 8px',
                fontSize: 12,
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: 40,
                marginTop: 4,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="positive" style={{ top: '35%', background: getHandleColor('positive', 'prompt') }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: getHandleColor('positive', 'prompt'), whiteSpace: 'nowrap' }}>Positive</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="negative" style={{ top: '65%', background: getHandleColor('negative', 'prompt') }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: getHandleColor('negative', 'prompt'), whiteSpace: 'nowrap' }}>Negative</div>
      </Handle>
    </div>
  )
}

export default memo(PromptNode)
