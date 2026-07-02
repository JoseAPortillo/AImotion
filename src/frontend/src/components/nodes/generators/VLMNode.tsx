import { memo, useCallback } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type VLMData, type PromptData } from '../../../types/nodes'
import NodeWrapper from '../NodeWrapper'
import { useGraphStore } from '../../../store/graph'
import { useToastStore } from '../../../store/toast'
import { analyzeVLM } from '../../../api/backend'

function VLMNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as VLMData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const addToast = useToastStore((s) => s.addToast)

  const handleAnalyze = useCallback(async () => {
    const inEdges = edges.filter((e) => e.target === props.id)
    const getNode = (edge: typeof inEdges[0]) => nodes.find((n) => n.id === edge.source)

    const promptEdge = inEdges.find((e) => e.targetHandle === 'prompt_pos')
    const imageEdge = inEdges.find((e) => e.targetHandle === 'image_in')

    const promptData = promptEdge ? getNode(promptEdge)?.data as PromptData | undefined : undefined
    const imageNode = imageEdge ? getNode(imageEdge) : undefined
    const imageFile = imageNode?.data && 'file' in imageNode.data && (imageNode.data as { file?: File }).file instanceof File
      ? (imageNode.data as { file?: unknown }).file as File
      : null

    if (!promptData?.positive) {
      addToast('Connect a Prompt node with text', 'info')
      return
    }
    if (!imageFile) {
      addToast('Connect an Image Input node with an image', 'info')
      return
    }

    updateNodeData(props.id, { loading: true, result: '' } as Partial<VLMData>)
    try {
      const result = await analyzeVLM(imageFile, promptData.positive)
      updateNodeData(props.id, { result, loading: false } as Partial<VLMData>)
    } catch (err: any) {
      addToast(`VLM error: ${err.message}`, 'error')
      updateNodeData(props.id, { loading: false } as Partial<VLMData>)
    }
  }, [props.id, nodes, edges, updateNodeData])

  return (
    <NodeWrapper def={def} selected={props.selected} footer={
      <button
        onClick={handleAnalyze}
        disabled={data.loading}
        style={{
          width: '100%',
          padding: '4px 0',
          borderRadius: 4,
          border: 'none',
          fontSize: 10,
          fontWeight: 600,
          cursor: data.loading ? 'not-allowed' : 'pointer',
          background: data.loading ? '#333' : '#a855f7',
          color: data.loading ? '#888' : '#fff',
        }}
      >
        {data.loading ? 'Analyzing...' : 'Analyze ▶'}
      </button>
    } handles={
      <>
        <Handle type="target" position={Position.Left} id="image_in" style={{ top: '33%', background: getHandleColor('image_in', 'video_tensor') }}>
          <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: getHandleColor('image_in', 'video_tensor'), whiteSpace: 'nowrap' }}>Image</div>
        </Handle>
        <Handle type="target" position={Position.Left} id="prompt_pos" style={{ top: '66%', background: PORT_COLORS.prompt }}>
          <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Prompt</div>
        </Handle>
        <Handle type="source" position={Position.Right} id="text_out" style={{ top: '50%', background: PORT_COLORS.prompt }}>
          <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Text</div>
        </Handle>
      </>
    }>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#ccc', minHeight: 32 }}>
        {data.loading ? (
          <span style={{ color: '#888' }}>Analyzing...</span>
        ) : data.result ? (
          <div style={{ fontSize: 10, lineHeight: 1.3, maxHeight: 80, overflowY: 'auto', color: '#e0e0e0', whiteSpace: 'pre-wrap' }}>
            {String(data.result)}
          </div>
        ) : (
          <span style={{ color: '#888', fontSize: 10 }}>Connect Image + Prompt, then click Analyze</span>
        )}
      </div>
    </NodeWrapper>
  )
}

export default memo(VLMNode)
