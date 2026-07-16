export interface HealthResponse {
  status: string
  gpu_name?: string
  vram_free_gb?: number
}

export interface TaskResponse {
  task_id: string
  status: string
}

export interface TaskStatus {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress?: number
  current_step?: number
  total_steps?: number
  result_url?: string
  result_type?: 'image' | 'video'
  error?: string
  eta_sec?: number
}

export async function checkHealth(): Promise<HealthResponse> {
  const r = await fetch('/health')
  if (!r.ok) throw new Error('Backend unavailable')
  return r.json()
}

export async function startGeneration(
  prompt: string,
  negativePrompt: string,
  params: {
    width: number
    height: number
    steps: number
    cfg: number
    strength: number
    seed: number
    scheduler: string
    model: string
    execution_mode: string
    vae_tiling: boolean
    vae_tile_overlap: number
    num_frames?: number
    max_sequence_length?: number
    noise_aug_strength?: number
    fps?: number
    motion_bucket_id?: number
    min_guidance_scale?: number
    max_guidance_scale?: number
    extraParams?: Record<string, number | string | boolean>
  },
  videoFile?: File,
  imageFile?: File,
): Promise<TaskResponse> {
  const formData = new FormData()
  if (imageFile instanceof File) formData.append('image', imageFile)
  if (videoFile instanceof File) formData.append('video', videoFile)
  formData.append('prompt', prompt)
  formData.append('negative_prompt', negativePrompt)
  formData.append('width', String(params.width))
  formData.append('height', String(params.height))
  formData.append('steps', String(params.steps))
  formData.append('cfg', String(params.cfg))
  formData.append('strength', String(params.strength))
  formData.append('seed', String(params.seed))
  if (params.scheduler) formData.append('scheduler', params.scheduler)
  formData.append('model', params.model)
  formData.append('execution_mode', params.execution_mode)
  formData.append('vae_tiling', String(params.vae_tiling))
  formData.append('vae_tile_overlap', String(params.vae_tile_overlap))
  if (params.num_frames != null) formData.append('num_frames', String(params.num_frames))
  if (params.max_sequence_length != null) formData.append('max_sequence_length', String(params.max_sequence_length))
  if (params.noise_aug_strength != null) formData.append('noise_aug_strength', String(params.noise_aug_strength))
  if (params.fps != null) formData.append('fps', String(params.fps))
  if (params.motion_bucket_id != null) formData.append('motion_bucket_id', String(params.motion_bucket_id))
  if (params.min_guidance_scale != null) formData.append('min_guidance_scale', String(params.min_guidance_scale))
  if (params.max_guidance_scale != null) formData.append('max_guidance_scale', String(params.max_guidance_scale))
  if (params.extraParams && Object.keys(params.extraParams).length > 0) {
    formData.append('extra_params', JSON.stringify(params.extraParams))
  }

  const r = await fetch('/generate', { method: 'POST', body: formData })
  if (!r.ok) {
    const err = await r.json()
    const msg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail)
    throw new Error(msg || 'Generation failed')
  }
  return r.json()
}

export async function pollTask(taskId: string): Promise<TaskStatus> {
  const r = await fetch(`/generate/${taskId}`)
  if (!r.ok) throw new Error('Failed to poll task')
  return r.json()
}

export async function cancelTask(taskId: string): Promise<void> {
  await fetch(`/generate/${taskId}`, { method: 'DELETE' })
}

export interface VLMResponse {
  result: string
}

export async function analyzeVLM(image: File, prompt: string): Promise<string> {
  const formData = new FormData()
  formData.append('image', image)
  formData.append('prompt', prompt)

  const r = await fetch('/vlm/analyze', { method: 'POST', body: formData })
  if (!r.ok) {
    const err = await r.json()
    throw new Error(err.detail || 'VLM analysis failed')
  }
  const data: VLMResponse = await r.json()
  return data.result
}

export interface ImageToTextResponse {
  result: string
}

export async function analyzeImageToText(
  image: File,
  prompt: string,
  modelKey: string,
  maxNewTokens: number,
  temperature: number
): Promise<string> {
  const formData = new FormData()
  formData.append('image', image)
  formData.append('prompt', prompt)
  formData.append('model_key', modelKey)
  formData.append('max_new_tokens', String(maxNewTokens))
  formData.append('temperature', String(temperature))

  const r = await fetch('/transformers/image-to-text', { method: 'POST', body: formData })
  if (!r.ok) {
    const err = await r.json()
    throw new Error(err.detail || 'Image-to-text analysis failed')
  }
  const data: ImageToTextResponse = await r.json()
  return data.result
}

export interface LLMGenerateResponse {
  result: string
}

export async function generateLLM(params: {
  prompt: string
  system_prompt?: string
  model?: string
  temperature: number
  max_tokens: number
  top_p: number
  top_k: number
  seed: number
}): Promise<string> {
  const r = await fetch('/llm/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!r.ok) {
    const err = await r.json()
    throw new Error(err.detail || 'LLM generation failed')
  }
  const data: LLMGenerateResponse = await r.json()
  return data.result
}

export async function improvePrompt(prompt: string): Promise<string> {
  const r = await fetch('/prompt/improve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!r.ok) {
    const err = await r.json()
    throw new Error(err.detail || 'Failed to improve prompt')
  }
  const data = await r.json()
  return data.improved_prompt
}
