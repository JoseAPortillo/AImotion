import type { Node, Edge } from '@xyflow/react'
import { Position } from '@xyflow/react'

export type NodeType =
  | 'videoInput'
  | 'audioInput'
  | 'prompt'
  | 'generation'
  | 'samplingParams'
  | 'denoisingStrength'
  | 'output'
  | 'preview'

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
}

export interface VideoInputData extends Record<string, unknown> {
  file?: File
  fileName?: string
  fileUrl?: string
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
  scheduler: string
}

export interface DenoisingStrengthData extends Record<string, unknown> {
  strength: number
}

export interface GenerationData extends Record<string, unknown> {
  model: string
  scheduler: string
}

export interface OutputData extends Record<string, unknown> {
  format: 'mp4' | 'gif'
}

export type NodeData =
  | VideoInputData
  | AudioInputData
  | PromptData
  | SamplingParamsData
  | DenoisingStrengthData
  | GenerationData
  | OutputData

export type AppNode = Node<NodeData, NodeType>

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
  return PORT_COLORS[portType]
}

export function getEdgeStyle(portType: PortType | null): React.CSSProperties {
  return {
    stroke: portType ? PORT_COLORS[portType] : '#555',
    strokeWidth: 2,
  }
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
  generation: {
    type: 'generation',
    label: 'Generation',
    color: '#f59e0b',
    description: 'The core generation node. Connects prompts, parameters, and inputs to produce a video.',
    inputs: [
      { id: 'video_in', label: 'Video', type: 'video_tensor' },
      { id: 'audio_in', label: 'Audio', type: 'audio_features' },
      { id: 'prompt_pos', label: 'Positive Prompt', type: 'prompt' },
      { id: 'prompt_neg', label: 'Negative Prompt', type: 'prompt' },
      { id: 'params', label: 'Params', type: 'params' },
      { id: 'strength', label: 'Strength', type: 'params' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video', type: 'video_tensor' },
    ],
    defaultData: { model: 'cogvideox-2b', scheduler: '' },
  },
  samplingParams: {
    type: 'samplingParams',
    label: 'Sampling',
    color: '#3b82f6',
    description: 'Configure sampling parameters: number of steps, CFG scale, seed, and output resolution.',
    inputs: [],
    outputs: [{ id: 'params', label: 'Params', type: 'params' }],
    defaultData: { steps: 50, cfg: 6, seed: 0, width: 720, height: 480, scheduler: '' },
  },
  denoisingStrength: {
    type: 'denoisingStrength',
    label: 'Denoising',
    color: '#8b5cf6',
    description: 'Controls how much of the original video structure is preserved. Lower = more change from input.',
    inputs: [],
    outputs: [{ id: 'strength', label: 'Strength', type: 'params' }],
    defaultData: { strength: 0.8 },
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
    outputs: [],
  },
}
