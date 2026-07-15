import { memo, useCallback, useState, useEffect } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type ImageToTextData, type PromptData } from '../../../types/nodes'
import NodeWrapper from '../NodeWrapper'
import { useGraphStore } from '../../../store/graph'
import { useToastStore } from '../../../store/toast'
import { analyzeImageToText } from '../../../api/backend'
import { resolveNodeFile } from '../../../utils/resolveNodeFile'
import NumberInput from '../../NumberInput'

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

function ImageToTextNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as ImageToTextData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const addToast = useToastStore((s) => s.addToast)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)

  const fetchModels = useCallback(() => {
    fetch('/models')
      .then(r => r.json())
      .then(d => {
        const filtered = (d.models || []).filter(
          (m: ModelEntry) => m.runner === 'transformers'
        )
        setModels(filtered)
        setModelsLoaded(true)
      })
      .catch(() => setModelsLoaded(true))
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  useEffect(() => {
    if (modelsLoaded && models.length > 0 && !data.model) {
      updateNodeData(props.id, { model: models[0].key } as Partial<ImageToTextData>)
    }
  }, [modelsLoaded, models, data.model, props.id, updateNodeData])

  const handleAnalyze = useCallback(async () => {
    const inEdges = edges.filter((e) => e.target === props.id)
    const getNode = (edge: typeof inEdges[0]) => nodes.find((n) => n.id === edge.source)

    const promptEdge = inEdges.find((e) => e.targetHandle === 'prompt_pos')
    const imageEdge = inEdges.find((e) => e.targetHandle === 'image_in')

    const promptData = promptEdge ? getNode(promptEdge)?.data as PromptData | undefined : undefined
    const imageFile = imageEdge ? await resolveNodeFile(imageEdge.source) : null

    if (!imageFile) {
      addToast('Connect an Image Input node with an image', 'info')
      return
    }

    if (!data.model) {
      addToast('Select a model from the dropdown', 'info')
      updateNodeData(props.id, { loading: false } as Partial<ImageToTextData>)
      return
    }

    const promptText = promptData?.positive || data.prompt || 'Describe the image in detail'

    updateNodeData(props.id, { loading: true, result: '' } as Partial<ImageToTextData>)
    try {
      const result = await analyzeImageToText(
        imageFile,
        promptText,
        data.model,
        data.max_new_tokens ?? 512,
        data.temperature ?? 0.7
      )
      updateNodeData(props.id, { result, loading: false } as Partial<ImageToTextData>)
    } catch (err: any) {
      addToast(`Image-to-Text error: ${err.message}`, 'error')
      updateNodeData(props.id, { loading: false } as Partial<ImageToTextData>)
    }
  }, [props.id, data, nodes, edges, updateNodeData])

  return (
    <NodeWrapper def={def} selected={props.selected} footer={
      <button
        onClick={handleAnalyze}
        disabled={data.loading}
        style={{
          width: '100%',
          padding: '4px 0',
          borderRadius: 4,
          border: 'none',
          fontSize: 10,
          fontWeight: 600,
          cursor: data.loading ? 'not-allowed' : 'pointer',
          background: data.loading ? '#333' : '#06b6d4',
          color: data.loading ? '#888' : '#fff',
        }}
      >
        {data.loading ? 'Analyzing...' : 'Analyze ▶'}
      </button>
    } handles={
      <>
        <Handle type="target" position={Position.Left} id="image_in" style={{ top: '33%', background: getHandleColor('image_in', 'video_tensor') }}>
          <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: getHandleColor('image_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Image</div>
        </Handle>
        <Handle type="target" position={Position.Left} id="prompt_pos" style={{ top: '66%', background: PORT_COLORS.prompt }}>
          <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Prompt</div>
        </Handle>
        <Handle type="source" position={Position.Right} id="text_out" style={{ top: '50%', background: PORT_COLORS.prompt }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Text</div>
        </Handle>
      </>
    }>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
        <select
          value={data.model}
          onChange={(e) => updateNodeData(props.id, { model: e.target.value } as Partial<ImageToTextData>)}
          onFocus={fetchModels}
          style={selectStyle}
        >
          {!modelsLoaded && <option value="">Loading...</option>}
          {modelsLoaded && models.length === 0 && <option value="">No models installed</option>}
          {models.map(m => (
            <option key={m.key} value={m.key}>{m.name}</option>
          ))}
        </select>

        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1 }}>Max Tokens</label>
          <NumberInput
            value={data.max_new_tokens ?? 512}
            min={1} max={4096}
            onChange={(v) => updateNodeData(props.id, { max_new_tokens: v } as Partial<ImageToTextData>)}
          />
        </div>

        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1 }}>Temperature</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={data.temperature}
            onChange={(e) => updateNodeData(props.id, { temperature: parseFloat(e.target.value) } as Partial<ImageToTextData>)}
            style={{ width: '100%' }}
          />
          <span style={{ fontSize: 9, color: '#888' }}>{data.temperature}</span>
        </div>

        <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc', minHeight: 32 }}>
          {data.loading ? (
            <span style={{ color: '#888' }}>Analyzing...</span>
          ) : data.result ? (
            <div style={{ fontSize: 10, lineHeight: 1.3, maxHeight: 80, overflowY: 'auto', color: '#e0e0e0', whiteSpace: 'pre-wrap' }}>
              {String(data.result)}
            </div>
          ) : (
            <span style={{ color: '#888', fontSize: 10 }}>Connect Image + Prompt, then click Analyze</span>
          )}
        </div>
      </div>
    </NodeWrapper>
  )
}

export default memo(ImageToTextNode)
