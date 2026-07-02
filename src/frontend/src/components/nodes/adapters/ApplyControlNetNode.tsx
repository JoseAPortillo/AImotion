import { memo, useCallback, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type ControlNetData } from '../../../types/nodes'
import NodeWrapper from '../NodeWrapper'
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
    <NodeWrapper def={def} selected={props.selected} footer={
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={handleApply}
          disabled={applying}
          style={{
            flex: 1,
            padding: '3px 0',
            borderRadius: 4,
            border: 'none',
            fontSize: 10,
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
              padding: '3px 6px',
              borderRadius: 4,
              border: 'none',
              fontSize: 10,
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
    }>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc' }}>
        <input
          value={cnInput}
          onChange={(e) => setCnInput(e.target.value)}
          placeholder="HF model ID (e.g. lllyasviel/control_v11p_sd15_openpose)"
          style={{
            background: '#0f0f0f',
            border: '1px solid #333',
            borderRadius: 4,
            color: '#ccc',
            padding: '2px 4px',
            fontSize: 9,
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
            marginBottom: 4,
          }}
        />
        <div style={{ fontSize: 9, color: '#888' }}>
          Requires pipeline reconstruction — not yet implemented
        </div>
        {data.active && (
          <div style={{ marginTop: 3, fontSize: 9, color: '#4ade80' }}>● Active</div>
        )}
      </div>

      <Handle type="target" position={Position.Left} id="image_in" style={{ top: '33%', background: getHandleColor('image_in', 'video_tensor') }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: getHandleColor('image_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Conditioning</div>
      </Handle>
      <Handle type="target" position={Position.Left} id="model_in" style={{ top: '66%', background: PORT_COLORS.params }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: PORT_COLORS.params, whiteSpace: 'nowrap' }}>Model</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="model_out" style={{ top: '50%', background: PORT_COLORS.params }}>
        <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: PORT_COLORS.params, whiteSpace: 'nowrap' }}>Model + CN</div>
      </Handle>
    </NodeWrapper>
  )
}

export default memo(ApplyControlNetNode)
