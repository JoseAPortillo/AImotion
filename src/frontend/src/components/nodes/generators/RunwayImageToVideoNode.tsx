import { memo, useEffect, useMemo, useState, useRef, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type GenerationData, type ModelEntry } from '../../../types/nodes'
import NodeWrapper from '../NodeWrapper'
import { useGeneratorBase, formatEta } from '../../../hooks/useGeneratorBase'
import { useAutoPreview } from '../../../hooks/useAutoPreview'

const NUMBER_INPUT: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', alignItems: 'center', gap: 2 },
  btn: {
    width: 16, height: 16, borderRadius: 3, border: '1px solid #444',
    background: '#1a1a1a', color: '#ccc', fontSize: 10, lineHeight: '14px',
    textAlign: 'center', cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  input: {
    width: '100%', background: 'transparent', border: 'none',
    color: '#ccc', fontSize: 10, textAlign: 'center', outline: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
}

function NumberInput({ value, min, max, step, onChange, style }: {
  value: number; min?: number; max?: number; step?: number
  onChange: (v: number) => void; style?: React.CSSProperties
}) {
  const stepVal = step ?? 1
  return (
    <div style={{ ...NUMBER_INPUT.wrapper, ...style }}>
      <div style={NUMBER_INPUT.btn as any} onClick={() => onChange(Math.max(min ?? -Infinity, value - stepVal))}>−</div>
      <input
        type="number" style={NUMBER_INPUT.input}
        value={value} min={min} max={max} step={stepVal}
        onChange={e => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)))
        }}
      />
      <div style={NUMBER_INPUT.btn as any} onClick={() => onChange(Math.min(max ?? Infinity, value + stepVal))}>+</div>
    </div>
  )
}

function formatPricingShort(m: ModelEntry): string {
  const p = m.pricing
  if (!p) return ''
  if (p.credits_per_second) {
    let s = `${p.credits_per_second} cr/s`
    if (p.min_credits) s += ` · min ${p.min_credits}`
    return s
  }
  return ''
}

