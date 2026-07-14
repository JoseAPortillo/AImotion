import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { startGeneration, pollTask, cancelTask } from '../api/backend'
import { useGraphStore } from '../store/graph'
import type { GenerationData, PromptData, ModelEntry, GroupNodeData } from '../types/nodes'

interface UseAutoPreviewOptions {
  nodeId: string
  data: GenerationData
}

export function useAutoPreview({ nodeId, data }: UseAutoPreviewOptions) {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const autoPreviews = useGraphStore((s) => s.autoPreviews)
  const setAutoPreview = useGraphStore((s) => s.setAutoPreview)

  const [previewUrl, setPreviewUrl] = useState<string | null>(() => {
    const existing = autoPreviews[nodeId]
    return existing?.url ?? null
  })

  const [previewType, setPreviewType] = useState<'image' | 'video' | null>(() => {
    const existing = autoPreviews[nodeId]
    return existing?.type ?? null
  })

  useEffect(() => {
    const existing = autoPreviews[nodeId]
    if (existing?.url) {
      setPreviewUrl(existing.url)
      setPreviewType(existing.type)
    }
  }, [autoPreviews, nodeId])
  const [previewRunning, setPreviewRunning] = useState(false)
  const [previewProgress, setPreviewProgress] = useState(0)
  const [previewCurrentStep, setPreviewCurrentStep] = useState(0)
  const [previewTotalSteps, setPreviewTotalSteps] = useState(0)
  const [previewEtaSec, setPreviewEtaSec] = useState<number | null>(null)

  const taskIdRef = useRef('')
  const previewStartRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef(false)
  const lastKeyRef = useRef('')

  const previewDeps = useMemo(() => {
    const genEdges = edges.filter((e) => e.target === nodeId)
    const promptEdge = genEdges.find((e) => e.targetHandle === 'prompt_pos')
    const promptNode = promptEdge ? nodes.find((n) => n.id === promptEdge.source) : undefined
    const pd = promptNode?.data as Record<string, unknown> | undefined
    const promptText = (typeof pd?.positive === 'string' && pd.positive) || (typeof pd?.result === 'string' && pd.result) || (typeof pd?.text === 'string' && pd.text) || ''
    const negEdge = genEdges.find((e) => e.targetHandle === 'prompt_neg')
    const negNode = negEdge ? nodes.find((n) => n.id === negEdge.source) : undefined
    const negText = (negNode?.data as PromptData)?.negative || ''
    const hasImage = genEdges.some((e) => e.targetHandle === 'image_in')
    const hasVideo = genEdges.some((e) => e.targetHandle === 'video_in')
    return `${data.model}|${data.seed}|${data.cfg}|${data.strength}|${data.scheduler}|${data.width}|${data.height}|${promptText}|${negText}|${hasImage}|${hasVideo}`
  }, [edges, nodes, nodeId, data.model, data.seed, data.cfg, data.strength, data.scheduler, data.width, data.height])

  function getPreviewParams(): Record<string, unknown> {
    const genEdges = edges.filter((e) => e.target === nodeId)
    const hasImage = genEdges.some((e) => e.targetHandle === 'image_in')
    const hasVideo = genEdges.some((e) => e.targetHandle === 'video_in')
    const isVideo = hasVideo || (data.num_frames ?? 0) > 1

    const isI2V = isVideo && hasImage

    let pw: number, ph: number
    if (isI2V) {
      pw = (data.width ?? 720)
      ph = (data.height ?? 480)
    } else {
      const maxDim = 640
      const scale = Math.min(1, maxDim / Math.max(data.width ?? 720, data.height ?? 480))
      pw = Math.max(64, Math.round(((data.width ?? 720) * scale) / 8) * 8)
      ph = Math.max(64, Math.round(((data.height ?? 480) * scale) / 8) * 8)
    }

    const previewFrames = isVideo ? (() => {
      const capped = Math.min(data.num_frames ?? 49, 6)
      if (data.model?.includes('cogvideox')) {
        return 5
      }
      return Math.max(2, capped)
    })() : undefined

    return {
      width: pw,
      height: ph,
      steps: Math.max(2, Math.round((data.steps ?? 50) / 2)),
      cfg: data.cfg ?? 6,
      strength: isVideo ? Math.min(data.strength ?? 0.8, 0.6) : (data.strength ?? 0.8),
      seed: data.seed ?? 0,
      scheduler: data.scheduler || '',
      model: data.model,
      execution_mode: data.execution_mode || 'local',
      vae_tiling: data.vae_tiling ?? true,
      vae_tile_overlap: data.vae_tile_overlap ?? 0.0,
      num_frames: previewFrames,
      max_sequence_length: data.max_sequence_length,
      noise_aug_strength: data.noise_aug_strength,
      fps: data.fps,
      motion_bucket_id: data.motion_bucket_id,
      min_guidance_scale: data.min_guidance_scale,
      max_guidance_scale: data.max_guidance_scale,
    }
  }

  const run = useCallback(async () => {
    if (!data.model) return

    const genEdges = edges.filter((e) => e.target === nodeId)
    const getNode = (edge: typeof genEdges[0]) => nodes.find((n) => n.id === edge.source)

    const promptEdgePos = genEdges.find((e) => e.targetHandle === 'prompt_pos')
    const promptEdgeNeg = genEdges.find((e) => e.targetHandle === 'prompt_neg')
    const videoEdge = genEdges.find((e) => e.targetHandle === 'video_in')
    const imageEdge = genEdges.find((e) => e.targetHandle === 'image_in')

    const promptData = promptEdgePos ? getNode(promptEdgePos)?.data as Record<string, unknown> | undefined : undefined
    const promptText = (typeof promptData?.positive === 'string' && promptData.positive) || (typeof promptData?.result === 'string' && promptData.result) || (typeof promptData?.text === 'string' && promptData.text) || ''
    if (!promptText) return

    const isI2V = /i2v/i.test(data.model ?? '')
    if (isI2V && !imageEdge) {
      console.warn('[auto-preview] Model', data.model, 'requires image input but no image_in edge — skipping')
      return
    }

    const getFileFromNodeData = async (nodeData: any): Promise<File | undefined> => {
      if (!nodeData) return undefined
      if (nodeData.file instanceof File) return nodeData.file
      if (nodeData.fileDataUrl) {
        const r = await fetch(nodeData.fileDataUrl)
        const blob = await r.blob()
        return new File([blob], nodeData.fileName || 'file', { type: blob.type })
      }
      return undefined
    }

    const resolveNodeFile = async (sourceNodeId: string, visited?: Set<string>): Promise<File | undefined> => {
      const store = useGraphStore.getState()
      const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
      if (!sourceNode) return undefined

      const file = await getFileFromNodeData(sourceNode.data)
      if (file) return file

      const output = store.nodeOutputs[sourceNodeId]
      if (output?.url) {
        const r = await fetch(output.url)
        const blob = await r.blob()
        return new File([blob], 'output', { type: blob.type })
      }

      if (sourceNode.type === 'groupNode') {
        const childIds = (sourceNode.data as GroupNodeData).childIds || []
        for (const cid of childIds) {
          const childOutput = store.nodeOutputs[cid]
          if (childOutput?.url) {
            const r = await fetch(childOutput.url)
            const blob = await r.blob()
            return new File([blob], 'group-output', { type: blob.type })
          }
        }
      }

      if (sourceNode.type === 'preview' || sourceNode.type === 'groupNode') {
        const cycleGuard = visited ?? new Set<string>()
        if (cycleGuard.has(sourceNodeId)) return undefined
        cycleGuard.add(sourceNodeId)
        const incoming = store.edges.find((e) => e.target === sourceNodeId)
        if (incoming) {
          return resolveNodeFile(incoming.source, cycleGuard)
        }
      }

      return undefined
    }

    const imageFile = imageEdge ? await resolveNodeFile(imageEdge.source) : undefined
    const videoFile = videoEdge ? await resolveNodeFile(videoEdge.source) : undefined

    abortRef.current = true
    if (taskIdRef.current) {
      try { await cancelTask(taskIdRef.current) } catch { /* ignore */ }
    }
    abortRef.current = false

    if (!imageFile && isI2V) {
      console.warn('[auto-preview] I2V model but image file not resolved — skipping')
      setPreviewRunning(false)
      return
    }

    setPreviewRunning(true)
    setPreviewProgress(0)
    setPreviewCurrentStep(0)
    setPreviewTotalSteps(0)
    setPreviewEtaSec(null)
    previewStartRef.current = Date.now()
    try {
      const previewParams = getPreviewParams()
      console.log('[auto-preview] sending:', { model: previewParams.model, width: previewParams.width, height: previewParams.height, steps: previewParams.steps, hasImage: !!imageFile, hasVideo: !!videoFile })
      const task = await startGeneration(
        promptText,
        promptEdgeNeg ? (getNode(promptEdgeNeg)?.data as PromptData | undefined)?.negative || '' : '',
        previewParams as Parameters<typeof startGeneration>[2],
        videoFile,
        imageFile,
      )

      taskIdRef.current = task.task_id
      const pollInterval = previewParams.num_frames && (previewParams.num_frames as number) > 1 ? 3000 : 1500
      let status: any
      do {
        await new Promise((r) => setTimeout(r, pollInterval))
        if (abortRef.current) break
        status = await pollTask(task.task_id)
        if (status.status === 'cancelled') break
        if (status.current_step != null) setPreviewCurrentStep(status.current_step)
        if (status.total_steps != null) setPreviewTotalSteps(status.total_steps)
        if (status.progress != null) setPreviewProgress(status.progress)
        if (status.progress != null && status.progress > 0) {
          const elapsed = (Date.now() - previewStartRef.current) / 1000
          setPreviewEtaSec((elapsed / status.progress) * (1 - status.progress))
        }
      } while (status.status === 'pending' || status.status === 'running')

      if (!abortRef.current && status && status.status === 'completed' && status.result_url) {
        const rtype = status.result_type || 'image'
        setPreviewUrl(status.result_url)
        setPreviewType(rtype)
        setAutoPreview(nodeId, status.result_url, rtype)
      }
    } catch (e: any) {
      console.error('[auto-preview] generation failed:', e?.message || e)
    } finally {
      setPreviewRunning(false)
    }
  }, [nodeId, data, nodes, edges, setAutoPreview])

  const cancel = useCallback(() => {
    abortRef.current = true
    if (taskIdRef.current) {
      cancelTask(taskIdRef.current).catch(() => {})
    }
    setPreviewRunning(false)
    setPreviewProgress(0)
    setPreviewCurrentStep(0)
    setPreviewTotalSteps(0)
    setPreviewEtaSec(null)
    setPreviewUrl(null)
    setPreviewType(null)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!data.model) return
    if (!previewDeps) return
    if (previewDeps === lastKeyRef.current) return
    lastKeyRef.current = previewDeps

    if (timerRef.current) clearTimeout(timerRef.current)

    const hasPrompt = previewDeps.split('|')[7]
    if (!hasPrompt) return

    timerRef.current = setTimeout(() => {
      run()
    }, 2500)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [previewDeps, data.model, run])

  return {
    previewUrl,
    previewType,
    previewRunning,
    previewProgress,
    previewCurrentStep,
    previewTotalSteps,
    previewEtaSec,
    cancelAutoPreview: cancel,
  }
}
