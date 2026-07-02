import { memo, useCallback, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, type NodeType, type LoRAData } from '../../../types/nodes'
import NodeWrapper from '../NodeWrapper'
import { useGraphStore } from '../../../store/graph'
import { useToastStore } from '../../../store/toast'

function LoadLoRANode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as LoRAData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const addToast = useToastStore((s) => s.addToast)
  const inputRef = useRef<HTMLInputElement>(null)
  const [applying, setApplying] = useState(false)

  const handleFile = useCallback((file: File) => {
    updateNodeData(props.id, { loraFile: file.name } as Partial<LoRAData>)
  }, [props.id, updateNodeData])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleApply = useCallback(async () => {
    const file = inputRef.current?.files?.[0]
    if (!file) {
      addToast('Select a LoRA weight file first', 'info')
      return
    }
    if (!data.model) {
      addToast('Select a model from the Diffuser Generator first', 'info')
      return
    }

    setApplying(true)
    try {
      const formData = new FormData()
      formData.append('lora_file', file)
      formData.append('model', data.model)
      formData.append('scale', String(data.scale))

      const r = await fetch('/adapters/lora/apply', { method: 'POST', body: formData })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.detail || 'Failed to apply LoRA')
      }
      updateNodeData(props.id, { active: true } as Partial<LoRAData>)
      addToast(`LoRA applied: ${file.name}`, 'success')
    } catch (err: any) {
      addToast(`LoRA error: ${err.message}`, 'error')
    } finally {
      setApplying(false)
    }
  }, [props.id, data, updateNodeData])

  const handleUnload = useCallback(async () => {
    try {
      const r = await fetch('/adapters/lora/unload', { method: 'POST' })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.detail || 'Failed to unload LoRA')
      }
      updateNodeData(props.id, { active: false } as Partial<LoRAData>)
      addToast('LoRA unloaded', 'success')
    } catch (err: any) {
      addToast(`LoRA error: ${err.message}`, 'error')
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
            background: applying ? '#333' : '#f97316',
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
          ref={inputRef}
          type="file"
          accept=".safetensors,.bin,.pt,.pth"
          onChange={handleChange}
          style={{ fontSize: 9, color: '#ccc', width: '100%', marginBottom: 4 }}
        />
        {data.loraFile && (
          <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>File: {String(data.loraFile)}</div>
        )}
        <div>
          <label style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1 }}>Scale: {Number(data.scale).toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={data.scale}
            onChange={(e) => updateNodeData(props.id, { scale: parseFloat(e.target.value) } as Partial<LoRAData>)}
            style={{ width: '100%' }}
          />
        </div>
        {data.active && (
          <div style={{ marginTop: 3, fontSize: 9, color: '#4ade80' }}>● Active</div>
        )}
      </div>

      <Handle type="target" position={Position.Left} id="model_in" style={{ top: '50%', background: PORT_COLORS.params }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: PORT_COLORS.params, whiteSpace: 'nowrap' }}>Model</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="model_out" style={{ top: '50%', background: PORT_COLORS.params }}>
        <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: PORT_COLORS.params, whiteSpace: 'nowrap' }}>Model + LoRA</div>
      </Handle>
    </NodeWrapper>
  )
}

export default memo(LoadLoRANode)
