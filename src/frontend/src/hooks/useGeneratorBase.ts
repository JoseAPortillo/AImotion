import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'
import type { GenerationData, PromptData, ModelEntry } from '../types/nodes'
import { useGraphStore } from '../store/graph'
import { useToastStore } from '../store/toast'
import { startGeneration, pollTask, cancelTask, type TaskStatus } from '../api/backend'
import { resolveNodeFile } from '../utils/resolveNodeFile'

export const schedLabels: Record<string, string> = {
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

export function formatEta(sec: number): string {
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

export interface UseGeneratorBaseOptions {
  nodeId: string
  data: GenerationData
  modalityFilter: (model: ModelEntry) => boolean
}

export function useGeneratorBase({ nodeId, data, modalityFilter }: UseGeneratorBaseOptions) {
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const setOutputUrl = useGraphStore((s) => s.setOutputUrl)
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
      .then(d => {
        const all = (d.models || []).filter(
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

  const visibleModels = useMemo(() =>
    models.filter(m => modalityFilter(m)),
    [models, modalityFilter],
  )

  const modelConfig = visibleModels.find(m => m.key === data.model)
  const availableScheds = modelConfig?.schedulers || []
  const defaultSched = modelConfig?.default_scheduler || ''
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
    updateNodeData(nodeId, update)
  }, [nodeId, models, updateNodeData])

  const handleGenWorkflow = useCallback(async () => {
    const genEdges = edges.filter((e) => e.target === nodeId)
    const getNode = (edge: typeof genEdges[0]) => nodes.find((n) => n.id === edge.source)

    const promptEdgePos = genEdges.find((e) => e.targetHandle === 'prompt_pos')
    const promptEdgeNeg = genEdges.find((e) => e.targetHandle === 'prompt_neg')
    const videoEdge = genEdges.find((e) => e.targetHandle === 'video_in')
    const imageEdge = genEdges.find((e) => e.targetHandle === 'image_in')
    const poseVideoEdge = genEdges.find((e) => e.targetHandle === 'pose_video_in')
    const faceVideoEdge = genEdges.find((e) => e.targetHandle === 'face_video_in')

    const promptData = promptEdgePos ? getNode(promptEdgePos)?.data as PromptData | undefined : undefined
    const videoNode = videoEdge ? getNode(videoEdge) : undefined
    const imageNode = imageEdge ? getNode(imageEdge) : undefined

    const imageFile = imageEdge ? await resolveNodeFile(imageEdge.source) : undefined
    const videoFile = videoEdge ? await resolveNodeFile(videoEdge.source) : undefined
    const poseVideoFile = poseVideoEdge ? await resolveNodeFile(poseVideoEdge.source) : undefined
    const faceVideoFile = faceVideoEdge ? await resolveNodeFile(faceVideoEdge.source) : undefined

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

    const ratioVal = (data as any).targetAspectRatio
    if (ratioVal) extraParams.targetAspectRatio = ratioVal
    const durationVal = (data as any).duration
    if (durationVal != null) extraParams.duration = durationVal

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
        poseVideoFile,
        faceVideoFile,
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
        useGraphStore.getState().setNodeOutput(nodeId, status.result_url, status.result_type || 'image')
      } else {
        addToast(`Workflow failed: ${status.error || 'unknown error'}`, 'error')
      }
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error')
    } finally {
      setGenRunning(false)
      setEtaSec(null)
    }
  }, [nodeId, data, nodes, edges, setOutputUrl, modelConfig, addToast])

  const handleCancel = useCallback(async () => {
    if (!taskIdRef.current) return
    setEtaSec(null)
    try {
      await cancelTask(taskIdRef.current)
    } catch { /* ignore */ }
  }, [])

  return {
    models,
    modelsLoaded,
    visibleModels,
    modelConfig,
    genRunning,
    progress,
    etaSec,
    availableScheds,
    defaultSched,
    schedLabel,
    handleModelChange,
    handleGenWorkflow,
    handleCancel,
    updateNodeData,
    nodes,
    edges,
    setOutputUrl,
    addToast,
  }
}
