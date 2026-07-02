import { useState, useEffect } from 'react'
import { useGraphStore } from '../store/graph'
import {
  NODE_DEFINITIONS,
  RESOLUTION_PRESETS,
  getResolutionPresetKey,
  type NodeData,
  type VideoInputData,
  type AudioInputData,
  type PromptData,
  type SamplingParamsData,
  type DenoisingStrengthData,
  type GenerationData,
  type OutputData,
  type TransformersData,
  type LoRAData,
  type ControlNetData,
} from '../types/nodes'

const schedLabels: Record<string, string> = {
  cogvideox_ddim: 'DDIM',
  cogvideox_dpm: 'DPM',
  flow_match_euler: 'Flow Euler',
  ltx_euler_ancestral_rf: 'Euler Anc RF',
  scheduler: 'Auto-detect',
}

const FIELD_DESCS: Record<string, string> = {
  steps: 'Number of denoising steps. More steps = higher quality but slower generation.',
  cfg: 'Classifier-Free Guidance scale. Higher values = generation follows the prompt more closely.',
  seed: 'Random seed for reproducibility. 0 = random seed each run.',
  strength: 'How much of the original image/video is preserved. Lower values = more change.',
  width: 'Output width in pixels. Must be a multiple of 8.',
  height: 'Output height in pixels. Must be a multiple of 8.',
  num_frames: 'Number of frames to generate. More frames = longer video.',
  max_sequence_length: 'Maximum sequence length for text encoding. Higher = more context.',
  vae_tiling: 'Process the VAE in tiles to reduce VRAM usage.',
  vae_tile_overlap: 'Overlap between VAE tiles. Higher = fewer seams but more VRAM.',
  noise_aug_strength: 'Strength of noise augmentation applied to the input image (SVD). Higher = more variation from the input.',
  fps: 'Frames per second in the generated video.',
  motion_bucket_id: 'Motion bucket ID for SVD. Higher values = more motion in the output.',
  decode_chunk_size: 'Number of frames to decode at once. Lower = less VRAM usage.',
  min_guidance_scale: 'Minimum guidance scale for SVD. Used for classifier-free guidance range.',
  max_guidance_scale: 'Maximum guidance scale for SVD. Used for classifier-free guidance range.',
  temperature: 'Sampling temperature. Higher = more random output. Lower = more deterministic.',
  max_tokens: 'Maximum number of tokens to generate.',
  top_p: 'Nucleus sampling threshold. Only tokens with cumulative probability above this are considered.',
  top_k: 'Top-K sampling. Only the top K most likely tokens are considered at each step.',
  loraFile: 'Path to the LoRA weights file.',
  scale: 'Strength of the LoRA adapter. Higher = more pronounced effect.',
  model: 'HuggingFace model to use for generation.',
  scheduler: 'Noise scheduler for the diffusion process. Different schedulers trade off speed vs quality.',
  positive: 'Positive prompt describing what you want to generate.',
  negative: 'Negative prompt describing what to avoid in generation.',
  controlnetModel: 'ControlNet model to use for conditioning.',
}

interface ModelEntry {
  key: string
  name: string
  schedulers: string[]
  default_scheduler: string
  type: string
  hf_name?: string
  pipeline_class?: string
  runner?: string
  defaults?: Record<string, unknown>
  inputs?: Record<string, { type: string; default?: number; min?: number; max?: number; hidden?: boolean }>
  accepts?: Record<string, boolean>
  is_video?: boolean
}

const panelStyle: React.CSSProperties = {
  width: 260,
  background: '#1a1a1a',
  borderLeft: '1px solid #2a2a2a',
  padding: 16,
  overflowY: 'auto',
  height: '100%',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#888',
  marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#0f0f0f',
  border: '1px solid #2a2a2a',
  borderRadius: 6,
  color: '#e0e0e0',
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
}

function Label({ children, style, desc }: { children: React.ReactNode; style?: React.CSSProperties; desc?: string }) {
  return (
    <label style={{ ...labelStyle, ...style }}>
      {children}
      {desc && (
        <span
          title={desc}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 4,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#333',
            color: '#999',
            fontSize: 9,
            cursor: 'help',
            lineHeight: 1,
            verticalAlign: 'middle',
          }}
        >
          ?
        </span>
      )}
    </label>
  )
}

function FieldWrap({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 14 }}>{children}</div>
}

function CollapsibleSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div style={{ marginBottom: 0, borderBottom: '1px solid #2a2a2a' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 'none',
          color: '#aaa',
          fontSize: 11,
          fontWeight: 600,
          padding: '8px 0',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        {title}
        <span style={{ fontSize: 9, color: '#666' }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div style={{ paddingBottom: 8 }}>{children}</div>}
    </div>
  )
}

export default function NodeInspector() {
  const selectedNodeId = useGraphStore((s) => s.selectedNode)
  const nodes = useGraphStore((s) => s.nodes)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const removeNode = useGraphStore((s) => s.removeNode)
  const selectNode = useGraphStore((s) => s.selectNode)

  const [negOpen, setNegOpen] = useState(false)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)

  useEffect(() => {
    fetch('/models')
      .then(r => r.json())
      .then(data => {
        const filtered = (data.models || []).filter(
          (m: ModelEntry) => m.type !== 'future' && m.type !== 'api'
        )
        setModels(filtered)
        setModelsLoaded(true)
      })
      .catch(() => setModelsLoaded(true))
  }, [])

  const node = nodes.find((n) => n.id === selectedNodeId) ?? null

  if (!node) {
    return (
      <div style={panelStyle}>
        <p style={{ color: '#888', textAlign: 'center', marginTop: 24, fontSize: 13 }}>No node selected</p>
      </div>
    )
  }

  const def = NODE_DEFINITIONS[node.type]

  const nid = node.id
  function handleChange(field: string, value: unknown) {
    updateNodeData(nid, { [field]: value } as Partial<NodeData>)
  }

  function renderDynamicInputs(data: GenerationData) {
    const modelCfg = models.find(m => m.key === data.model)
    const inputs = modelCfg?.inputs
    if (!inputs) return null
    return (
      <>
        {Object.entries(inputs)
          .filter(([, inp]) => !inp.hidden && (inp.type === 'int' || inp.type === 'float') && inp.default != null)
          .map(([name, inp]) => {
            const isFloat = inp.type === 'float'
            const label = name.replace(/_/g, ' ')
            const desc = FIELD_DESCS[name] || FIELD_DESCS[label]
            return (
              <FieldWrap key={name}>
                <Label desc={desc}>
                  {label}
                  <input
                    type="number"
                    style={inputStyle}
                    step={isFloat ? 'any' : 1}
                    value={(data[name as keyof GenerationData] ?? inp.default) as number}
                    onChange={(e) => handleChange(name, isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10))}
                    min={inp.min}
                    max={inp.max}
                  />
                </Label>
              </FieldWrap>
            )
          })}
      </>
    )
  }

  function renderFields(n: typeof node) {
    if (!n) return null
    switch (n.type) {
      case 'videoInput': {
        const data = n.data as VideoInputData
        if (!data.fileName) return null
        return (
          <FieldWrap>
            <Label>
              File
              <input style={inputStyle} value={data.fileName} readOnly />
            </Label>
          </FieldWrap>
        )
      }

      case 'imageInput': {
        const data = n.data as VideoInputData
        if (!data.fileName) return null
        return (
          <FieldWrap>
            <Label>
              File
              <input style={inputStyle} value={data.fileName} readOnly />
            </Label>
          </FieldWrap>
        )
      }

      case 'audioInput': {
        const data = n.data as AudioInputData
        if (!data.fileName) return null
        return (
          <FieldWrap>
            <Label>
              File
              <input style={inputStyle} value={data.fileName} readOnly />
            </Label>
          </FieldWrap>
        )
      }

      case 'prompt': {
        const data = n.data as PromptData
        return (
          <>
            <FieldWrap>
              <Label desc="Positive prompt describing what you want to generate.">
                Positive Prompt
                <textarea
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
                  value={data.positive}
                  onChange={(e) => handleChange('positive', e.target.value)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc="Negative prompt describing what to avoid in generation.">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span>Negative Prompt</span>
                  <button
                    type="button"
                    onClick={() => setNegOpen((v) => !v)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#888',
                      cursor: 'pointer',
                      fontSize: 10,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    {negOpen ? '▲' : '▼'}
                  </button>
                </div>
                {negOpen && (
                  <textarea
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
                    value={data.negative}
                    onChange={(e) => handleChange('negative', e.target.value)}
                  />
                )}
              </Label>
            </FieldWrap>
          </>
        )
      }

      case 'diffuserGenerator':
      case 'generation': {
        const data = n.data as GenerationData
        const modelCfg = models.find(m => m.key === data.model)
        const scheds = modelCfg?.schedulers || []
        const defSched = modelCfg?.default_scheduler || ''

        const handleModel = (e: React.ChangeEvent<HTMLSelectElement>) => {
          const key = e.target.value
          const cfg = models.find(m => m.key === key)
          handleChange('model', key)
          handleChange('scheduler', cfg?.default_scheduler || '')
        }

        return (
          <>
            <FieldWrap>
              <Label desc={FIELD_DESCS.model}>
                Model
                <select style={inputStyle} value={data.model} onChange={handleModel}>
                  {!modelsLoaded && <option value="">Loading...</option>}
                  {modelsLoaded && models.length === 0 && <option value="">No models</option>}
                  {models.map(m => (
                    <option key={m.key} value={m.key}>{m.name}</option>
                  ))}
                  {modelsLoaded && data.model && !models.find(m => m.key === data.model) && (
                    <option value={data.model} disabled>{data.model} (unavailable)</option>
                  )}
                </select>
              </Label>
            </FieldWrap>

            {modelCfg && (
              <div style={{ marginBottom: 10, padding: 8, background: '#131313', borderRadius: 6, fontSize: 10, color: '#777', lineHeight: 1.6 }}>
                <div><strong style={{ color: '#999' }}>{modelCfg.name}</strong></div>
                {modelCfg.hf_name && <div style={{ wordBreak: 'break-all' }}>{modelCfg.hf_name}</div>}
                {modelCfg.pipeline_class && <div style={{ color: '#666', marginTop: 2 }}>{modelCfg.pipeline_class}</div>}
                {modelCfg.defaults && (
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '0 8px' }}>
                    {Object.entries(modelCfg.defaults)
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
              <FieldWrap>
                <Label desc={FIELD_DESCS.scheduler}>
                  Scheduler
                  <select style={inputStyle} value={data.scheduler} onChange={(e) => handleChange('scheduler', e.target.value)}>
                    <option value="">Default{defSched ? ` (${schedLabels[defSched] || defSched})` : ''}</option>
                    {scheds.map(s => (
                      <option key={s} value={s}>{schedLabels[s] || s}</option>
                    ))}
                  </select>
                </Label>
              </FieldWrap>
            </CollapsibleSection>

            <CollapsibleSection title="Básicos" defaultOpen={true}>
              <FieldWrap>
                <Label desc={FIELD_DESCS.steps}>
                  Steps
                  <input
                    type="number"
                    style={inputStyle}
                    min={1}
                    max={200}
                    value={data.steps}
                    onChange={(e) => handleChange('steps', parseInt(e.target.value, 10) || 1)}
                  />
                </Label>
              </FieldWrap>
              <FieldWrap>
                <Label desc={FIELD_DESCS.cfg}>
                  CFG
                  <input
                    type="number"
                    style={inputStyle}
                    min={1}
                    max={20}
                    step={0.5}
                    value={data.cfg}
                    onChange={(e) => handleChange('cfg', parseFloat(e.target.value) || 1)}
                  />
                </Label>
              </FieldWrap>
              <FieldWrap>
                <Label desc={FIELD_DESCS.seed}>
                  Seed
                  <input
                    type="number"
                    style={inputStyle}
                    min={0}
                    value={data.seed}
                    onChange={(e) => handleChange('seed', parseInt(e.target.value, 10) || 0)}
                  />
                </Label>
              </FieldWrap>
              <FieldWrap>
                <Label desc={FIELD_DESCS.strength}>
                  Strength
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <input
                      type="range"
                      style={{ flex: 1, accentColor: def.color }}
                      min={0}
                      max={1}
                      step={0.05}
                      value={data.strength}
                      onChange={(e) => handleChange('strength', parseFloat(e.target.value))}
                    />
                    <span style={{ color: '#e0e0e0', fontSize: 13, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {data.strength.toFixed(2)}
                    </span>
                  </div>
                </Label>
              </FieldWrap>
            </CollapsibleSection>

            <CollapsibleSection title="Avanzados" defaultOpen={false}>
              <FieldWrap>
                <Label desc={FIELD_DESCS.vae_tiling}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={data.vae_tiling}
                      onChange={(e) => handleChange('vae_tiling', e.target.checked)}
                      style={{ accentColor: def.color, margin: 0 }}
                    />
                    VAE Tiling
                  </div>
                </Label>
              </FieldWrap>
              {data.vae_tiling && (
                <FieldWrap>
                  <Label desc={FIELD_DESCS.vae_tile_overlap}>
                    Tile Overlap
                    <input
                      type="number"
                      style={inputStyle}
                      min={0}
                      max={0.9}
                      step={0.1}
                      value={data.vae_tile_overlap}
                      onChange={(e) => handleChange('vae_tile_overlap', parseFloat(e.target.value) || 0)}
                    />
                  </Label>
                </FieldWrap>
              )}
              {renderDynamicInputs(data)}
            </CollapsibleSection>
          </>
        )
      }

      case 'samplingParams': {
        const data = n.data as SamplingParamsData
        const presetKey = getResolutionPresetKey(data.width, data.height)
        return (
          <>
            <FieldWrap>
              <Label desc={FIELD_DESCS.steps}>
                Steps
                <input
                  type="number"
                  style={inputStyle}
                  min={1}
                  max={200}
                  value={data.steps}
                  onChange={(e) => handleChange('steps', parseInt(e.target.value, 10) || 1)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.cfg}>
                CFG
                <input
                  type="number"
                  style={inputStyle}
                  min={1}
                  max={20}
                  step={0.5}
                  value={data.cfg}
                  onChange={(e) => handleChange('cfg', parseFloat(e.target.value) || 1)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.seed}>
                Seed
                <input
                  type="number"
                  style={inputStyle}
                  min={0}
                  value={data.seed}
                  onChange={(e) => handleChange('seed', parseInt(e.target.value, 10) || 0)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label>
                Resolution
                <select
                  style={inputStyle}
                  value={presetKey || '__custom__'}
                  onChange={(e) => {
                    const p = RESOLUTION_PRESETS[e.target.value]
                    if (p) {
                      handleChange('width', p.width)
                      handleChange('height', p.height)
                    }
                  }}
                >
                  {presetKey === null && <option value="__custom__">Custom</option>}
                  {Object.entries(RESOLUTION_PRESETS).map(([key, p]) => (
                    <option key={key} value={key}>{p.label}</option>
                  ))}
                  <option value="__custom__">Custom...</option>
                </select>
              </Label>
            </FieldWrap>
            <div style={{ display: 'flex', gap: 8 }}>
              <FieldWrap>
                <Label desc={FIELD_DESCS.width}>
                  W
                  <input
                    type="number"
                    style={inputStyle}
                    min={128}
                    max={768}
                    step={8}
                    value={data.width}
                    onChange={(e) => handleChange('width', parseInt(e.target.value, 10) || 128)}
                  />
                </Label>
              </FieldWrap>
              <FieldWrap>
                <Label desc={FIELD_DESCS.height}>
                  H
                  <input
                    type="number"
                    style={inputStyle}
                    min={128}
                    max={768}
                    step={8}
                    value={data.height}
                    onChange={(e) => handleChange('height', parseInt(e.target.value, 10) || 128)}
                  />
                </Label>
              </FieldWrap>
            </div>
          </>
        )
      }

      case 'denoisingStrength': {
        const data = n.data as DenoisingStrengthData
        return (
          <FieldWrap>
            <Label desc={FIELD_DESCS.strength}>
              Strength
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  type="range"
                  style={{ flex: 1, accentColor: def.color }}
                  min={0}
                  max={1}
                  step={0.05}
                  value={data.strength}
                  onChange={(e) => handleChange('strength', parseFloat(e.target.value))}
                />
                <span style={{ color: '#e0e0e0', fontSize: 13, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {data.strength.toFixed(2)}
                </span>
              </div>
            </Label>
          </FieldWrap>
        )
      }

      case 'output': {
        const data = n.data as OutputData
        return (
          <FieldWrap>
            <Label>
              Format
              <select style={inputStyle} value={data.format} onChange={(e) => handleChange('format', e.target.value)}>
                <option value="mp4">mp4</option>
                <option value="gif">gif</option>
              </select>
            </Label>
          </FieldWrap>
        )
      }

      case 'preview':
        return (
          <p style={{ color: '#888', fontSize: 12, margin: 0 }}>Preview has no editable properties.</p>
        )

      case 'transformersGenerator': {
        const data = n.data as TransformersData
        return (
          <>
            <FieldWrap>
              <Label desc={FIELD_DESCS.model}>
                Model
                <input
                  style={inputStyle}
                  value={data.model}
                  onChange={(e) => handleChange('model', e.target.value)}
                  placeholder="Model name"
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.temperature}>
                Temperature
                <input
                  type="number"
                  style={inputStyle}
                  min={0}
                  max={2}
                  step={0.1}
                  value={data.temperature}
                  onChange={(e) => handleChange('temperature', parseFloat(e.target.value) || 0)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.top_p}>
                Top P
                <input
                  type="number"
                  style={inputStyle}
                  min={0}
                  max={1}
                  step={0.05}
                  value={data.top_p}
                  onChange={(e) => handleChange('top_p', parseFloat(e.target.value) || 0)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.top_k}>
                Top K
                <input
                  type="number"
                  style={inputStyle}
                  min={0}
                  max={200}
                  value={data.top_k}
                  onChange={(e) => handleChange('top_k', parseInt(e.target.value, 10) || 0)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.max_tokens}>
                Max Tokens
                <input
                  type="number"
                  style={inputStyle}
                  min={1}
                  max={32768}
                  value={data.max_tokens}
                  onChange={(e) => handleChange('max_tokens', parseInt(e.target.value, 10) || 1)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.seed}>
                Seed
                <input
                  type="number"
                  style={inputStyle}
                  min={0}
                  value={data.seed}
                  onChange={(e) => handleChange('seed', parseInt(e.target.value, 10) || 0)}
                />
              </Label>
            </FieldWrap>
          </>
        )
      }

      case 'vlmNode': {
        const data = n.data as TransformersData
        return (
          <>
            <FieldWrap>
              <Label desc={FIELD_DESCS.model}>
                Model
                <input
                  style={inputStyle}
                  value={data.model}
                  onChange={(e) => handleChange('model', e.target.value)}
                  placeholder="Model name"
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.temperature}>
                Temperature
                <input
                  type="number"
                  style={inputStyle}
                  min={0}
                  max={2}
                  step={0.1}
                  value={data.temperature}
                  onChange={(e) => handleChange('temperature', parseFloat(e.target.value) || 0)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.max_tokens}>
                Max Tokens
                <input
                  type="number"
                  style={inputStyle}
                  min={1}
                  max={32768}
                  value={data.max_tokens}
                  onChange={(e) => handleChange('max_tokens', parseInt(e.target.value, 10) || 1)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label>
                System Prompt
                <textarea
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 60, fontFamily: 'inherit' }}
                  value={data.system_prompt}
                  onChange={(e) => handleChange('system_prompt', e.target.value)}
                />
              </Label>
            </FieldWrap>
          </>
        )
      }

      case 'loadLora': {
        const data = n.data as LoRAData
        return (
          <>
            <FieldWrap>
              <Label desc={FIELD_DESCS.model}>
                Model
                <input
                  style={inputStyle}
                  value={data.model}
                  onChange={(e) => handleChange('model', e.target.value)}
                  placeholder="Model key"
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.loraFile}>
                LoRA File
                <input
                  style={inputStyle}
                  value={data.loraFile}
                  onChange={(e) => handleChange('loraFile', e.target.value)}
                  placeholder="Path to .safetensors"
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.scale}>
                Scale
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <input
                    type="range"
                    style={{ flex: 1, accentColor: def.color }}
                    min={0}
                    max={2}
                    step={0.05}
                    value={data.scale}
                    onChange={(e) => handleChange('scale', parseFloat(e.target.value))}
                  />
                  <span style={{ color: '#e0e0e0', fontSize: 13, minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {data.scale.toFixed(2)}
                  </span>
                </div>
              </Label>
            </FieldWrap>
          </>
        )
      }

      case 'applyControlNet': {
        const data = n.data as ControlNetData
        return (
          <>
            <FieldWrap>
              <Label desc={FIELD_DESCS.model}>
                Model
                <input
                  style={inputStyle}
                  value={data.model}
                  onChange={(e) => handleChange('model', e.target.value)}
                  placeholder="Diffusion model key"
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label desc={FIELD_DESCS.controlnetModel}>
                ControlNet Model
                <input
                  style={inputStyle}
                  value={data.controlnetModel}
                  onChange={(e) => handleChange('controlnetModel', e.target.value)}
                  placeholder="HF model ID"
                />
              </Label>
            </FieldWrap>
          </>
        )
      }

      default:
        return null
    }
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0, color: def.color, fontSize: 14, fontWeight: 600 }}>{def.label}</h3>
        <button
          type="button"
          onClick={() => {
            removeNode(node.id)
            selectNode(null)
          }}
          style={{
            background: '#dc2626',
            border: 'none',
            color: '#fff',
            fontSize: 11,
            padding: '4px 10px',
            borderRadius: 4,
            cursor: 'pointer',
            lineHeight: 1.4,
          }}
        >
          Remove
        </button>
      </div>
      <p style={{ margin: '0 0 12px', color: '#888', fontSize: 11, lineHeight: 1.5 }}>{def.description}</p>
      <p style={{ margin: '0 0 16px', color: '#555', fontSize: 10 }}>{node.id}</p>
      {renderFields(node)}
    </div>
  )
}
