import type { Node, Edge } from '@xyflow/react'
import { Position } from '@xyflow/react'

export type NodeType =
  | 'videoInput'
  | 'imageInput'
  | 'audioInput'
  | 'prompt'
  | 'diffuserGenerator'
  | 'transformersGenerator'
  | 'vlmNode'
  | 'llmGenerator'
  | 'cvTaskProcessor'
  | 'loadLora'
  | 'applyControlNet'
  | 'generation'
  | 'samplingParams'
  | 'denoisingStrength'
  | 'output'
  | 'preview'
  | 'textToImage'
  | 'textToVideo'
  | 'imageToVideo'
  | 'videoToVideo'
  | 'imageToImage'
  | 'runwayVideoToVideo'
  | 'groupNode'

export interface ModelEntry {
  key: string
  name: string
  runner?: string
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
  pricing?: {
    credits_per_second?: number
    min_credits?: number
    tiers?: Record<string, number>
  }
  resolutions?: string[]
}

export type PortType =
  | 'video_tensor'
  | 'audio_features'
  | 'prompt'
  | 'params'

export interface PortDef {
  id: string
  label: string
  type: PortType
}

export interface NodeDefinition {
  type: NodeType
  label: string
  color: string
  description: string
  inputs: PortDef[]
  outputs: PortDef[]
  defaultData?: Record<string, unknown>
  paletteHidden?: boolean
  defaultSize?: { width: number; height: number }
}

export interface ImageInputData extends Record<string, unknown> {
  file?: File
  fileName?: string
  fileUrl?: string
  fileDataUrl?: string
}

export interface VideoInputData extends Record<string, unknown> {
  file?: File
  fileName?: string
  fileUrl?: string
  fileDataUrl?: string
}

export interface AudioInputData extends Record<string, unknown> {
  file?: File
  fileName?: string
}

export interface PromptData extends Record<string, unknown> {
  positive: string
  negative: string
}

export interface SamplingParamsData extends Record<string, unknown> {
  steps: number
  cfg: number
  seed: number
  width: number
  height: number
}

export interface DenoisingStrengthData extends Record<string, unknown> {
  strength: number
}

export interface GenerationData extends Record<string, unknown> {
  model: string
  scheduler: string
  execution_mode: 'local' | 'cloud'
  vae_tiling: boolean
  vae_tile_overlap: number
  steps: number
  cfg: number
  seed: number
  strength: number
  width: number
  height: number
  num_frames?: number
  max_sequence_length?: number
  noise_aug_strength?: number
  min_guidance_scale?: number
  max_guidance_scale?: number
  fps?: number
  motion_bucket_id?: number
}

export interface VLMData extends Record<string, unknown> {
  result: string
  loading: boolean
}

export interface LoRAData extends Record<string, unknown> {
  loraFile: string
  scale: number
  model: string
  active: boolean
}

export interface ControlNetData extends Record<string, unknown> {
  model: string
  controlnetModel: string
  active: boolean
}

export interface TransformersData extends Record<string, unknown> {
  model: string
  system_prompt: string
  temperature: number
  max_tokens: number
  top_p: number
  top_k: number
  seed: number
  result: string
}

export interface OutputData extends Record<string, unknown> {
  format: 'mp4' | 'gif'
}

export interface GroupNodeData extends Record<string, unknown> {
  collapsed: boolean
  childIds: string[]
  label?: string
  previewUrl?: string
  previewType?: 'image' | 'video'
  expandedWidth?: number
  expandedHeight?: number
  savedChildPositions?: Record<string, { relX: number; relY: number }>
}

export type NodeData =
  | ImageInputData
  | VideoInputData
  | AudioInputData
  | PromptData
  | SamplingParamsData
  | DenoisingStrengthData
  | GenerationData
  | VLMData
  | LoRAData
  | ControlNetData
  | TransformersData
  | OutputData
  | GroupNodeData

export type AppNode = Node<NodeData, NodeType>

export const RESOLUTION_PRESETS: Record<string, { label: string; width: number; height: number }> = {
  '720x480': { label: '720×480 (SD)', width: 720, height: 480 },
  '704x512': { label: '704×512 (LTX)', width: 704, height: 512 },
  '720x720': { label: '720×720 (Square)', width: 720, height: 720 },
  '768x768': { label: '768×768 (Max)', width: 768, height: 768 },
  '512x512': { label: '512×512 (Small)', width: 512, height: 512 },
}

