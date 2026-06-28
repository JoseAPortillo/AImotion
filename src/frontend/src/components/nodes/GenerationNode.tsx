import { memo, useCallback, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType, type GenerationData, type PromptData, type SamplingParamsData, type DenoisingStrengthData } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'
import { startGeneration, pollTask, type TaskStatus } from '../../api/backend'

const inputHandles = ['video_in', 'audio_in', 'prompt_pos', 'prompt_neg', 'params', 'strength']

const schedLabels: Record<string, string> = {
  cogvideox_ddim: 'DDIM',
  cogvideox_dpm: 'DPM',
  flow_match_euler: 'Flow Euler',
  flow_match_heun: 'Flow Heun',
  ltx_euler_ancestral_rf: 'Euler Anc RF',
}

const selectStyle: React.CSSProperties = {
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ccc',
  padding: '3px 6px',
  fontSize: 11,
  outline: 'none',
  width: '100%',
  marginTop: 4,
}

function GenerationNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as GenerationData
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const setOutputUrl = useGraphStore((s) => s.setOutputUrl)
  const [genRunning, setGenRunning] = useState(false)
  const schedLabel = data.scheduler ? schedLabels[data.scheduler] || data.scheduler : ''

  const handleGenWorkflow = useCallback(async () => {
    const genEdges = edges.filter((e) => e.target === props.id)
    const getNode = (edge: typeof genEdges[0]) => nodes.find((n) => n.id === edge.source)

    const promptEdgePos = genEdges.find((e) => e.targetHandle === 'prompt_pos')
    const promptEdgeNeg = genEdges.find((e) => e.targetHandle === 'prompt_neg')
    const paramsEdge = genEdges.find((e) => e.targetHandle === 'params')
    const strengthEdge = genEdges.find((e) => e.targetHandle === 'strength')
    const videoEdge = genEdges.find((e) => e.targetHandle === 'video_in')

    const promptData = promptEdgePos ? getNode(promptEdgePos)?.data as PromptData | undefined : undefined
    const paramsData = paramsEdge ? getNode(paramsEdge)?.data as SamplingParamsData | undefined : undefined
    const strengthData = strengthEdge ? getNode(strengthEdge)?.data as DenoisingStrengthData | undefined : undefined
    const videoNode = videoEdge ? getNode(videoEdge) : undefined

    if (!promptData?.positive || !paramsData) {
      alert('Connect at least a Prompt and Sampling node to this Generation node')
      return
    }

    setGenRunning(true)
    try {
      const task = await startGeneration(
        promptData.positive,
        promptEdgeNeg ? (getNode(promptEdgeNeg)?.data as PromptData | undefined)?.negative || '' : '',
        {
          width: paramsData.width || 720,
          height: paramsData.height || 480,
          steps: paramsData.steps || 50,
          cfg: paramsData.cfg || 6,
          strength: strengthData?.strength ?? 0.8,
          seed: paramsData.seed || 0,
          scheduler: data.scheduler || '',
          model: data.model || 'cogvideox-2b',
          vae_tiling: data.vae_tiling ?? true,
          vae_tile_overlap: data.vae_tile_overlap ?? 0.0,
        },
        videoNode?.data && 'file' in videoNode.data ? (videoNode.data as { file?: File }).file : undefined,
      )

      let status: TaskStatus
      do {
        await new Promise((r) => setTimeout(r, 2000))
        status = await pollTask(task.task_id)
      } while (status.status === 'pending' || status.status === 'running')

      if (status.status === 'completed' && status.result_url) {
        setOutputUrl(status.result_url)
      } else {
        alert(`Workflow failed: ${status.error || 'unknown error'}`)
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setGenRunning(false)
    }
  }, [props.id, data.scheduler, nodes, edges, setOutputUrl])

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, minWidth: 240, minHeight: 260, position: 'relative', paddingBottom: 38 }}>
      {props.selected && <NodeResizer minWidth={200} minHeight={180} handleStyle={{ width: 10, height: 10, border: '2px solid #fff', background: '#555', zIndex: 10 }} lineStyle={{ border: '2px dashed #555' }} />}
      <div style={{ background: def.color, padding: '6px 10px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
        <span>{def.label}</span>
      </div>
      <div style={{ padding: '6px 10px', fontSize: 12, color: '#ccc' }}>
        <select
          value={data.model}
          onChange={(e) => updateNodeData(props.id, { model: e.target.value } as Partial<GenerationData>)}
          style={selectStyle}
        >
          <option value="cogvideox-2b">cogvideox-2b</option>
          <option value="cogvideox-5b">cogvideox-5b</option>
          <option value="ltx-video">ltx-video</option>
        </select>
        <select
          value={data.scheduler}
          onChange={(e) => updateNodeData(props.id, { scheduler: e.target.value } as Partial<GenerationData>)}
          style={selectStyle}
        >
          <option value="">Default scheduler</option>
          <option value="cogvideox_ddim">DDIM (CogVideoX)</option>
          <option value="cogvideox_dpm">DPM (CogVideoX)</option>
          <option value="flow_match_euler">Flow Euler (LTX)</option>
          <option value="flow_match_heun">Flow Heun (LTX)</option>
          <option value="ltx_euler_ancestral_rf">Euler Anc RF (LTX)</option>
        </select>
        {schedLabel && <div style={{ marginTop: 2, fontSize: 10, color: '#888' }}>Current: {schedLabel}</div>}
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={data.vae_tiling}
              onChange={(e) => updateNodeData(props.id, { vae_tiling: e.target.checked } as Partial<GenerationData>)}
            />
            VAE Tiling
          </label>
          {data.vae_tiling && (
            <div style={{ marginTop: 4 }}>
              <label style={{ fontSize: 10, color: '#888' }}>Tile Overlap: {data.vae_tile_overlap > 0 ? data.vae_tile_overlap : 'VAE default'}</label>
              <input
                type="range"
                min="0"
                max="0.9"
                step="0.1"
                value={data.vae_tile_overlap}
                onChange={(e) => updateNodeData(props.id, { vae_tile_overlap: parseFloat(e.target.value) } as Partial<GenerationData>)}
                style={{ width: '100%', marginTop: 2 }}
              />
            </div>
          )}
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid #2a2a2a', padding: '6px 10px', background: '#1a1a1a' }}>
        <button
          onClick={handleGenWorkflow}
          disabled={genRunning}
          style={{
            width: '100%',
            padding: '6px 0',
            borderRadius: 4,
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: genRunning ? 'not-allowed' : 'pointer',
            background: genRunning ? '#333' : '#4ade80',
            color: genRunning ? '#888' : '#0f0f0f',
          }}
        >
          {genRunning ? 'Generating...' : 'Generate ▶'}
        </button>
      </div>
      {inputHandles.map((id, i) => {
        const inp = def.inputs.find((p) => p.id === id)
        const portType = inp?.type || 'params'
        const color = getHandleColor(id, portType)
        return (
          <Handle
            key={id}
            type="target"
            position={Position.Left}
            id={id}
            style={{ top: `${((i + 1) / (inputHandles.length + 1)) * 100}%`, background: color }}
          >
            <div style={{ position: 'absolute', left: -8, top: -2, transform: 'translateX(-100%)', fontSize: 10, color, whiteSpace: 'nowrap' }}>
              {inp?.label || id}
            </div>
          </Handle>
        )
      })}
      <Handle type="source" position={Position.Right} id="video_out" style={{ top: '50%', background: getHandleColor('video_out', 'video_tensor') }}>
        <div style={{ position: 'absolute', right: -8, top: -2, transform: 'translateX(100%)', fontSize: 10, color: getHandleColor('video_out', 'video_tensor'), whiteSpace: 'nowrap' }}>Video</div>
      </Handle>
    </div>
  )
}

export default memo(GenerationNode)
