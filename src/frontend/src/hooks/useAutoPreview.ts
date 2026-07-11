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

  const taskIdRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef(false)
  const lastKeyRef = useRef('')

  const previewDeps = useMemo(() => {
    const genEdges = edges.filter((e) => e.target === nodeId)
    const promptEdge = genEdges.find((e) => e.targetHandle === 'prompt_pos')
    const promptNode = promptEdge ? nodes.find((n) => n.id === promptEdge.source) : undefined
    const promptText = (promptNode?.data as PromptData)?.positive || ''
    const negEdge = genEdges.find((e) => e.targetHandle === 'prompt_neg')
    const negNode = negEdge ? nodes.find((n) => n.id === negEdge.source) : undefined
    const negText = (negNode?.data as PromptData)?.negative || ''
    const hasImage = genEdges.some((e) => e.targetHandle === 'image_in')
    const hasVideo = genEdges.some((e) => e.targetHandle === 'video_in')
    return `${data.model}|${data.seed}|${data.cfg}|${data.strength}|${data.scheduler}|${data.width}|${data.height}|${promptText}|${negText}|${hasImage}|${hasVideo}`
  }, [edges, nodes, nodeId, data.model, data.seed, data.cfg, data.strength, data.scheduler, data.width, data.height])

  function getPreviewParams(): Record<string, unknown> {
    const genEdges = edges.filter((e) => e.target === nodeId)
    const hasVideo = genEdges.some((e) => e.targetHandle === 'video_in')
    const isVideo = hasVideo || (data.num_frames ?? 0) > 1

    const maxDim = 384
    const scale = Math.min(1, maxDim / Math.max(data.width ?? 720, data.height ?? 480))
    const pw = Math.round((data.width ?? 720) * scale)
    const ph = Math.round((data.height ?? 480) * scale)

    return {
      width: pw,
      height: ph,
      steps: isVideo ? 12 : 6,
      cfg: data.cfg ?? 6,
      strength: data.strength ?? 0.8,
      seed: data.seed ?? 0,
      scheduler: data.scheduler || '',
      model: data.model,
      execution_mode: data.execution_mode || 'local',
      vae_tiling: data.vae_tiling ?? true,
      vae_tile_overlap: data.vae_tile_overlap ?? 0.0,
      num_frames: isVideo ? Math.min(data.num_frames ?? 49, 8) : undefined,
      max_sequence_length: data.max_sequence_length,
      noise_aug_strength: data.noise_aug_strength ?? (data.strength ?? 0.8),
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

    const promptData = promptEdgePos ? getNode(promptEdgePos)?.data as PromptData | undefined : undefined
    const promptText = promptData?.positive || ''
    if (!promptText) return

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

    setPreviewRunning(true)
    try {
      const previewParams = getPreviewParams()
      console.log('[auto-preview] sending:', { model: previewParams.model, width: previewParams.width, height: previewParams.height, steps: previewParams.steps })
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

    const hasPrompt = previewDeps.split('|')[5]
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
    cancelAutoPreview: cancel,
  }
}
