import { memo, useCallback, useState, useEffect } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type TransformersData } from '../../../types/nodes'
import { useGraphStore } from '../../../store/graph'
import { useToastStore } from '../../../store/toast'

interface ModelEntry {
  key: string
  name: string
  type: string
}

const selectStyle: React.CSSProperties = {
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ccc',
  padding: '3px 6px',
  fontSize: 11,
  outline: 'none',
  width: '100%',
  marginTop: 4,
}

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  boxSizing: 'border-box',
}

function TransformersGeneratorNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as TransformersData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const addToast = useToastStore((s) => s.addToast)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)

  const fetchModels = useCallback(() => {
    fetch('/models')
      .then(r => r.json())
      .then(d => {
        const filtered = (d.models || []).filter(
          (m: ModelEntry) => m.type !== 'diffusers' && m.type !== 'api'
        )
        setModels(filtered)
        setModelsLoaded(true)
      })
      .catch(() => setModelsLoaded(true))
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  const handleGenerate = useCallback(() => {
    if (!data.model) {
      addToast('Select a model first', 'info')
      return
    }
    addToast('Transformers generation — coming in next iteration', 'info')
  }, [data.model, addToast])

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, position: 'relative', paddingBottom: 38 }}>
      {props.selected && <NodeResizer handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: '8px 8px 0 0' }}>
        {def.label}
      </div>
      <div style={{ padding: '6px 10px', fontSize: 12, color: '#ccc' }}>
        <select
          value={data.model}
          onChange={(e) => updateNodeData(props.id, { model: e.target.value } as Partial<TransformersData>)}
          onFocus={fetchModels}
          style={selectStyle}
        >
          {!modelsLoaded && <option value="">Loading...</option>}
          {modelsLoaded && models.length === 0 && <option value="">No models available</option>}
          {models.map(m => (
            <option key={m.key} value={m.key}>{m.name}</option>
          ))}
        </select>

        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 2 }}>System Prompt</label>
          <textarea
            value={data.system_prompt}
            onChange={(e) => updateNodeData(props.id, { system_prompt: e.target.value } as Partial<TransformersData>)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder='Optional system prompt...'
          />
        </div>

        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 2 }}>Temperature</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={data.temperature}
            onChange={(e) => updateNodeData(props.id, { temperature: parseFloat(e.target.value) } as Partial<TransformersData>)}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: 10, color: '#888' }}>{data.temperature}</span>
        </div>

        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 2 }}>Max Tokens</label>
          <input
            type="number"
            min={1}
            max={32768}
            value={data.max_tokens}
            onChange={(e) => updateNodeData(props.id, { max_tokens: parseInt(e.target.value, 10) } as Partial<TransformersData>)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 2 }}>Top-P</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={data.top_p}
            onChange={(e) => updateNodeData(props.id, { top_p: parseFloat(e.target.value) } as Partial<TransformersData>)}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: 10, color: '#888' }}>{data.top_p}</span>
        </div>

        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 2 }}>Top-K</label>
          <input
            type="number"
            min={1}
            max={100}
            value={data.top_k}
            onChange={(e) => updateNodeData(props.id, { top_k: parseInt(e.target.value, 10) } as Partial<TransformersData>)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 2 }}>Seed</label>
          <input
            type="number"
            min={0}
            value={data.seed}
            onChange={(e) => updateNodeData(props.id, { seed: parseInt(e.target.value, 10) } as Partial<TransformersData>)}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid #2a2a2a', padding: '6px 10px', background: '#1a1a1a' }}>
        <button
          onClick={handleGenerate}
          style={{
            width: '100%',
            padding: '6px 0',
            borderRadius: 4,
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            background: '#4ade80',
            color: '#0f0f0f',
          }}
        >
          Generate ▶
        </button>
      </div>

      <Handle type="target" position={Position.Left} id="prompt_pos" style={{ top: '33%', background: PORT_COLORS.prompt }}>
        <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Prompt</div>
      </Handle>
      <Handle type="target" position={Position.Left} id="system_in" style={{ top: '66%', background: '#86efac' }}>
        <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color: '#86efac', whiteSpace: 'nowrap' }}>System</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="text_out" style={{ top: '50%', background: PORT_COLORS.prompt }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Text</div>
      </Handle>
    </div>
  )
}

export default memo(TransformersGeneratorNode)
