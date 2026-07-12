import { memo, useEffect, useMemo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType, type GenerationData, type ModelEntry } from '../../../types/nodes'
import NodeWrapper, { CollapsibleSection, InfoLabel, FIELD_DESCS } from '../NodeWrapper'
import { useGeneratorBase, formatEta, schedLabels } from '../../../hooks/useGeneratorBase'
import { useAutoPreview } from '../../../hooks/useAutoPreview'
import ModelSelect from '../../ModelSelect'
import NumberInput from '../../NumberInput'

type ResPreset = { label: string; w: number; h: number }

const MODEL_PRESETS: Record<string, ResPreset[]> = {
  'cogvideox': [
    { label: 'Custom', w: 0, h: 0 },
    { label: '640×480', w: 640, h: 480 },
    { label: '720×480 (native)', w: 720, h: 480 },
    { label: '800×480', w: 800, h: 480 },
    { label: '960×576', w: 960, h: 576 },
    { label: '1024×576', w: 1024, h: 576 },
    { label: '1280×720', w: 1280, h: 720 },
  ],
  'ltx-video': [
    { label: 'Custom', w: 0, h: 0 },
    { label: '512×512', w: 512, h: 512 },
    { label: '704×512 (native)', w: 704, h: 512 },
    { label: '768×512', w: 768, h: 512 },
    { label: '1024×576', w: 1024, h: 576 },
    { label: '1280×720', w: 1280, h: 720 },
    { label: '1920×1080', w: 1920, h: 1080 },
  ],
  'wan2.2': [
    { label: 'Custom', w: 0, h: 0 },
    { label: '720×480', w: 720, h: 480 },
    { label: '832×480', w: 832, h: 480 },
    { label: '1024×576', w: 1024, h: 576 },
    { label: '1280×720', w: 1280, h: 720 },
  ],
}

const DEFAULT_PRESETS: ResPreset[] = [
  { label: 'Custom', w: 0, h: 0 },
  { label: '512×512', w: 512, h: 512 },
  { label: '720×480', w: 720, h: 480 },
  { label: '768×512', w: 768, h: 512 },
  { label: '1024×576', w: 1024, h: 576 },
  { label: '1024×1024', w: 1024, h: 1024 },
  { label: '1280×720', w: 1280, h: 720 },
]

function presetsForModel(modelKey: string | undefined): ResPreset[] {
  if (!modelKey) return DEFAULT_PRESETS
  const prefix = Object.keys(MODEL_PRESETS).find(k => modelKey.startsWith(k))
  return prefix ? MODEL_PRESETS[prefix] : DEFAULT_PRESETS
}

const selectStyle: React.CSSProperties = {
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ccc',
  padding: '2px 4px',
  fontSize: 10,
  outline: 'none',
  width: '100%',
  marginTop: 3,
}

interface NodeBaseProps extends NodeProps {
  modalityFilter: (m: ModelEntry) => boolean
  activeInputs: string[]
  outputLabel: string
  outputColor: string
}

