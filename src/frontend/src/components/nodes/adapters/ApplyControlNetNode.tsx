import { memo, useCallback, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type ControlNetData } from '../../../types/nodes'
import { useGraphStore } from '../../../store/graph'
import { useToastStore } from '../../../store/toast'

function ApplyControlNetNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as ControlNetData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const addToast = useToastStore((s) => s.addToast)
  const [applying, setApplying] = useState(false)
  const [cnInput, setCnInput] = useState('')

  const handleApply = useCallback(async () => {
    if (!cnInput) {
      addToast('Enter a ControlNet model name (HF model ID)', 'info')
      return
    }
    if (!data.model) {
      addToast('Select a model from the Diffuser Generator first', 'info')
      return
    }

    setApplying(true)
    try {
      const r = await fetch('/adapters/controlnet/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: data.model, controlnet_model: cnInput }),
      })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.detail || 'Failed to apply ControlNet')
      }
      updateNodeData(props.id, { controlnetModel: cnInput, active: true } as Partial<ControlNetData>)
      addToast(`ControlNet applied: ${cnInput}`, 'success')
    } catch (err: any) {
      addToast(`ControlNet error: ${err.message}`, 'error')
    } finally {
      setApplying(false)
    }
  }, [props.id, data, cnInput, updateNodeData])

  const handleUnload = useCallback(async () => {
    try {
      const r = await fetch('/adapters/controlnet/unload', { method: 'POST' })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.detail || 'Failed to unload ControlNet')
      }
      updateNodeData(props.id, { active: false } as Partial<ControlNetData>)
      addToast('ControlNet unloaded', 'success')
    } catch (err: any) {
      addToast(`ControlNet error: ${err.message}`, 'error')
    }
  }, [props.id, updateNodeData])

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, position: 'relative', paddingBottom: 38 }}>
      {props.selected && <NodeResizer handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, borderRadius: '8px 8px 0 0' }}>
        {def.label}
      </div>
      <div style={{ padding: '6px 10px', fontSize: 12, color: '#ccc' }}>
        <input
          value={cnInput}
          onChange={(e) => setCnInput(e.target.value)}
          placeholder="HF model ID (e.g. lllyasviel/control_v11p_sd15_openpose)"
          style={{
            background: '#0f0f0f',
            border: '1px solid #333',
            borderRadius: 4,
            color: '#ccc',
            padding: '3px 6px',
            fontSize: 10,
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
            marginBottom: 6,
          }}
        />
        <div style={{ fontSize: 10, color: '#888' }}>
          Requires pipeline reconstruction — not yet implemented
        </div>
        {data.active && (
          <div style={{ marginTop: 4, fontSize: 10, color: '#4ade80' }}>● Active</div>
        )}
      </div>

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid #2a2a2a', padding: '6px 10px', background: '#1a1a1a', display: 'flex', gap: 6 }}>
        <button
          onClick={handleApply}
          disabled={applying}
          style={{
            flex: 1,
            padding: '4px 0',
            borderRadius: 4,
            border: 'none',
            fontSize: 11,
            fontWeight: 600,
            cursor: applying ? 'not-allowed' : 'pointer',
            background: applying ? '#333' : '#10b981',
            color: applying ? '#888' : '#0f0f0f',
          }}
        >
          {applying ? 'Applying...' : 'Apply'}
        </button>
        {data.active && (
          <button
            onClick={handleUnload}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: 'none',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              background: '#e11d48',
              color: '#fff',
            }}
          >
            X
          </button>
        )}
      </div>

      <Handle type="target" position={Position.Left} id="image_in" style={{ top: '33%', background: getHandleColor('image_in', 'video_tensor') }}>
        <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color: getHandleColor('image_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Conditioning</div>
      </Handle>
      <Handle type="target" position={Position.Left} id="model_in" style={{ top: '66%', background: PORT_COLORS.params }}>
        <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color: PORT_COLORS.params, whiteSpace: 'nowrap' }}>Model</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="model_out" style={{ top: '50%', background: PORT_COLORS.params }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: PORT_COLORS.params, whiteSpace: 'nowrap' }}>Model + CN</div>
      </Handle>
    </div>
  )
}

export default memo(ApplyControlNetNode)
