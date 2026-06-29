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
} from '../types/nodes'

const schedLabels: Record<string, string> = {
  cogvideox_ddim: 'DDIM',
  cogvideox_dpm: 'DPM',
  flow_match_euler: 'Flow Euler',
  flow_match_heun: 'Flow Heun',
  ltx_euler_ancestral_rf: 'Euler Anc RF',
  scheduler: 'Auto-detect',
}

interface ModelEntry {
  key: string
  name: string
  schedulers: string[]
  default_scheduler: string
  type: string
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

function Label({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ ...labelStyle, ...style }}>
      {children}
    </label>
  )
}

function FieldWrap({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 14 }}>{children}</div>
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
              <Label>
                Positive Prompt
                <textarea
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 80, fontFamily: 'inherit' }}
                  value={data.positive}
                  onChange={(e) => handleChange('positive', e.target.value)}
                />
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label>
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
              <Label>
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
            <FieldWrap>
              <Label>
                Scheduler
                <select style={inputStyle} value={data.scheduler} onChange={(e) => handleChange('scheduler', e.target.value)}>
                  <option value="">Default{defSched ? ` (${schedLabels[defSched] || defSched})` : ''}</option>
                  {scheds.map(s => (
                    <option key={s} value={s}>{schedLabels[s] || s}</option>
                  ))}
                </select>
              </Label>
            </FieldWrap>
          </>
        )
      }

      case 'samplingParams': {
        const data = n.data as SamplingParamsData
        const presetKey = getResolutionPresetKey(data.width, data.height)
        return (
          <>
            <FieldWrap>
              <Label>
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
              <Label>
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
              <Label>
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
                <Label>
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
                <Label>
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
            <Label>
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