function ModelListbox({
  models, value, onChange, placeholder,
}: {
  models: ModelEntry[]; value: string; onChange: (key: string) => void; placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = models.find(m => m.key === value)

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
        onClick={() => setOpen(!open)}
        style={{
          background: '#0f0f0f', border: '1px solid #333', borderRadius: 4,
          color: selected ? '#ccc' : '#666', padding: '2px 4px', fontSize: 10,
          outline: 'none', width: '100%', cursor: 'pointer', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center',
        }}
      >
        {selected ? (
          <>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</span>
            <span style={{ color: '#4ade80', fontSize: 9, whiteSpace: 'nowrap', marginLeft: 8 }}>{formatPricingShort(selected)}</span>
          </>
        ) : (
          <span>{placeholder || 'Select model'}</span>
        )}
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
          background: '#1a1a1a', border: '1px solid #333', borderRadius: 4,
          maxHeight: 220, overflowY: 'auto', marginTop: 2,
          boxShadow: '0 4px 12px rgba(0,0,0,.5)',
        }}>
          {models.length === 0 && (
            <div style={{ padding: '4px 6px', color: '#666', fontSize: 10 }}>No models</div>
          )}
          {models.map(m => {
            const pricingText = formatPricingShort(m)
            const resText = m.resolutions?.join(', ')
            return (
              <div
                key={m.key} role="option" aria-selected={m.key === value}
                onClick={() => { onChange(m.key); setOpen(false) }}
                style={{
                  padding: '5px 6px', fontSize: 10, cursor: 'pointer',
                  borderBottom: '1px solid #222',
                  background: m.key === value ? '#2a2a2a' : 'transparent',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2a2a2a' }}
                onMouseLeave={e => { if (m.key !== value) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: '#ccc', flex: 1 }}>{m.name}</span>
                  {pricingText && <span style={{ color: '#4ade80', fontSize: 9, whiteSpace: 'nowrap', marginLeft: 8 }}>{pricingText}</span>}
                </div>
                {resText && <div style={{ color: '#888', fontSize: 9, marginTop: 1 }}>{resText}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RatioSelect({
  resolutions, value, onChange, modelPricing,
}: {
  resolutions: string[]; value: string; onChange: (v: string) => void; modelPricing?: { credits_per_second?: number; min_credits?: number; tiers?: Record<string, number> }
}) {
  const hasRatioPricing = modelPricing?.tiers && Object.keys(modelPricing.tiers).length > 0
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', background: '#0f0f0f', border: '1px solid #333',
          borderRadius: 4, color: '#ccc', padding: '2px 4px', fontSize: 10,
          outline: 'none',
        }}
      >
        {resolutions.map(r => {
          const tierCost = hasRatioPricing ? modelPricing!.tiers![r] : undefined
          return (
            <option key={r} value={r}>
              {r}{tierCost != null ? `  — ${tierCost} cr/s` : ''}
            </option>
          )
        })}
      </select>
    </div>
  )
}

function RunwayImageToVideoNode(props: NodeProps) {
  const def = NODE_DEFINITIONS.runwayImageToVideo
  const data = props.data as GenerationData
  const base = useGeneratorBase({
    nodeId: props.id,
    data,
    modalityFilter: (m: ModelEntry) => m.runner === 'api' && m.key.startsWith('runway') && m.key.includes('i2v'),
  })
  const autoPreview = useAutoPreview({ nodeId: props.id, data, autoTrigger: false })

  const activeInputs = useMemo(() => {
    return new Set<string>(['prompt_pos', 'prompt_neg', 'image_in'])
  }, [])

  const allInputs = useMemo(() => {
    const inputs = [...def.inputs]
    if (!inputs.find(i => i.id === 'image_in')) {
      inputs.push({ id: 'image_in', label: 'Image', type: 'video_tensor' as const })
    }
    return inputs
  }, [])

  useEffect(() => {
    if (!base.modelsLoaded || base.visibleModels.length === 0) return
    const currentInList = base.visibleModels.some(m => m.key === data.model)
    if (!currentInList) {
      base.handleModelChange(base.visibleModels[0].key)
    }
  }, [base.modelsLoaded])

  const resolutions = base.modelConfig?.resolutions ?? []
  const storedRatio = (data as any).targetAspectRatio
  const selectedRatio = (storedRatio && resolutions.includes(storedRatio)) ? storedRatio : (resolutions[0] || '1280:720')

  const handleRatioChange = useCallback((ratio: string) => {
    base.updateNodeData(props.id, { targetAspectRatio: ratio } as any)
  }, [base.updateNodeData, props.id])

  const handleSeedChange = useCallback((v: number) => {
    base.updateNodeData(props.id, { seed: v } as any)
  }, [base.updateNodeData, props.id])

  const handleDurationChange = useCallback((v: number) => {
    base.updateNodeData(props.id, { duration: v } as any)
  }, [base.updateNodeData, props.id])

  const duration = (data as any).duration ?? 5

  return (
    <NodeWrapper
      def={def}
      selected={props.selected}
      style={{ width: props.width, height: props.height }}
      headerLabel="Runway I2V"
      headerRight={
        <span style={{ fontSize: 9, opacity: 0.9, background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>
          {def.label}
        </span>
      }
      handles={
        <>
          {allInputs.map((inp) => {
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
          <Handle type="source" position={Position.Right} id="video_out" style={{ top: '50%', background: '#4ade80' }}>
            <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: '#4ade80', whiteSpace: 'nowrap' }}>
              Video
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
              width: '100%', padding: '4px 0', borderRadius: 4, border: 'none',
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: '#ef4444', color: '#fff',
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={base.handleGenWorkflow}
            style={{
              width: '100%', padding: '4px 0', borderRadius: 4, border: 'none',
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: '#6366f1', color: '#fff',
            }}
          >
            Generate ▶
          </button>
        )
      }
    >
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ModelListbox
          models={base.visibleModels}
          value={data.model}
          onChange={base.handleModelChange}
          placeholder={base.modelsLoaded ? 'No models' : 'Loading...'}
        />

        {resolutions.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>Aspect Ratio</div>
            <RatioSelect
              resolutions={resolutions} value={selectedRatio} onChange={handleRatioChange}
              modelPricing={base.modelConfig?.pricing}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>Seed</div>
            <NumberInput
              value={data.seed ?? 42}
              min={0} max={2147483647} step={1}
              onChange={handleSeedChange}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>Duration (s)</div>
            <NumberInput
              value={duration}
              min={2} max={10} step={1}
              onChange={handleDurationChange}
            />
          </div>
        </div>

        {!autoPreview.previewRunning && !autoPreview.previewUrl && (
          <button
            onClick={() => autoPreview.triggerPreview()}
            disabled={!data.model}
            style={{
              width: '100%',
              marginTop: 4,
              padding: '4px 0',
              borderRadius: 4,
              border: 'none',
              fontSize: 10,
              fontWeight: 600,
              cursor: data.model ? 'pointer' : 'not-allowed',
              background: data.model ? '#6366f1' : '#333',
              color: data.model ? '#fff' : '#888',
            }}
          >
            Generate Preview
          </button>
        )}

        {(autoPreview.previewRunning || autoPreview.previewUrl) && (
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
              autoPreview.previewType === 'video' ? (
                <video src={autoPreview.previewUrl} controls autoPlay loop
                  style={{ width: '100%', maxWidth: 200, maxHeight: 160, borderRadius: 4, display: 'block', margin: '0 auto', opacity: autoPreview.previewRunning ? 0.5 : 1 }}
                />
              ) : (
                <img src={autoPreview.previewUrl} alt="Preview"
                  style={{ width: '100%', maxWidth: 200, maxHeight: 200, borderRadius: 4, display: 'block', margin: '0 auto', opacity: autoPreview.previewRunning ? 0.5 : 1 }}
                />
              )
            )}
          </div>
        )}
      </div>
    </NodeWrapper>
  )
}

export default memo(RunwayImageToVideoNode)
