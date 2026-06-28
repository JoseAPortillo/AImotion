import { useState } from 'react'
import { useGraphStore } from '../store/graph'
import {
  NODE_DEFINITIONS,
  type NodeData,
  type VideoInputData,
  type AudioInputData,
  type PromptData,
  type SamplingParamsData,
  type DenoisingStrengthData,
  type GenerationData,
  type OutputData,
} from '../types/nodes'

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
        return (
          <>
            <FieldWrap>
              <Label>
                Model
                <select style={inputStyle} value={data.model} onChange={(e) => handleChange('model', e.target.value)}>
                  <option value="cogvideox-2b">cogvideox-2b</option>
                  <option value="cogvideox-5b">cogvideox-5b</option>
                  <option value="ltx-video">ltx-video</option>
                </select>
              </Label>
            </FieldWrap>
            <FieldWrap>
              <Label>
                Scheduler
                <select style={inputStyle} value={data.scheduler} onChange={(e) => handleChange('scheduler', e.target.value)}>
                  <option value="">Default</option>
                  <option value="cogvideox_ddim">DDIM (CogVideoX)</option>
                  <option value="cogvideox_dpm">DPM (CogVideoX)</option>
                  <option value="flow_match_euler">Flow Euler (LTX)</option>
                  <option value="flow_match_heun">Flow Heun (LTX)</option>
                  <option value="ltx_euler_ancestral_rf">Euler Ancestral RF (LTX)</option>
                </select>
              </Label>
            </FieldWrap>
          </>
        )
      }

      case 'samplingParams': {
        const data = n.data as SamplingParamsData
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
                Width
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
                Height
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
            <FieldWrap>
              <Label>
                Scheduler
                <select style={inputStyle} value={data.scheduler} onChange={(e) => handleChange('scheduler', e.target.value)}>
                  <option value="">Default</option>
                  <option value="cogvideox_ddim">DDIM (CogVideoX)</option>
                  <option value="cogvideox_dpm">DPM (CogVideoX)</option>
                  <option value="flow_match_euler">Flow Euler (LTX)</option>
                  <option value="flow_match_heun">Flow Heun (LTX)</option>
                  <option value="ltx_euler_ancestral_rf">Euler Ancestral RF (LTX)</option>
                </select>
              </Label>
            </FieldWrap>
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