function GeneratorNodeBase(props: NodeBaseProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as GenerationData
  const base = useGeneratorBase({ nodeId: props.id, data, modalityFilter: props.modalityFilter })
  const autoPreview = useAutoPreview({ nodeId: props.id, data })

  const activeInputs = useMemo(() => new Set(props.activeInputs), [props.activeInputs])

  useEffect(() => {
    if (!base.modelsLoaded || base.visibleModels.length === 0) return
    const currentInList = base.visibleModels.some(m => m.key === data.model)
    if (!currentInList) {
      base.handleModelChange(base.visibleModels[0].key)
    }
  }, [base.modelsLoaded])

  return (
    <NodeWrapper
      def={def}
      selected={props.selected}
      style={{ width: props.width, height: props.height }}
      headerLabel="Diffuser Generator"
      headerRight={
        <span style={{ fontSize: 9, opacity: 0.9, background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>
          {def.label}
        </span>
      }
      handles={
        <>
          {def.inputs.map((inp, i) => {
            const isActive = activeInputs.has(inp.id)
            const color = getHandleColor(inp.id, inp.type)
            const activeIdx = [...activeInputs].indexOf(inp.id)
            const top = activeIdx >= 0 ? `${((activeIdx + 1) / (activeInputs.size + 1)) * 100}%` : '50%'
            return (
              <Handle
                key={inp.id}
                type="target"
                position={Position.Left}
                id={inp.id}
                style={{
                  top,
                  background: color,
                  opacity: isActive ? 1 : 0,
                  pointerEvents: isActive ? 'auto' : 'none',
                }}
              >
                {isActive && (
                  <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color, whiteSpace: 'nowrap' }}>
                    {inp.label}
                  </div>
                )}
              </Handle>
            )
          })}
          <Handle type="source" position={Position.Right} id={def.outputs[0]?.id || 'video_out'} style={{ top: '50%', background: props.outputColor }}>
            <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: props.outputColor, whiteSpace: 'nowrap' }}>
              {props.outputLabel}
            </div>
          </Handle>
        </>
      }
      progressBar={base.genRunning && (
        <div style={{ padding: '4px 6px', borderTop: '1px solid #2a2a2a', background: '#1a1a1a', flexShrink: 0 }}>
          {base.etaSec != null && (
            <div style={{ fontSize: 9, color: '#2563eb', marginBottom: 2, fontVariantNumeric: 'tabular-nums' }}>
              ETA {formatEta(base.etaSec)}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#2a2a2a', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(base.progress, 100)}%`, height: '100%', borderRadius: 2, background: '#2563eb', transition: 'width 0.3s ease' }} />
            </div>
            <span style={{ fontSize: 9, color: '#999', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{base.progress}%</span>
          </div>
        </div>
      )}
      footer={
        base.genRunning ? (
          <button
            onClick={base.handleCancel}
            style={{
              width: '100%',
              padding: '4px 0',
              borderRadius: 4,
              border: 'none',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              background: '#ef4444',
              color: '#fff',
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={base.handleGenWorkflow}
            style={{
              width: '100%',
              padding: '4px 0',
              borderRadius: 4,
              border: 'none',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              background: '#4ade80',
              color: '#0f0f0f',
            }}
          >
            Generate ▶
          </button>
        )
      }
    >
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <ModelSelect
              value={data.model}
              models={base.visibleModels}
              onChange={base.handleModelChange}
              placeholder={base.modelsLoaded ? 'No models available' : 'Loading...'}
            />
          </div>
        </div>

        {base.modelConfig && (
          <div style={{ marginTop: 4, padding: 4, background: '#131313', borderRadius: 4, fontSize: 9, color: '#777', lineHeight: 1.5 }}>
            <div style={{ color: '#999', fontWeight: 600 }}>{base.modelConfig.name}</div>
            {base.modelConfig.pipeline_class && <div style={{ color: '#666' }}>{base.modelConfig.pipeline_class}</div>}
          </div>
        )}

        <CollapsibleSection title="Scheduler" defaultOpen={true}>
          <select
            value={data.scheduler}
            onChange={(e) => base.updateNodeData(props.id, { scheduler: e.target.value } as Partial<GenerationData>)}
            style={selectStyle}
          >
            <option value="">Default{base.defaultSched ? ` (${schedLabels[base.defaultSched] || base.defaultSched})` : ''}</option>
            {base.availableScheds.map(s => (
              <option key={s} value={s}>{schedLabels[s] || s}</option>
            ))}
          </select>
          {base.schedLabel && <div style={{ marginTop: 1, fontSize: 9, color: '#888' }}>Current: {base.schedLabel}</div>}
        </CollapsibleSection>

        <CollapsibleSection title="Básicos" defaultOpen={true}>
          <div style={{ marginTop: 2 }}>
            <InfoLabel label="Steps" desc={FIELD_DESCS.steps} />
            <NumberInput
              value={data.steps ?? 50}
              min={1} max={200}
              onChange={(v) => base.updateNodeData(props.id, { steps: v } as Partial<GenerationData>)}
            />
          </div>
          <div style={{ marginTop: 4 }}>
            <InfoLabel label="CFG" desc={FIELD_DESCS.cfg} />
            <NumberInput
              value={data.cfg ?? 6}
              min={1} max={20} step={0.5}
              onChange={(v) => base.updateNodeData(props.id, { cfg: v } as Partial<GenerationData>)}
            />
          </div>
          <div style={{ marginTop: 4 }}>
            <InfoLabel label="Seed" desc={FIELD_DESCS.seed} />
            <NumberInput
              value={data.seed ?? 0}
              min={0}
              onChange={(v) => base.updateNodeData(props.id, { seed: v } as Partial<GenerationData>)}
            />
          </div>
          <div style={{ marginTop: 4 }}>
            <InfoLabel label="Strength" desc={FIELD_DESCS.strength} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={data.strength ?? 0.8}
                onChange={(e) => base.updateNodeData(props.id, { strength: parseFloat(e.target.value) } as Partial<GenerationData>)}
                style={{ flex: 1, marginTop: 1 }}
              />
              <span style={{ fontSize: 9, color: '#999', minWidth: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {(data.strength ?? 0.8).toFixed(2)}
              </span>
            </div>
          </div>
          {base.modelConfig?.inputs?.width && base.modelConfig?.inputs?.height && (() => {
            const wInp = base.modelConfig!.inputs!.width!
            const hInp = base.modelConfig!.inputs!.height!
            const availablePresets = presetsForModel(data.model).filter(p => p.w === 0 || (
              p.w >= (wInp.min ?? 0) &&
              p.w <= (wInp.max ?? 99999) &&
              p.h >= (hInp.min ?? 0) &&
              p.h <= (hInp.max ?? 99999)
            ))
            const currentW = data.width ?? wInp.default ?? 0
            const currentH = data.height ?? hInp.default ?? 0
            const matchedPreset = availablePresets.find(p => p.w === currentW && p.h === currentH)
            return (
              <div key="wh-group" style={{ marginTop: 4 }}>
                <div style={{ marginTop: 4 }}>
                  <InfoLabel label="Resolution" desc={`${FIELD_DESCS.width} | ${FIELD_DESCS.height}`} />
                  <select
                    value={matchedPreset ? matchedPreset.label : 'Custom'}
                    onChange={(e) => {
                      const preset = presetsForModel(data.model).find(p => p.label === e.target.value)
                      if (preset && preset.w > 0) {
                        base.updateNodeData(props.id, { width: preset.w, height: preset.h } as Partial<GenerationData>)
                      }
                    }}
                    style={selectStyle}
                  >
                    {availablePresets.map(p => (
                      <option key={p.label} value={p.label}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 8, color: '#888' }}>width</span>
                    <NumberInput
                      value={currentW}
                      min={wInp.min} max={wInp.max}
                      onChange={(v) => base.updateNodeData(props.id, { width: v } as Partial<GenerationData>)}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 8, color: '#888' }}>height</span>
                    <NumberInput
                      value={currentH}
                      min={hInp.min} max={hInp.max}
                      onChange={(v) => base.updateNodeData(props.id, { height: v } as Partial<GenerationData>)}
                    />
                  </div>
                </div>
              </div>
            )
          })()}
        </CollapsibleSection>

        <CollapsibleSection title="Avanzados" defaultOpen={false}>
          <div style={{ marginTop: 2 }}>
            <label style={{ fontSize: 9, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={data.vae_tiling}
                onChange={(e) => base.updateNodeData(props.id, { vae_tiling: e.target.checked } as Partial<GenerationData>)}
              />
              <span title={FIELD_DESCS.vae_tiling} style={{ borderBottom: '1px dotted #555', cursor: 'help' }}>VAE Tiling</span>
            </label>
            {data.vae_tiling && (
              <div style={{ marginTop: 2 }}>
                <span style={{ fontSize: 8, color: '#888' }}>Tile Overlap: {data.vae_tile_overlap > 0 ? data.vae_tile_overlap : 'VAE default'}</span>
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.1"
                  value={data.vae_tile_overlap}
                  onChange={(e) => base.updateNodeData(props.id, { vae_tile_overlap: parseFloat(e.target.value) } as Partial<GenerationData>)}
                  style={{ width: '100%', marginTop: 1 }}
                />
              </div>
            )}
          </div>
          {Object.entries(base.modelConfig?.inputs ?? {})
            .filter(([name, inp]) => !inp.hidden && (inp.type === 'int' || inp.type === 'float') && inp.default != null && name !== 'width' && name !== 'height')
            .map(([name, inp]) => {
              const isFloat = inp.type === 'float'
              const desc = FIELD_DESCS[name]
              return (
                <div key={name} style={{ marginTop: 4 }}>
                  <InfoLabel label={name.replace(/_/g, ' ')} desc={desc} />
                  <NumberInput
                    value={(data[name as keyof GenerationData] ?? inp.default) as number}
                    min={inp.min}
                    max={inp.max}
                    step={isFloat ? 0.01 : 1}
                    onChange={(v) => base.updateNodeData(props.id, { [name]: v } as Partial<GenerationData>)}
                  />
                </div>
              )
            })}
        </CollapsibleSection>

        {(autoPreview.previewRunning || autoPreview.previewUrl) && (
          <CollapsibleSection title="Auto Preview" defaultOpen={true}>
            <div style={{ marginTop: 4, textAlign: 'center' }}>
              {autoPreview.previewRunning && (
                <div style={{ padding: '4px 6px', background: '#1a1a1a', borderRadius: 4, marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: '#2a2a2a', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(autoPreview.previewProgress * 100, 100)}%`, height: '100%', borderRadius: 2, background: '#6366f1', transition: 'width 0.3s ease' }} />
                    </div>
                    <span style={{ fontSize: 9, color: '#999', minWidth: 24, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(autoPreview.previewProgress * 100)}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 8, color: '#6366f1' }}>
                      {autoPreview.previewTotalSteps > 0
                        ? `Step ${autoPreview.previewCurrentStep}/${autoPreview.previewTotalSteps}`
                        : 'Generating...'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {autoPreview.previewEtaSec != null && (
                        <span style={{ fontSize: 8, color: '#2563eb', fontVariantNumeric: 'tabular-nums' }}>
                          ETA {formatEta(autoPreview.previewEtaSec)}
                        </span>
                      )}
                      <button
                      onClick={autoPreview.cancelAutoPreview}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 3,
                        border: 'none',
                        fontSize: 9,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: '#ef4444',
                        color: '#fff',
                      }}
                    >
                      Stop
                    </button>
                  </div>
                </div>
              </div>
              )}
              {autoPreview.previewUrl && (
                <>
                  {autoPreview.previewType === 'video' ? (
                    <video src={autoPreview.previewUrl} controls autoPlay loop
                      style={{ width: '100%', maxWidth: 200, maxHeight: 160, borderRadius: 4, display: 'block', margin: '0 auto', opacity: autoPreview.previewRunning ? 0.5 : 1 }}
                    />
                  ) : (
                    <img src={autoPreview.previewUrl} alt="Preview"
                      style={{ width: '100%', maxWidth: 200, maxHeight: 200, borderRadius: 4, display: 'block', margin: '0 auto', opacity: autoPreview.previewRunning ? 0.5 : 1 }}
                    />
                  )}
                </>
              )}
            </div>
          </CollapsibleSection>
        )}

      </div>
    </NodeWrapper>
  )
}

export default memo(GeneratorNodeBase)