export function getResolutionPresetKey(width: number, height: number): string | null {
  for (const [key, p] of Object.entries(RESOLUTION_PRESETS)) {
    if (p.width === width && p.height === height) return key
  }
  return null
}

export const PORT_COLORS: Record<PortType, string> = {
  video_tensor: '#ef4444',
  audio_features: '#ec4899',
  prompt: '#22c55e',
  params: '#3b82f6',
}

export function getPortTypeFromHandle(handleId: string, nodeDef: NodeDefinition): PortType | null {
  const all = [...nodeDef.inputs, ...nodeDef.outputs]
  return all.find((p) => p.id === handleId)?.type ?? null
}

export function getHandleColor(handleId: string, portType: PortType): string {
  if (handleId === 'negative' || handleId === 'prompt_neg') return '#86efac'
  if (handleId === 'strength') return '#a78bfa'
  if (handleId === 'image_in') return '#f97316'
  if (handleId === 'video_in') return '#ef4444'
  return PORT_COLORS[portType]
}

export function getEdgeStyle(portType: PortType | null): React.CSSProperties {
  return {
    stroke: portType ? PORT_COLORS[portType] : '#555',
    strokeWidth: 2,
  }
}

export const MODALITY_FILTERS: Record<string, (m: ModelEntry) => boolean> = {
  textToImage: (m) => m.is_video !== true && !m.accepts?.image && !m.accepts?.video,
  textToVideo: (m) => m.is_video === true && !m.accepts?.image && !m.accepts?.video,
  imageToVideo: (m) => m.is_video === true && m.accepts?.image === true,
  videoToVideo: (m) => m.accepts?.video === true,
  imageToImage: (m) => m.is_video !== true && m.accepts?.image === true,
}

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  videoInput: {
    type: 'videoInput',
    label: 'Video Input',
    color: '#6366f1',
    description: 'Upload or drag a video file to use as input for video-to-video generation.',
    inputs: [],
    outputs: [{ id: 'video', label: 'Video', type: 'video_tensor' }],
  },
  imageInput: {
    type: 'imageInput',
    label: 'Image Input',
    color: '#f97316',
    description: 'Upload or drag an image file to use as input for image-to-video generation.',
    inputs: [],
    outputs: [{ id: 'image', label: 'Image', type: 'video_tensor' }],
  },
  audioInput: {
    type: 'audioInput',
    label: 'Audio Input',
    color: '#ec4899',
    description: 'Upload an audio file to use as input for audio-guided generation.',
    inputs: [],
    outputs: [{ id: 'audio', label: 'Audio', type: 'audio_features' }],
  },
  prompt: {
    type: 'prompt',
    label: 'Prompt',
    color: '#22c55e',
    description: 'Describe the video you want to generate. The positive prompt describes what you want; the negative prompt describes what to avoid.',
    inputs: [],
    outputs: [
      { id: 'positive', label: 'Positive', type: 'prompt' },
      { id: 'negative', label: 'Negative', type: 'prompt' },
    ],
  },
  diffuserGenerator: {
    type: 'diffuserGenerator',
    label: 'Diffuser Generator',
    color: '#f59e0b',
    description: 'Generates images/video using HuggingFace diffusers models (CogVideoX, LTX-Video, SDXL, Flux...).',
    paletteHidden: true,
    inputs: [
      { id: 'video_in', label: 'Video', type: 'video_tensor' },
      { id: 'image_in', label: 'Image', type: 'video_tensor' },
      { id: 'audio_in', label: 'Audio', type: 'audio_features' },
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video', type: 'video_tensor' },
    ],
    defaultData: { model: 'cogvideox-2b', scheduler: '', execution_mode: 'local', vae_tiling: true, vae_tile_overlap: 0.0, steps: 50, cfg: 6, seed: 42, strength: 0.8, width: 720, height: 480 },
  },
  transformersGenerator: {
    type: 'transformersGenerator',
    label: 'Transformers Generator',
    color: '#06b6d4',
    description: 'Text generation using Transformers/GGUF models (LLMs, VLMs). Supports temperature, top-p, top-k sampling.',
    inputs: [
      { id: 'prompt_pos', label: 'Prompt', type: 'prompt' },
      { id: 'system_in', label: 'System', type: 'prompt' },
    ],
    outputs: [
      { id: 'text_out', label: 'Text', type: 'prompt' },
    ],
    defaultData: { model: '', system_prompt: '', temperature: 0.7, max_tokens: 2048, top_p: 0.9, top_k: 40, seed: 42, result: '' },
  },
  vlmNode: {
    type: 'vlmNode',
    label: 'VLM Node',
    color: '#a855f7',
    description: 'Vision-Language Model analysis (Qwen2-VL, etc.). Takes image/video + prompt, outputs text analysis.',
    inputs: [
      { id: 'image_in', label: 'Image', type: 'video_tensor' },
      { id: 'prompt_pos', label: 'Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'text_out', label: 'Text', type: 'prompt' },
    ],
    defaultData: { result: '', loading: false },
  },
  llmGenerator: {
    type: 'llmGenerator',
    label: 'LLM Generator',
    color: '#06b6d4',
    description: 'Pure language model generation. Takes prompt, outputs text. For GGUF-based LLMs.',
    inputs: [
      { id: 'prompt_pos', label: 'Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'text_out', label: 'Text', type: 'prompt' },
    ],
  },
  cvTaskProcessor: {
    type: 'cvTaskProcessor',
    label: 'CV Processor',
    color: '#e11d48',
    description: 'Computer vision tasks: segmentation (SAM 2), depth estimation (DepthAnything), etc.',
    inputs: [
      { id: 'image_in', label: 'Image', type: 'video_tensor' },
    ],
    outputs: [
      { id: 'mask_out', label: 'Mask', type: 'video_tensor' },
    ],
  },
  loadLora: {
    type: 'loadLora',
    label: 'Load LoRA',
    color: '#f97316',
    description: 'Load and apply LoRA adapters between model and generator.',
    inputs: [
      { id: 'model_in', label: 'Model', type: 'params' },
    ],
    outputs: [
      { id: 'model_out', label: 'Model + LoRA', type: 'params' },
    ],
    defaultData: { loraFile: '', scale: 1.0, model: '', active: false },
  },
  applyControlNet: {
    type: 'applyControlNet',
    label: 'ControlNet',
    color: '#10b981',
    description: 'Apply ControlNet conditioning between model and generator.',
    inputs: [
      { id: 'image_in', label: 'Conditioning Image', type: 'video_tensor' },
      { id: 'model_in', label: 'Model', type: 'params' },
    ],
    outputs: [
      { id: 'model_out', label: 'Model + CN', type: 'params' },
    ],
    defaultData: { model: '', controlnetModel: '', active: false },
  },
  generation: {
    type: 'generation',
    label: 'Generation',
    color: '#f59e0b',
    description: 'The core generation node. Connect prompts and inputs to produce a video.',
    inputs: [
      { id: 'video_in', label: 'Video', type: 'video_tensor' },
      { id: 'image_in', label: 'Image', type: 'video_tensor' },
      { id: 'audio_in', label: 'Audio', type: 'audio_features' },
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video', type: 'video_tensor' },
    ],
    defaultData: { model: 'cogvideox-2b', scheduler: '', execution_mode: 'local', vae_tiling: true, vae_tile_overlap: 0.0, steps: 50, cfg: 6, seed: 42, strength: 0.8, width: 720, height: 480 },
    paletteHidden: true,
  },
  samplingParams: {
    type: 'samplingParams',
    label: 'Sampling',
    color: '#3b82f6',
    description: 'Configure sampling parameters: number of steps, CFG scale, seed, and output resolution.',
    inputs: [],
    outputs: [{ id: 'params', label: 'Params', type: 'params' }],
    defaultData: { steps: 50, cfg: 6, seed: 42, width: 720, height: 480 },
    paletteHidden: true,
  },
  denoisingStrength: {
    type: 'denoisingStrength',
    label: 'Denoising',
    color: '#8b5cf6',
    description: 'Controls how much of the original video structure is preserved. Lower = more change from input.',
    inputs: [],
    outputs: [{ id: 'strength', label: 'Strength', type: 'params' }],
    defaultData: { strength: 0.8 },
    paletteHidden: true,
  },
  output: {
    type: 'output',
    label: 'Output',
    color: '#64748b',
    description: 'Specifies the output format for the generated video (MP4 or GIF).',
    inputs: [{ id: 'video_in', label: 'Video', type: 'video_tensor' }],
    outputs: [],
    defaultData: { format: 'mp4' },
  },
  preview: {
    type: 'preview',
    label: 'Preview',
    color: '#14b8a6',
    description: 'Displays the generated video output in real time.',
    inputs: [{ id: 'video_in', label: 'Video', type: 'video_tensor' }],
    outputs: [{ id: 'video_out', label: 'Output', type: 'video_tensor' }],
  },
  textToImage: {
    type: 'textToImage',
    label: 'Text-to-Image',
    color: '#f97316',
    description: 'Generate an image from a text prompt using diffusion models.',
    inputs: [
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'image_out', label: 'Image', type: 'video_tensor' },
    ],
    defaultData: { model: '', scheduler: '', execution_mode: 'local', vae_tiling: true, vae_tile_overlap: 0.0, steps: 50, cfg: 6, seed: 42, strength: 0.8, width: 1024, height: 1024 },
  },
  textToVideo: {
    type: 'textToVideo',
    label: 'Text-to-Video',
    color: '#4ade80',
    description: 'Generate a video from a text prompt using diffusion models.',
    inputs: [
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video', type: 'video_tensor' },
    ],
    defaultData: { model: 'cogvideox-2b', scheduler: '', execution_mode: 'local', vae_tiling: true, vae_tile_overlap: 0.0, steps: 50, cfg: 6, seed: 42, strength: 0.8, width: 720, height: 480 },
  },
  imageToVideo: {
    type: 'imageToVideo',
    label: 'Image-to-Video',
    color: '#a855f7',
    description: 'Generate a video from an image and text prompt using image-to-video models.',
    inputs: [
      { id: 'image_in', label: 'Image', type: 'video_tensor' },
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video', type: 'video_tensor' },
    ],
    defaultData: { model: '', scheduler: '', execution_mode: 'local', vae_tiling: true, vae_tile_overlap: 0.0, steps: 50, cfg: 6, seed: 42, strength: 0.8, width: 720, height: 480 },
  },
  videoToVideo: {
    type: 'videoToVideo',
    label: 'Video-to-Video',
    color: '#ef4444',
    description: 'Transform an input video using text-guided video-to-video models.',
    inputs: [
      { id: 'video_in', label: 'Video', type: 'video_tensor' },
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video', type: 'video_tensor' },
    ],
    defaultData: { model: '', scheduler: '', execution_mode: 'local', vae_tiling: true, vae_tile_overlap: 0.0, steps: 50, cfg: 6, seed: 42, strength: 0.8, width: 720, height: 480 },
  },
  imageToImage: {
    type: 'imageToImage',
    label: 'Image-to-Image',
    color: '#f97316',
    description: 'Transform an input image using text-guided image-to-image models.',
    inputs: [
      { id: 'image_in', label: 'Image', type: 'video_tensor' },
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'image_out', label: 'Image', type: 'video_tensor' },
    ],
    defaultData: { model: '', scheduler: '', execution_mode: 'local', vae_tiling: true, vae_tile_overlap: 0.0, steps: 30, cfg: 7, seed: 42, strength: 0.8, width: 1024, height: 1024 },
  },
  runwayVideoToVideo: {
    type: 'runwayVideoToVideo',
    label: 'Runway V2V',
    color: '#6366f1',
    description: "Generate video using Runway's API — Aleph 2.0 video-to-video.",
    inputs: [
      { id: 'video_in', label: 'Video', type: 'video_tensor' },
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video', type: 'video_tensor' },
    ],
    defaultData: { model: '', scheduler: '', execution_mode: 'local', vae_tiling: false, vae_tile_overlap: 0.0, steps: 50, cfg: 6, seed: 42, strength: 0.8, width: 1280, height: 720, num_frames: 5 },
  },
  groupNode: {
    type: 'groupNode',
    label: 'Group',
    color: '#6b7280',
    description: 'Group nodes together. Collapse to show only the generated preview.',
    inputs: [],
    outputs: [{ id: 'output', label: 'Output', type: 'video_tensor' }],
    defaultData: { collapsed: false, childIds: [], label: 'Group' },
    defaultSize: { width: 400, height: 400 },
  },
}
