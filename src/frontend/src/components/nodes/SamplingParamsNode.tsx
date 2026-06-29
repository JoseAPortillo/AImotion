import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, getResolutionPresetKey, RESOLUTION_PRESETS, type NodeType, type SamplingParamsData } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'

const inputRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
}

const inlineInput: React.CSSProperties = {
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ccc',
  padding: '2px 6px',
  fontSize: 11,
  width: 52,
  fontFamily: 'monospace',
  outline: 'none',
}

const inlineLabel: React.CSSProperties = {
  color: '#999',
  fontSize: 11,
  minWidth: 30,
}

const selectStyle: React.CSSProperties = {
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ccc',
  padding: '2px 6px',
  fontSize: 11,
  outline: 'none',
  width: '100%',
  marginBottom: 4,
}

function SamplingParamsNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as SamplingParamsData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)

  const presetKey = getResolutionPresetKey(data.width, data.height)

  const handlePreset = useCallback((key: string) => {
    const p = RESOLUTION_PRESETS[key]
    if (p) {
      updateNodeData(props.id, { width: p.width, height: p.height } as Partial<SamplingParamsData>)
    }
  }, [props.id, updateNodeData])

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 220, minHeight: 80, position: 'relative' }}>
      {props.selected && <NodeResizer minWidth={180} minHeight={80} handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: '6px 10px', fontSize: 12, color: '#ccc' }}>
        <div style={inputRow}>
          <span style={inlineLabel}>Steps</span>
          <input style={inlineInput} type="number" min={1} max={200} value={data.steps} onChange={(e) => updateNodeData(props.id, { steps: parseInt(e.target.value, 10) || 1 } as Partial<SamplingParamsData>)} />
          <span style={{ ...inlineLabel, marginLeft: 8 }}>CFG</span>
          <input style={inlineInput} type="number" min={1} max={20} step={0.5} value={data.cfg} onChange={(e) => updateNodeData(props.id, { cfg: parseFloat(e.target.value) || 1 } as Partial<SamplingParamsData>)} />
        </div>
        <div style={inputRow}>
          <span style={inlineLabel}>Seed</span>
          <input style={{ ...inlineInput, width: 80 }} type="number" min={0} value={data.seed} onChange={(e) => updateNodeData(props.id, { seed: parseInt(e.target.value, 10) || 0 } as Partial<SamplingParamsData>)} />
        </div>
        <div>
          <select style={selectStyle} value={presetKey || '__custom__'} onChange={(e) => handlePreset(e.target.value)}>
            {presetKey === null && <option value="__custom__">Custom</option>}
            {Object.entries(RESOLUTION_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
            <option value="__custom__">Custom...</option>
          </select>
        </div>
        <div style={inputRow}>
          <span style={inlineLabel}>Res</span>
          <input style={inlineInput} type="number" min={128} max={768} step={8} value={data.width} onChange={(e) => updateNodeData(props.id, { width: parseInt(e.target.value, 10) || 128 } as Partial<SamplingParamsData>)} />
          <span style={{ color: '#555' }}>×</span>
          <input style={inlineInput} type="number" min={128} max={768} step={8} value={data.height} onChange={(e) => updateNodeData(props.id, { height: parseInt(e.target.value, 10) || 128 } as Partial<SamplingParamsData>)} />
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="params" style={{ top: '50%', background: getHandleColor('params', 'params') }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: getHandleColor('params', 'params'), whiteSpace: 'nowrap' }}>Params</div>
      </Handle>
    </div>
  )
}

export default memo(SamplingParamsNode)
