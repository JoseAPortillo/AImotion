import { memo, useCallback, useRef } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, type NodeType } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'

function VideoInputNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const inputRef = useRef<HTMLInputElement>(null)
  const { fileName } = props.data as { fileName?: string }

  const handleFile = useCallback(
    (file: File) => {
      useGraphStore.getState().updateNodeData(props.id, { file, fileName: file.name })
    },
    [props.id]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file && /\.(mp4|mov|avi|mkv)$/i.test(file.name)) handleFile(file)
    },
    [handleFile]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  const handleClick = () => inputRef.current?.click()

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 200 }}>
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
        <span>{def.label}</span>
      </div>
      <div
        style={{ padding: 10, fontSize: 12, color: '#ccc', cursor: 'pointer', border: '2px dashed #555', margin: 8, borderRadius: 4, textAlign: 'center' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        {fileName || 'Drop video file here'}
      </div>
      <input ref={inputRef} type="file" accept=".mp4,.mov,.avi,.mkv" style={{ display: 'none' }} onChange={handleChange} />
      <Handle type="source" position={Position.Bottom} id="video" style={{ bottom: -4 }}>
        <div style={{ position: 'absolute', left: 14, top: -2, fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    </div>
  )
}

export default memo(VideoInputNode)
