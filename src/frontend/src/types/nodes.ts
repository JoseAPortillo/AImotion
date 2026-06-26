import type { Node, Edge } from '@xyflow/react'

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
}

export interface DenoisingStrengthData extends Record<string, unknown> {
  strength: number
}

export interface GenerationData extends Record<string, unknown> {
  model: string
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

export const NODE_DEFINITIONS: Record<NodeType, NodeDefinition> = {
  videoInput: {
    type: 'videoInput',
    label: 'Video Input',
    color: '#6366f1',
    inputs: [],
    outputs: [{ id: 'video', label: 'Video', type: 'video_tensor' }],
  },
  audioInput: {
    type: 'audioInput',
    label: 'Audio Input',
    color: '#ec4899',
    inputs: [],
    outputs: [{ id: 'audio', label: 'Audio', type: 'audio_features' }],
  },
  prompt: {
    type: 'prompt',
    label: 'Prompt',
    color: '#22c55e',
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
    defaultData: { model: 'cogvideox-2b' },
  },
  samplingParams: {
    type: 'samplingParams',
    label: 'Sampling',
    color: '#3b82f6',
    inputs: [],
    outputs: [{ id: 'params', label: 'Params', type: 'params' }],
    defaultData: { steps: 50, cfg: 6, seed: 0 },
  },
  denoisingStrength: {
    type: 'denoisingStrength',
    label: 'Denoising',
    color: '#8b5cf6',
    inputs: [],
    outputs: [{ id: 'strength', label: 'Strength', type: 'params' }],
    defaultData: { strength: 0.8 },
  },
  output: {
    type: 'output',
    label: 'Output',
    color: '#64748b',
    inputs: [{ id: 'video_in', label: 'Video', type: 'video_tensor' }],
    outputs: [],
    defaultData: { format: 'mp4' },
  },
  preview: {
    type: 'preview',
    label: 'Preview',
    color: '#14b8a6',
    inputs: [{ id: 'video_in', label: 'Video', type: 'video_tensor' }],
    outputs: [],
  },
}
