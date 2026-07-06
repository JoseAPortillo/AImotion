import { useCallback, useMemo, useState, useEffect, useRef } from 'react'
import { startGeneration, pollTask, cancelTask } from '../api/backend'
import { useGraphStore } from '../store/graph'
import type { GenerationData, PromptData, ModelEntry } from '../types/nodes'

interface UseAutoPreviewOptions {
  nodeId: string
  data: GenerationData
}

export function useAutoPreview({ nodeId, data }: UseAutoPreviewOptions) {
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
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

    const videoNode = videoEdge ? getNode(videoEdge) : undefined
    const imageNode = imageEdge ? getNode(imageEdge) : undefined

    const getFileFromNodeData = async (n: any): Promise<File | undefined> => {
      if (!n?.data) return undefined
      if (n.data.file instanceof File) return n.data.file
      if (n.data.fileDataUrl) {
        const r = await fetch(n.data.fileDataUrl)
        const blob = await r.blob()
        return new File([blob], n.data.fileName || 'file', { type: blob.type })
      }
      return undefined
    }

    const imageFile = await getFileFromNodeData(imageNode)
    const videoFile = await getFileFromNodeData(videoNode)

    abortRef.current = true
    if (taskIdRef.current) {
      try { await cancelTask(taskIdRef.current) } catch { /* ignore */ }
    }
    abortRef.current = false

    setPreviewRunning(true)
    try {
      const task = await startGeneration(
        promptText,
        promptEdgeNeg ? (getNode(promptEdgeNeg)?.data as PromptData | undefined)?.negative || '' : '',
        {
          width: data.width ?? 720,
          height: data.height ?? 480,
          steps: 12,
          cfg: data.cfg ?? 6,
          strength: data.strength ?? 0.8,
          seed: data.seed ?? 0,
          scheduler: data.scheduler || '',
          model: data.model,
          execution_mode: data.execution_mode || 'local',
          vae_tiling: data.vae_tiling ?? true,
          vae_tile_overlap: data.vae_tile_overlap ?? 0.0,
          num_frames: data.num_frames,
          max_sequence_length: data.max_sequence_length,
          noise_aug_strength: data.noise_aug_strength ?? (data.strength ?? 0.8),
          fps: data.fps,
          motion_bucket_id: data.motion_bucket_id,
          min_guidance_scale: data.min_guidance_scale,
          max_guidance_scale: data.max_guidance_scale,
        },
        videoFile,
        imageFile,
      )

      taskIdRef.current = task.task_id
      let status: any
      do {
        await new Promise((r) => setTimeout(r, 1500))
        if (abortRef.current) break
        status = await pollTask(task.task_id)
        if (status.status === 'cancelled') break
      } while (status.status === 'pending' || status.status === 'running')

      if (!abortRef.current && status && status.status === 'completed' && status.result_url) {
        setPreviewUrl(status.result_url)
      }
    } catch {
      // silent
    } finally {
      setPreviewRunning(false)
    }
  }, [nodeId, data, nodes, edges])

  const cancel = useCallback(() => {
    abortRef.current = true
    if (taskIdRef.current) {
      cancelTask(taskIdRef.current).catch(() => {})
    }
    setPreviewRunning(false)
    setPreviewUrl(null)
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
    previewRunning,
    cancelAutoPreview: cancel,
  }
}
