import { memo, useCallback, useState, useMemo, useEffect, useRef } from 'react'
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
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const [improving, setImproving] = useState(false)
  const [inlineNegOpen, setInlineNegOpen] = useState(false)

  const upstreamText = useMemo(() => {
    const inEdges = edges.filter((e) => e.target === props.id && e.targetHandle === 'text_in')
    if (inEdges.length === 0) return ''
    const sourceNode = nodes.find((n) => n.id === inEdges[0].source)
    if (!sourceNode) return ''
    const sd = sourceNode.data as Record<string, unknown>
    if (typeof sd.result === 'string' && sd.result) return sd.result
    if (typeof sd.text === 'string' && sd.text) return sd.text
    if (typeof sd.positive === 'string' && sd.positive) return sd.positive
    return ''
  }, [nodes, edges, props.id])

  const [localValue, setLocalValue] = useState(() => data.positive || upstreamText || '')
  const lastUpstreamRef = useRef(upstreamText)

  useEffect(() => {
    if (upstreamText && upstreamText !== lastUpstreamRef.current) {
      const prevUpstream = lastUpstreamRef.current
      lastUpstreamRef.current = upstreamText
      if (!localValue || localValue === prevUpstream) {
        setLocalValue(upstreamText)
        updateNodeData(props.id, { positive: upstreamText } as Partial<PromptData>)
      }
    }
  }, [upstreamText])

  const effectivePositive = localValue || upstreamText

  const handleImprove = async () => {
    if (!effectivePositive || improving) return
    setImproving(true)
    try {
      const improved = await improvePrompt(effectivePositive)
      setLocalValue(improved)
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
        disabled={improving || !effectivePositive}
        style={{
          background: improving ? '#555' : '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: 9,
          cursor: improving || !effectivePositive ? 'not-allowed' : 'pointer',
          lineHeight: 1.4,
        }}
      >
        {improving ? '...' : '✨ Improve'}
      </button>
    } handles={
      <>
        <Handle type="target" position={Position.Left} id="text_in" style={{ top: '35%', background: getHandleColor('text_in', 'prompt') }}>
          <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: getHandleColor('text_in', 'prompt'), whiteSpace: 'nowrap' }}>Text</div>
        </Handle>
        <Handle type="source" position={Position.Right} id="positive" style={{ top: '35%', background: getHandleColor('positive', 'prompt') }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: getHandleColor('positive', 'prompt'), whiteSpace: 'nowrap' }}>Positive</div>
        </Handle>
        <Handle type="source" position={Position.Right} id="negative" style={{ top: '65%', background: getHandleColor('negative', 'prompt') }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: getHandleColor('negative', 'prompt'), whiteSpace: 'nowrap' }}>Negative</div>
        </Handle>
      </>
    }>
      <div className="nodrag" style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
        <textarea
          placeholder={upstreamText ? 'Using connected text...' : 'Positive prompt...'}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={() => updateNodeData(props.id, { positive: localValue } as Partial<PromptData>)}
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
            <div className="nodrag">
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
            </div>
          )}
        </div>
      </div>
    </NodeWrapper>
  )
}

export default memo(PromptNode)
