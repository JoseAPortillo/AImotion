import { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType, type GenerationData, type PromptData, type GroupNodeData } from '../../../types/nodes'
import NodeWrapper, { CollapsibleSection, InfoLabel, FIELD_DESCS } from '../NodeWrapper'
import { useGraphStore } from '../../../store/graph'
import { useToastStore } from '../../../store/toast'
import { startGeneration, pollTask, cancelTask, type TaskStatus } from '../../../api/backend'
import ModelSelect from '../../ModelSelect'
import NumberInput from '../../NumberInput'

const schedLabels: Record<string, string> = {
  cogvideox_ddim: 'DDIM',
  cogvideox_dpm: 'DPM',
  flow_match_euler: 'Flow Euler',
  ltx_euler_ancestral_rf: 'Euler Anc RF',
  ddim: 'DDIM',
  pndm: 'PNDM',
  euler: 'Euler',
  euler_ancestral: 'Euler Ancestral',
  dpm_multistep: 'DPM++',
  lcm: 'LCM',
  heun: 'Heun',
  lms_discrete: 'LMS',
  scheduler: 'Auto-detect',
}

interface ModelEntry {
  key: string
  name: string
  runner: string
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

function formatEta(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) {
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

type ResPreset = { label: string; w: number; h: number }

const MODEL_PRESETS: Record<string, ResPreset[]> = {
  'cogvideox': [
    { label: 'Custom', w: 0, h: 0 },
    { label: '640×480', w: 640, h: 480 },
    { label: '720×480 (native)', w: 720, h: 480 },
    { label: '800×480', w: 800, h: 480 },
    { label: '960×576', w: 960, h: 576 },
    { label: '1024×576', w: 1024, h: 576 },
    { label: '1280×720', w: 1280, h: 720 },
  ],
  'ltx-video': [
    { label: 'Custom', w: 0, h: 0 },
    { label: '512×512', w: 512, h: 512 },
    { label: '704×512 (native)', w: 704, h: 512 },
    { label: '768×512', w: 768, h: 512 },
    { label: '1024×576', w: 1024, h: 576 },
    { label: '1280×720', w: 1280, h: 720 },
    { label: '1920×1080', w: 1920, h: 1080 },
  ],
  'wan2.2': [
    { label: 'Custom', w: 0, h: 0 },
    { label: '720×480', w: 720, h: 480 },
    { label: '832×480', w: 832, h: 480 },
    { label: '1024×576', w: 1024, h: 576 },
    { label: '1280×720', w: 1280, h: 720 },
  ],
}

const DEFAULT_PRESETS: ResPreset[] = [
  { label: 'Custom', w: 0, h: 0 },
  { label: '512×512', w: 512, h: 512 },
  { label: '720×480', w: 720, h: 480 },
  { label: '768×512', w: 768, h: 512 },
  { label: '1024×576', w: 1024, h: 576 },
  { label: '1024×1024', w: 1024, h: 1024 },
  { label: '1280×720', w: 1280, h: 720 },
]

function presetsForModel(modelKey: string | undefined): ResPreset[] {
  if (!modelKey) return DEFAULT_PRESETS
  const prefix = Object.keys(MODEL_PRESETS).find(k => modelKey.startsWith(k))
  return prefix ? MODEL_PRESETS[prefix] : DEFAULT_PRESETS
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
  padding: '2px 4px',
  fontSize: 10,
  outline: 'none',
  width: '100%',
  marginTop: 3,
}

function DiffuserGeneratorNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as GenerationData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const setOutputUrl = useGraphStore((s) => s.setOutputUrl)
  const setNodeOutput = useGraphStore((s) => s.setNodeOutput)
  const addToast = useToastStore((s) => s.addToast)
  const [genRunning, setGenRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [etaSec, setEtaSec] = useState<number | null>(null)
  const startTimeRef = useRef(0)
  const taskIdRef = useRef('')
  const [models, setModels] = useState<ModelEntry[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)

  const fetchModels = useCallback(() => {
    fetch('/models')
      .then(r => r.json())
      .then(data => {
        const all = (data.models || []).filter(
          (m: ModelEntry) =>
            m.type !== 'future'
            && (m.type !== 'installable' || m.runner === 'diffusers' || m.runner === 'wan2.2')
        )
        setModels(all)
        setModelsLoaded(true)
      })
      .catch(() => setModelsLoaded(true))
  }, [])

  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  const visibleModels = models
  const modelConfig = visibleModels.find(m => m.key === data.model)
  const availableScheds = modelConfig?.schedulers || []
  const defaultSched = modelConfig?.default_scheduler || ''

  const activeInputs = useMemo(() => {
    const active = new Set<string>(['prompt_pos', 'prompt_neg'])
    if (!modelConfig?.accepts) return active
    if (modelConfig.accepts.image) active.add('image_in')
    if (modelConfig.accepts.video) active.add('video_in')
    return active
  }, [modelConfig])

  const modelModality = useMemo(() => getModelModality(modelConfig), [modelConfig])
  const schedLabel = data.scheduler
    ? schedLabels[data.scheduler] || data.scheduler
    : defaultSched
      ? `Default (${schedLabels[defaultSched] || defaultSched})`
      : 'Default'

  const handleModelChange = useCallback((key: string) => {
    const cfg = models.find(m => m.key === key)
    const defs = cfg?.defaults || {}
    const inputs = cfg?.inputs || {}
    const update: Partial<GenerationData> = {
      model: key,
      scheduler: cfg?.default_scheduler || '',
    }
    if (inputs.steps && defs.steps != null) update.steps = defs.steps as number
    if (inputs.cfg && defs.cfg != null) update.cfg = defs.cfg as number
    if (inputs.strength && defs.strength != null) update.strength = defs.strength as number
    if (inputs.width && defs.width != null) update.width = defs.width as number
    if (inputs.height && defs.height != null) update.height = defs.height as number
    if (inputs.num_frames && defs.num_frames != null) update.num_frames = defs.num_frames as number
    if (inputs.max_sequence_length && defs.max_seq != null) update.max_sequence_length = defs.max_seq as number
    updateNodeData(props.id, update)
  }, [props.id, models, updateNodeData])

  const handleGenWorkflow = useCallback(async () => {
    const genEdges = edges.filter((e) => e.target === props.id)
    const getNode = (edge: typeof genEdges[0]) => nodes.find((n) => n.id === edge.source)

    const promptEdgePos = genEdges.find((e) => e.targetHandle === 'prompt_pos')
    const promptEdgeNeg = genEdges.find((e) => e.targetHandle === 'prompt_neg')
    const videoEdge = genEdges.find((e) => e.targetHandle === 'video_in')
    const imageEdge = genEdges.find((e) => e.targetHandle === 'image_in')

    console.log('[DiffuserGen] Edges to this node:', genEdges.map(e => ({ source: e.source, targetHandle: e.targetHandle })))
    console.log('[DiffuserGen] Image edge found:', imageEdge)

    const promptData = promptEdgePos ? getNode(promptEdgePos)?.data as PromptData | undefined : undefined
    const videoNode = videoEdge ? getNode(videoEdge) : undefined
    const imageNode = imageEdge ? getNode(imageEdge) : undefined

    console.log('[DiffuserGen] Image node:', imageNode)
    console.log('[DiffuserGen] Image node data:', imageNode?.data)
    
    const resolveNodeFile = async (sourceNodeId: string, visited?: Set<string>): Promise<File | undefined> => {
      const store = useGraphStore.getState()
      const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
      if (!sourceNode) return undefined

      const nd = sourceNode.data as Record<string, unknown>
      if (nd.file instanceof File) return nd.file
      if (nd.fileDataUrl) {
        const r = await fetch(nd.fileDataUrl as string)
        const blob = await r.blob()
        return new File([blob], (nd.fileName as string) || 'file', { type: blob.type })
      }

      const output = store.nodeOutputs[sourceNodeId]
      if (output?.url) {
        const r = await fetch(output.url)
        const blob = await r.blob()
        return new File([blob], 'output', { type: blob.type })
      }

      if (sourceNode.type === 'groupNode') {
        const childIds = (sourceNode.data as GroupNodeData).childIds || []
        for (const cid of childIds) {
          const co = store.nodeOutputs[cid]
          if (co?.url) {
            const r = await fetch(co.url)
            const blob = await r.blob()
            return new File([blob], 'group-output', { type: blob.type })
          }
        }
      }

      if (sourceNode.type === 'preview' || sourceNode.type === 'groupNode') {
        const guard = visited ?? new Set<string>()
        if (guard.has(sourceNodeId)) return undefined
        guard.add(sourceNodeId)
        const incoming = store.edges.find((e) => e.target === sourceNodeId)
        if (incoming) return resolveNodeFile(incoming.source, guard)
      }

      return undefined
    }
    
    const imageFile = imageEdge ? await resolveNodeFile(imageEdge.source) : undefined
    const videoFile = videoEdge ? await resolveNodeFile(videoEdge.source) : undefined
    console.log('[DiffuserGen] Image file to send:', imageFile)
    console.log('[DiffuserGen] Video file to send:', videoFile)

    const isSVD = data.model?.includes('stable_video_diffusion')
    if (!isSVD && !promptData?.positive) {
      addToast('Connect a Prompt node to this node', 'info')
      return
    }
    if (isSVD && !imageNode?.data) {
      addToast('Connect an Image Input node for SVD models', 'info')
      return
    }

    const extraParams: Record<string, number | string | boolean> = {}
    if (modelConfig?.inputs) {
      const fixedFields = new Set(['width', 'height', 'steps', 'cfg', 'strength', 'seed', 'scheduler', 'model', 'vae_tiling', 'vae_tile_overlap', 'num_frames', 'max_sequence_length', 'decode_chunk_size', 'noise_aug_strength', 'min_guidance_scale', 'max_guidance_scale', 'fps', 'motion_bucket_id'])
      for (const [name, inp] of Object.entries(modelConfig.inputs)) {
        if (inp.hidden) continue
        if (fixedFields.has(name)) continue
        if (inp.type !== 'int' && inp.type !== 'float') continue
        const val = (data as Record<string, unknown>)[name]
        if (val !== undefined && val !== null) {
          extraParams[name] = val as number
        }
      }
    }

    flushSync(() => {
      setGenRunning(true)
      setProgress(0)
      setEtaSec(null)
    })
    startTimeRef.current = Date.now()
    taskIdRef.current = ''
    try {
      const task = await startGeneration(
        promptData?.positive || '',
        promptEdgeNeg ? (getNode(promptEdgeNeg)?.data as PromptData | undefined)?.negative || '' : '',
        {
          width: data.width ?? 720,
          height: data.height ?? 480,
          steps: data.steps ?? 50,
          cfg: data.cfg ?? 6,
          strength: data.strength ?? 0.8,
          seed: data.seed ?? 0,
          scheduler: data.scheduler || '',
          model: data.model || 'cogvideox-2b',
          execution_mode: data.execution_mode || 'local',
          vae_tiling: data.vae_tiling ?? true,
          vae_tile_overlap: data.vae_tile_overlap ?? 0.0,
          num_frames: data.num_frames,
          max_sequence_length: data.max_sequence_length,
          noise_aug_strength: data.noise_aug_strength,
          fps: data.fps,
          motion_bucket_id: data.motion_bucket_id,
          min_guidance_scale: data.min_guidance_scale,
          max_guidance_scale: data.max_guidance_scale,
          extraParams,
        },
        videoFile,
        imageFile,
      )

      taskIdRef.current = task.task_id
      let status: TaskStatus
      do {
        await new Promise((r) => setTimeout(r, 2000))
        status = await pollTask(task.task_id)

        if (status.status === 'cancelled') break

        if (status.current_step != null && status.total_steps != null && status.total_steps > 0) {
          setProgress(Math.round((status.current_step / status.total_steps) * 100))
          const elapsed = (Date.now() - startTimeRef.current) / 1000
          if (status.current_step > 0 && elapsed > 0) {
            const stepsRemaining = status.total_steps - status.current_step
            setEtaSec((stepsRemaining * elapsed) / status.current_step)
          }
        } else if (status.progress != null) {
          setProgress(Math.round(status.progress * 100))
          const elapsed = (Date.now() - startTimeRef.current) / 1000
          if (status.progress > 0 && elapsed > 0) {
            setEtaSec((elapsed / status.progress) * (1 - status.progress))
          }
        }
      } while (status.status === 'pending' || status.status === 'running')

      if (status.status === 'cancelled') {
        addToast('Generation cancelled', 'info')
      } else if (status.status === 'completed' && status.result_url) {
        setProgress(100)
        setEtaSec(null)
        setOutputUrl(status.result_url, status.result_type)
        setNodeOutput(props.id, status.result_url, status.result_type || 'image')
      } else {
        addToast(`Workflow failed: ${status.error || 'unknown error'}`, 'error')
      }
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error')
    } finally {
      setGenRunning(false)
      setEtaSec(null)
    }
  }, [props.id, data, nodes, edges, setOutputUrl, setNodeOutput])

  const handleCancel = useCallback(async () => {
    if (!taskIdRef.current) return
    setEtaSec(null)
    try {
      await cancelTask(taskIdRef.current)
    } catch { /* ignore */ }
  }, [])

  return (
    <NodeWrapper def={def} selected={props.selected} style={{ width: props.width, height: props.height }} headerRight={modelConfig && (
      <span style={{ fontSize: 9, opacity: 0.8, background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: 3 }}>
        {modelModality.label}
      </span>
    )} handles={
      <>
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
                <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color, whiteSpace: 'nowrap' }}>
                  {inp.label}
                </div>
              )}
            </Handle>
          )
        })}
        <Handle type="source" position={Position.Right} id="video_out" style={{ top: '50%', background: modelModality.outputColor }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: modelModality.outputColor, whiteSpace: 'nowrap' }}>
            {modelModality.outputLabel}
          </div>
        </Handle>
      </>
    } progressBar={genRunning && (
      <div style={{ padding: '4px 6px', borderTop: '1px solid #2a2a2a', background: '#1a1a1a', flexShrink: 0 }}>
        {etaSec != null && (
          <div style={{ fontSize: 9, color: '#2563eb', marginBottom: 2, fontVariantNumeric: 'tabular-nums' }}>
            ETA {formatEta(etaSec)}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#2a2a2a', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(progress, 100)}%`, height: '100%', borderRadius: 2, background: '#2563eb', transition: 'width 0.3s ease' }} />
          </div>
          <span style={{ fontSize: 9, color: '#999', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{progress}%</span>
        </div>
      </div>
    )} footer={
      genRunning ? (
        <button
          onClick={handleCancel}
          style={{
            width: '100%',
            padding: '4px 0',
            borderRadius: 4,
            border: 'none',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            background: '#ef4444',
            color: '#fff',
          }}
        >
          Cancel
        </button>
      ) : (
        <button
          onClick={handleGenWorkflow}
          style={{
            width: '100%',
            padding: '4px 0',
            borderRadius: 4,
            border: 'none',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            background: '#4ade80',
            color: '#0f0f0f',
          }}
        >
          Generate ▶
        </button>
      )
    }>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ModelSelect
              value={data.model}
              models={visibleModels}
              onChange={handleModelChange}
              placeholder={modelsLoaded ? 'No models available' : 'Loading...'}
            />
          </div>
        </div>

        {modelConfig && (
          <div style={{ marginTop: 4, padding: 4, background: '#131313', borderRadius: 4, fontSize: 9, color: '#777', lineHeight: 1.5 }}>
            <div style={{ color: '#999', fontWeight: 600 }}>{modelConfig.name}</div>
            {modelConfig.pipeline_class && <div style={{ color: '#666' }}>{modelConfig.pipeline_class}</div>}
            {modelConfig.defaults && (
              <div style={{ marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
                {Object.entries(modelConfig.defaults)
                  .filter(([k]) => !['num_frames', 'width', 'height'].includes(k))
                  .slice(0, 4)
                  .map(([k, v]) => (
                    <span key={k} style={{ color: '#555' }}>{k}: <span style={{ color: '#888' }}>{String(v)}</span></span>
                  ))}
              </div>
            )}
          </div>
        )}

        <CollapsibleSection title="Scheduler" defaultOpen={true}>
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
          {schedLabel && <div style={{ marginTop: 1, fontSize: 9, color: '#888' }}>Current: {schedLabel}</div>}
        </CollapsibleSection>

        <CollapsibleSection title="Básicos" defaultOpen={true}>
          <div style={{ marginTop: 2 }}>
            <InfoLabel label="Steps" desc={FIELD_DESCS.steps} />
            <NumberInput
              value={data.steps ?? 50}
              min={1} max={200}
              onChange={(v) => updateNodeData(props.id, { steps: v } as Partial<GenerationData>)}
            />
          </div>
          <div style={{ marginTop: 4 }}>
            <InfoLabel label="CFG" desc={FIELD_DESCS.cfg} />
            <NumberInput
              value={data.cfg ?? 6}
              min={1} max={20} step={0.5}
              onChange={(v) => updateNodeData(props.id, { cfg: v } as Partial<GenerationData>)}
            />
          </div>
          <div style={{ marginTop: 4 }}>
            <InfoLabel label="Seed" desc={FIELD_DESCS.seed} />
            <NumberInput
              value={data.seed ?? 0}
              min={0}
              onChange={(v) => updateNodeData(props.id, { seed: v } as Partial<GenerationData>)}
            />
          </div>
          <div style={{ marginTop: 4 }}>
            <InfoLabel label="Strength" desc={FIELD_DESCS.strength} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={data.strength ?? 0.8}
                onChange={(e) => updateNodeData(props.id, { strength: parseFloat(e.target.value) } as Partial<GenerationData>)}
                style={{ flex: 1, marginTop: 1 }}
              />
              <span style={{ fontSize: 9, color: '#999', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {(data.strength ?? 0.8).toFixed(2)}
              </span>
            </div>
          </div>
          {modelConfig?.inputs?.width && modelConfig?.inputs?.height && (() => {
            const wInp = modelConfig!.inputs!.width!
            const hInp = modelConfig!.inputs!.height!
            const availablePresets = presetsForModel(data.model).filter(p => p.w === 0 || (
              p.w >= (wInp.min ?? 0) &&
              p.w <= (wInp.max ?? 99999) &&
              p.h >= (hInp.min ?? 0) &&
              p.h <= (hInp.max ?? 99999)
            ))
            const currentW = data.width ?? wInp.default ?? 0
            const currentH = data.height ?? hInp.default ?? 0
            const matchedPreset = availablePresets.find(p => p.w === currentW && p.h === currentH)
            return (
              <div key="wh-group" style={{ marginTop: 4 }}>
                <div style={{ marginTop: 4 }}>
                  <InfoLabel label="Resolution" desc={`${FIELD_DESCS.width} | ${FIELD_DESCS.height}`} />
                  <select
                    value={matchedPreset ? matchedPreset.label : 'Custom'}
                    onChange={(e) => {
                      const preset = presetsForModel(data.model).find(p => p.label === e.target.value)
                      if (preset && preset.w > 0) {
                        updateNodeData(props.id, { width: preset.w, height: preset.h } as Partial<GenerationData>)
                      }
                    }}
                    style={selectStyle}
                  >
                    {availablePresets.map(p => (
                      <option key={p.label} value={p.label}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 8, color: '#888' }}>width</span>
                    <NumberInput
                      value={currentW}
                      min={wInp.min} max={wInp.max}
                      onChange={(v) => updateNodeData(props.id, { width: v } as Partial<GenerationData>)}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 8, color: '#888' }}>height</span>
                    <NumberInput
                      value={currentH}
                      min={hInp.min} max={hInp.max}
                      onChange={(v) => updateNodeData(props.id, { height: v } as Partial<GenerationData>)}
                    />
                  </div>
                </div>
              </div>
            )
          })()}
        </CollapsibleSection>

        <CollapsibleSection title="Avanzados" defaultOpen={false}>
          <div style={{ marginTop: 2 }}>
            <label style={{ fontSize: 9, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={data.vae_tiling}
                onChange={(e) => updateNodeData(props.id, { vae_tiling: e.target.checked } as Partial<GenerationData>)}
              />
              <span title={FIELD_DESCS.vae_tiling} style={{ borderBottom: '1px dotted #555', cursor: 'help' }}>VAE Tiling</span>
            </label>
            {data.vae_tiling && (
              <div style={{ marginTop: 2 }}>
                <span style={{ fontSize: 8, color: '#888' }}>Tile Overlap: {data.vae_tile_overlap > 0 ? data.vae_tile_overlap : 'VAE default'}</span>
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.1"
                  value={data.vae_tile_overlap}
                  onChange={(e) => updateNodeData(props.id, { vae_tile_overlap: parseFloat(e.target.value) } as Partial<GenerationData>)}
                  style={{ width: '100%', marginTop: 1 }}
                />
              </div>
            )}
          </div>
          {Object.entries(modelConfig?.inputs ?? {})
            .filter(([name, inp]) => !inp.hidden && (inp.type === 'int' || inp.type === 'float') && inp.default != null && name !== 'width' && name !== 'height')
            .map(([name, inp]) => {
              const isFloat = inp.type === 'float'
              const desc = FIELD_DESCS[name]
              return (
                <div key={name} style={{ marginTop: 4 }}>
                  <InfoLabel label={name.replace(/_/g, ' ')} desc={desc} />
                  <NumberInput
                    value={(data[name as keyof GenerationData] ?? inp.default) as number}
                    min={inp.min}
                    max={inp.max}
                    step={isFloat ? 0.01 : 1}
                    onChange={(v) => updateNodeData(props.id, { [name]: v } as Partial<GenerationData>)}
                  />
                </div>
              )
            })}
        </CollapsibleSection>
      </div>
    </NodeWrapper>
  )
}

export default memo(DiffuserGeneratorNode)
