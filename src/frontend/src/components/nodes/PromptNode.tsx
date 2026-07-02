import { memo, useCallback, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType, type PromptData } from '../../types/nodes'
import NodeWrapper from './NodeWrapper'
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
    <NodeWrapper def={def} selected={props.selected} headerRight={
      <button
        onClick={handleImprove}
        disabled={improving || !data.positive}
        style={{
          background: improving ? '#555' : '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: 9,
          cursor: improving || !data.positive ? 'not-allowed' : 'pointer',
          lineHeight: 1.4,
        }}
      >
        {improving ? '...' : '✨ Improve'}
      </button>
    } handles={
      <>
        <Handle type="source" position={Position.Right} id="positive" style={{ top: '35%', background: getHandleColor('positive', 'prompt') }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: getHandleColor('positive', 'prompt'), whiteSpace: 'nowrap' }}>Positive</div>
        </Handle>
        <Handle type="source" position={Position.Right} id="negative" style={{ top: '65%', background: getHandleColor('negative', 'prompt') }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: getHandleColor('negative', 'prompt'), whiteSpace: 'nowrap' }}>Negative</div>
        </Handle>
      </>
    }>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
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
            padding: '4px 6px',
            fontSize: 10,
            fontFamily: 'inherit',
            resize: 'vertical',
            minHeight: 32,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setInlineNegOpen((v) => !v)}
            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 10, padding: 0 }}
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
                padding: '4px 6px',
                fontSize: 10,
                fontFamily: 'inherit',
                resize: 'vertical',
                minHeight: 32,
                marginTop: 4,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          )}
        </div>
      </div>
    </NodeWrapper>
  )
}

export default memo(PromptNode)
