import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'

function VideoInputNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const inputRef = useRef<HTMLInputElement>(null)
  const data = props.data as { file?: File; fileName?: string }
  const [objUrl, setObjUrl] = useState<string | null>(null)

  useEffect(() => {
    if (data.file) {
      const url = URL.createObjectURL(data.file)
      setObjUrl(url)
      return () => URL.revokeObjectURL(url)
    }
  }, [data.file])

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
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 200, minHeight: 140, position: 'relative' }}>
      {props.selected && <NodeResizer minWidth={150} minHeight={100} handleStyle={{ width: 10, height: 10, border: '2px solid #fff', background: '#555', zIndex: 10 }} lineStyle={{ border: '2px dashed #555' }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <span>{def.label}</span>
      </div>
      {objUrl ? (
        <div
          style={{ padding: 6, cursor: 'pointer' }}
          onClick={handleClick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <video src={objUrl} style={{ width: '100%', borderRadius: 4, maxHeight: 100 }} controls />
          <div style={{ fontSize: 10, color: '#888', marginTop: 2, textAlign: 'center' }}>{data.fileName} — click to change</div>
        </div>
      ) : (
        <div
          style={{ padding: 10, fontSize: 12, color: '#ccc', cursor: 'pointer', border: '2px dashed #555', margin: 8, borderRadius: 4, textAlign: 'center' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          {data.fileName || 'Drop video file here'}
        </div>
      )}
      <input ref={inputRef} type="file" accept=".mp4,.mov,.avi,.mkv" style={{ display: 'none' }} onChange={handleChange} />
      <Handle type="source" position={Position.Right} id="video" style={{ top: '50%', background: PORT_COLORS.video_tensor }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: getHandleColor('video', 'video_tensor'), whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    </div>
  )
}

export default memo(VideoInputNode)
