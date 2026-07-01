import { memo, useCallback, useMemo, useState, useEffect } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type GenerationData, type PromptData, type SamplingParamsData, type DenoisingStrengthData } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'
import { useToastStore } from '../../store/toast'
import { startGeneration, pollTask, type TaskStatus } from '../../api/backend'

const schedLabels: Record<string, string> = {
  cogvideox_ddim: 'DDIM',
  cogvideox_dpm: 'DPM',
  flow_match_euler: 'Flow Euler',
  ltx_euler_ancestral_rf: 'Euler Anc RF',
  scheduler: 'Auto-detect',
}

interface ModelEntry {
  key: string
  name: string
  schedulers: string[]
  default_scheduler: string
  type: string
  pipeline_class?: string
  is_video?: boolean
  accepts?: {
    image: boolean
    video: boolean
    strength: boolean
  }
  defaults?: Record<string, unknown>
  inputs?: Record<string, {
    required: boolean
    type: string
    default?: unknown
    hidden?: boolean
    min?: number
    max?: number
  }>
}

function getModelModality(cfg: ModelEntry | undefined): { label: string; outputLabel: string; outputColor: string } {
  if (!cfg) return { label: 'Unknown', outputLabel: 'Video', outputColor: '#888' }

  const isVideo = cfg.is_video ?? cfg.pipeline_class?.includes('Video') ?? false
  const a = cfg.accepts ?? { image: false, video: false, strength: false }

  let label: string
  if (a.image) {
    label = isVideo ? 'Image-to-Video' : 'Image-to-Image'
  } else if (a.video) {
    label = 'Video-to-Video'
  } else {
    label = isVideo ? 'Text-to-Video' : 'Text-to-Image'
  }

  return {
    label,
    outputLabel: isVideo ? 'Video' : 'Image',
    outputColor: isVideo ? '#4ade80' : '#f97316',
  }
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

function GenerationNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as GenerationData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const setOutputUrl = useGraphStore((s) => s.setOutputUrl)
  const addToast = useToastStore((s) => s.addToast)
  const [genRunning, setGenRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)

  const fetchModels = useCallback(() => {
    fetch('/models')
      .then(r => r.json())
      .then(data => {
        const filtered = (data.models || []).filter(
          (m: ModelEntry) => m.type !== 'future' && m.type !== 'api'
        )
        setModels(filtered)
        setModelsLoaded(true)
      })
      .catch(() => setModelsLoaded(true))
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  const modelConfig = models.find(m => m.key === data.model)
  const availableScheds = modelConfig?.schedulers || []
  const defaultSched = modelConfig?.default_scheduler || ''

  const activeInputs = useMemo(() => {
    const active = new Set<string>(['prompt_pos', 'prompt_neg', 'params'])
    if (!modelConfig?.accepts) return active
    if (modelConfig.accepts.image) active.add('image_in')
    if (modelConfig.accepts.video) active.add('video_in')
    if (modelConfig.accepts.strength) active.add('strength')
    return active
  }, [modelConfig])

  const modelModality = useMemo(() => getModelModality(modelConfig), [modelConfig])
  const schedLabel = data.scheduler
    ? schedLabels[data.scheduler] || data.scheduler
    : defaultSched
      ? `Default (${schedLabels[defaultSched] || defaultSched})`
      : 'Default'

  const handleModelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const key = e.target.value
    const cfg = models.find(m => m.key === key)
    const defs = cfg?.defaults || {}
    const inputs = cfg?.inputs || {}
    const update: Partial<GenerationData> = {
      model: key,
      scheduler: cfg?.default_scheduler || '',
    }
    if (inputs.num_frames && defs.num_frames != null) update.num_frames = defs.num_frames as number
    if (inputs.max_sequence_length && defs.max_seq != null) update.max_sequence_length = defs.max_seq as number
    updateNodeData(props.id, update)
  }, [props.id, models, updateNodeData])

  const handleGenWorkflow = useCallback(async () => {
    const genEdges = edges.filter((e) => e.target === props.id)
    const getNode = (edge: typeof genEdges[0]) => nodes.find((n) => n.id === edge.source)

    const promptEdgePos = genEdges.find((e) => e.targetHandle === 'prompt_pos')
    const promptEdgeNeg = genEdges.find((e) => e.targetHandle === 'prompt_neg')
    const paramsEdge = genEdges.find((e) => e.targetHandle === 'params')
    const strengthEdge = genEdges.find((e) => e.targetHandle === 'strength')
    const videoEdge = genEdges.find((e) => e.targetHandle === 'video_in')
    const imageEdge = genEdges.find((e) => e.targetHandle === 'image_in')

    const promptData = promptEdgePos ? getNode(promptEdgePos)?.data as PromptData | undefined : undefined
    const paramsData = paramsEdge ? getNode(paramsEdge)?.data as SamplingParamsData | undefined : undefined
    const strengthData = strengthEdge ? getNode(strengthEdge)?.data as DenoisingStrengthData | undefined : undefined
    const videoNode = videoEdge ? getNode(videoEdge) : undefined
    const imageNode = imageEdge ? getNode(imageEdge) : undefined

    if (!promptData?.positive || !paramsData) {
      addToast('Connect at least a Prompt and Sampling node to this Generation node', 'info')
      return
    }

    setGenRunning(true)
    setProgress(0)
    try {
      const task = await startGeneration(
        promptData.positive,
        promptEdgeNeg ? (getNode(promptEdgeNeg)?.data as PromptData | undefined)?.negative || '' : '',
        {
          width: paramsData.width || 720,
          height: paramsData.height || 480,
          steps: paramsData.steps || 50,
          cfg: paramsData.cfg || 6,
          strength: strengthData?.strength ?? 0.8,
          seed: paramsData.seed || 0,
          scheduler: data.scheduler || '',
          model: data.model || 'cogvideox-2b',
          vae_tiling: data.vae_tiling ?? true,
          vae_tile_overlap: data.vae_tile_overlap ?? 0.0,
          num_frames: data.num_frames,
          max_sequence_length: data.max_sequence_length,
        },
        (videoNode?.data && 'file' in videoNode.data && (videoNode.data as { file?: File }).file instanceof File) ? (videoNode.data as { file?: unknown }).file as File : undefined,
        (imageNode?.data && 'file' in imageNode.data && (imageNode.data as { file?: File }).file instanceof File) ? (imageNode.data as { file?: unknown }).file as File : undefined,
      )

      let status: TaskStatus
      do {
        await new Promise((r) => setTimeout(r, 2000))
        status = await pollTask(task.task_id)

        if (status.current_step != null && status.total_steps != null && status.total_steps > 0) {
          setProgress(Math.round((status.current_step / status.total_steps) * 100))
        } else if (status.progress != null) {
          setProgress(Math.round(status.progress * 100))
        }
      } while (status.status === 'pending' || status.status === 'running')

      if (status.status === 'completed' && status.result_url) {
        setProgress(100)
        setOutputUrl(status.result_url, status.result_type)
      } else {
        addToast(`Workflow failed: ${status.error || 'unknown error'}`, 'error')
      }
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error')
    } finally {
      setGenRunning(false)
    }
  }, [props.id, data.scheduler, data.model, nodes, edges, setOutputUrl])

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, position: 'relative', paddingBottom: 38 }}>
      {props.selected && <NodeResizer handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <span>{def.label}</span>
        {modelConfig && (
          <span style={{ fontSize: 9, opacity: 0.8, background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>
            {modelModality.label}
          </span>
        )}
      </div>
      <div style={{ padding: '6px 10px', fontSize: 12, color: '#ccc' }}>
        <select
          value={data.model}
          onChange={handleModelChange}
          onFocus={fetchModels}
          style={selectStyle}
        >
          {!modelsLoaded && <option value="">Loading...</option>}
          {modelsLoaded && models.length === 0 && <option value="">No models</option>}
          {models.map(m => (
            <option key={m.key} value={m.key}>
              {m.name}
            </option>
          ))}
          {modelsLoaded && models.length > 0 && data.model && !models.find(m => m.key === data.model) && (
            <option value={data.model} disabled>{data.model} (unavailable)</option>
          )}
        </select>
        <select
          value={data.scheduler}
          onChange={(e) => updateNodeData(props.id, { scheduler: e.target.value } as Partial<GenerationData>)}
          style={selectStyle}
        >
          <option value="">Default{defaultSched ? ` (${schedLabels[defaultSched] || defaultSched})` : ''}</option>
          {availableScheds.map(s => (
            <option key={s} value={s}>{schedLabels[s] || s}</option>
          ))}
        </select>
        {schedLabel && <div style={{ marginTop: 2, fontSize: 10, color: '#888' }}>Current: {schedLabel}</div>}
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={data.vae_tiling}
              onChange={(e) => updateNodeData(props.id, { vae_tiling: e.target.checked } as Partial<GenerationData>)}
            />
            VAE Tiling
          </label>
          {data.vae_tiling && (
            <div style={{ marginTop: 4 }}>
              <label style={{ fontSize: 10, color: '#888' }}>Tile Overlap: {data.vae_tile_overlap > 0 ? data.vae_tile_overlap : 'VAE default'}</label>
              <input
                type="range"
                min="0"
                max="0.9"
                step="0.1"
                value={data.vae_tile_overlap}
                onChange={(e) => updateNodeData(props.id, { vae_tile_overlap: parseFloat(e.target.value) } as Partial<GenerationData>)}
                style={{ width: '100%', marginTop: 2 }}
              />
            </div>
          )}
        </div>
        {modelConfig?.inputs && Object.entries(modelConfig.inputs)
          .filter(([, inp]) => !inp.hidden && inp.type === 'int' && inp.default != null)
          .map(([name, inp]) => (
            <div key={name} style={{ marginTop: 6 }}>
              <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 2 }}>{name.replace(/_/g, ' ')}</label>
              <input
                type="number"
                value={(data[name as keyof GenerationData] ?? inp.default) as number}
                onChange={(e) => updateNodeData(props.id, { [name]: parseInt(e.target.value, 10) } as Partial<GenerationData>)}
                min={inp.min}
                max={inp.max}
                style={{ ...selectStyle, width: '100%' }}
              />
            </div>
          ))}
      </div>

      {genRunning && (
        <div style={{ padding: '0 10px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#2a2a2a', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(progress, 100)}%`, height: '100%', borderRadius: 3, background: '#2563eb', transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ fontSize: 10, color: '#999', minWidth: 28, textAlign: 'right' }}>{progress}%</span>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid #2a2a2a', padding: '6px 10px', background: '#1a1a1a' }}>
        <button
          onClick={handleGenWorkflow}
          disabled={genRunning}
          style={{
            width: '100%',
            padding: '6px 0',
            borderRadius: 4,
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: genRunning ? 'not-allowed' : 'pointer',
            background: genRunning ? '#333' : '#4ade80',
            color: genRunning ? '#888' : '#0f0f0f',
          }}
        >
          {genRunning ? 'Generating...' : 'Generate ▶'}
        </button>
      </div>

      {/* Render all possible handles — hide inactive ones so React Flow registers them all */}
      {def.inputs.map((inp, i) => {
        const isActive = activeInputs.has(inp.id)
        const color = getHandleColor(inp.id, inp.type)
        const activeIdx = [...activeInputs].indexOf(inp.id)
        const top = activeIdx >= 0 ? `${((activeIdx + 1) / (activeInputs.size + 1)) * 100}%` : '50%'
        return (
          <Handle
            key={inp.id}
            type="target"
            position={Position.Left}
            id={inp.id}
            style={{
              top,
              background: color,
              opacity: isActive ? 1 : 0,
              pointerEvents: isActive ? 'auto' : 'none',
            }}
          >
            {isActive && (
              <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color, whiteSpace: 'nowrap' }}>
                {inp.label}
              </div>
            )}
          </Handle>
        )
      })}
      <Handle type="source" position={Position.Right} id="video_out" style={{ top: '50%', background: modelModality.outputColor }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: modelModality.outputColor, whiteSpace: 'nowrap' }}>
          {modelModality.outputLabel}
        </div>
      </Handle>
    </div>
  )
}

export default memo(GenerationNode)
