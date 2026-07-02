import { memo, useCallback, useState, useEffect } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type TransformersData, type PromptData } from '../../../types/nodes'
import NodeWrapper from '../NodeWrapper'
import { useGraphStore } from '../../../store/graph'
import { useToastStore } from '../../../store/toast'
import { generateLLM } from '../../../api/backend'

interface ModelEntry {
  key: string
  name: string
  runner: string
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
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const addToast = useToastStore((s) => s.addToast)
  const [generating, setGenerating] = useState(false)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)

  const fetchModels = useCallback(() => {
    fetch('/models')
      .then(r => r.json())
      .then(d => {
        const filtered = (d.models || []).filter(
          (m: ModelEntry) => m.runner === 'gguf'
        )
        setModels(filtered)
        setModelsLoaded(true)
      })
      .catch(() => setModelsLoaded(true))
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  const handleGenerate = useCallback(async () => {
    const inEdges = edges.filter((e) => e.target === props.id)
    const getNode = (edge: typeof inEdges[0]) => nodes.find((n) => n.id === edge.source)

    const promptEdge = inEdges.find((e) => e.targetHandle === 'prompt_pos')
    const systemEdge = inEdges.find((e) => e.targetHandle === 'system_in')

    const promptData = promptEdge ? getNode(promptEdge)?.data as PromptData | undefined : undefined
    const systemData = systemEdge ? getNode(systemEdge)?.data as PromptData | undefined : undefined

    if (!promptData?.positive) {
      addToast('Connect a Prompt node', 'info')
      return
    }

    setGenerating(true)
    try {
      const result = await generateLLM({
        prompt: promptData.positive,
        system_prompt: systemData?.positive || data.system_prompt || '',
        model: data.model,
        temperature: data.temperature ?? 0.7,
        max_tokens: data.max_tokens ?? 2048,
        top_p: data.top_p ?? 0.9,
        top_k: data.top_k ?? 40,
        seed: data.seed ?? 0,
      })
      updateNodeData(props.id, { result } as Partial<TransformersData>)
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error')
    } finally {
      setGenerating(false)
    }
  }, [props.id, data, nodes, edges, updateNodeData])

  return (
    <NodeWrapper def={def} selected={props.selected} style={{ minWidth: 160 }} footer={
      <button
        onClick={handleGenerate}
        disabled={generating}
        style={{
          width: '100%',
          padding: '4px 0',
          borderRadius: 4,
          border: 'none',
          fontSize: 10,
          fontWeight: 600,
          cursor: generating ? 'not-allowed' : 'pointer',
          background: generating ? '#333' : '#06b6d4',
          color: generating ? '#888' : '#0f0f0f',
        }}
      >
        {generating ? 'Generating...' : 'Generate ▶'}
      </button>
    }>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc', maxHeight: 240, overflowY: 'auto' }}>
        <select
          value={data.model}
          onChange={(e) => updateNodeData(props.id, { model: e.target.value } as Partial<TransformersData>)}
          onFocus={fetchModels}
          style={selectStyle}
        >
          {!modelsLoaded && <option value="">Loading...</option>}
          {modelsLoaded && models.length === 0 && <option value="">No models</option>}
          {models.map(m => (
            <option key={m.key} value={m.key}>{m.name}</option>
          ))}
        </select>

        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1 }}>Temperature</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={data.temperature}
            onChange={(e) => updateNodeData(props.id, { temperature: parseFloat(e.target.value) } as Partial<TransformersData>)}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: 9, color: '#888' }}>{data.temperature}</span>
        </div>

        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1 }}>Max Tokens</label>
          <input
            type="number"
            min={1}
            max={32768}
            value={data.max_tokens}
            onChange={(e) => updateNodeData(props.id, { max_tokens: parseInt(e.target.value, 10) } as Partial<TransformersData>)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1 }}>Top-P</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={data.top_p}
            onChange={(e) => updateNodeData(props.id, { top_p: parseFloat(e.target.value) } as Partial<TransformersData>)}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: 9, color: '#888' }}>{data.top_p}</span>
        </div>

        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1 }}>Top-K</label>
          <input
            type="number"
            min={1}
            max={100}
            value={data.top_k}
            onChange={(e) => updateNodeData(props.id, { top_k: parseInt(e.target.value, 10) } as Partial<TransformersData>)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1 }}>Seed</label>
          <input
            type="number"
            min={0}
            value={data.seed}
            onChange={(e) => updateNodeData(props.id, { seed: parseInt(e.target.value, 10) } as Partial<TransformersData>)}
            style={inputStyle}
          />
        </div>

        {data.result && (
          <div style={{ marginTop: 6, padding: 4, background: '#0f0f0f', borderRadius: 4, maxHeight: 80, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, lineHeight: 1.3, color: '#e0e0e0', whiteSpace: 'pre-wrap' }}>{String(data.result)}</div>
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left} id="prompt_pos" style={{ top: '33%', background: PORT_COLORS.prompt }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Prompt</div>
      </Handle>
      <Handle type="target" position={Position.Left} id="system_in" style={{ top: '66%', background: '#86efac' }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: '#86efac', whiteSpace: 'nowrap' }}>System</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="text_out" style={{ top: '50%', background: PORT_COLORS.prompt }}>
        <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Text</div>
      </Handle>
    </NodeWrapper>
  )
}

export default memo(TransformersGeneratorNode)
