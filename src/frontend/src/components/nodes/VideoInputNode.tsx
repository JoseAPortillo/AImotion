import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType } from '../../types/nodes'
import NodeWrapper from './NodeWrapper'
import { useGraphStore } from '../../store/graph'

function VideoInputNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const inputRef = useRef<HTMLInputElement>(null)
  const data = props.data as { file?: File; fileName?: string; fileDataUrl?: string }
  const [objUrl, setObjUrl] = useState<string | null>(null)

  useEffect(() => {
    if (data.file instanceof File) {
      const url = URL.createObjectURL(data.file)
      setObjUrl(url)
      return () => URL.revokeObjectURL(url)
    } else if (data.fileDataUrl) {
      setObjUrl(data.fileDataUrl)
    }
  }, [data.file, data.fileDataUrl])

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = () => {
        useGraphStore.getState().updateNodeData(props.id, {
          file,
          fileName: file.name,
          fileDataUrl: reader.result as string,
        })
      }
      reader.readAsDataURL(file)
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
    <NodeWrapper def={def} selected={props.selected} handles={
      <Handle type="source" position={Position.Right} id="video" style={{ top: '50%', background: PORT_COLORS.video_tensor }}>
        <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: getHandleColor('video', 'video_tensor'), whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    }>
      {objUrl ? (
        <div
          style={{ padding: 4, cursor: 'pointer' }}
          onClick={handleClick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <video src={objUrl} style={{ width: '100%', borderRadius: 4, maxHeight: 70 }} controls />
          <div style={{ fontSize: 9, color: '#888', marginTop: 2, textAlign: 'center' }}>{data.fileName} — click to change</div>
        </div>
      ) : (
        <div
          style={{ padding: 6, fontSize: 10, color: '#ccc', cursor: 'pointer', border: '2px dashed #555', margin: 6, borderRadius: 4, textAlign: 'center' }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          {data.fileName || 'Drop video file here'}
        </div>
      )}
      <input ref={inputRef} type="file" accept=".mp4,.mov,.avi,.mkv" style={{ display: 'none' }} onChange={handleChange} />
    </NodeWrapper>
  )
}

export default memo(VideoInputNode)
