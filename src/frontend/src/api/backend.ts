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
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress?: number
  current_step?: number
  total_steps?: number
  result_url?: string
  result_type?: 'image' | 'video'
  error?: string
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
    vae_tiling: boolean
    vae_tile_overlap: number
    num_frames?: number
    max_sequence_length?: number
  },
  videoFile?: File,
): Promise<TaskResponse> {
  const formData = new FormData()
  if (videoFile) formData.append('video', videoFile)
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
  formData.append('vae_tiling', String(params.vae_tiling))
  formData.append('vae_tile_overlap', String(params.vae_tile_overlap))
  if (params.num_frames != null) formData.append('num_frames', String(params.num_frames))
  if (params.max_sequence_length != null) formData.append('max_sequence_length', String(params.max_sequence_length))

  const r = await fetch('/generate', { method: 'POST', body: formData })
  if (!r.ok) {
    const err = await r.json()
    throw new Error(err.detail || 'Generation failed')
  }
  return r.json()
}

export async function pollTask(taskId: string): Promise<TaskStatus> {
  const r = await fetch(`/generate/${taskId}`)
  if (!r.ok) throw new Error('Failed to poll task')
  return r.json()
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
