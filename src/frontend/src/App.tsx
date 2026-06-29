import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGraphStore } from './store/graph'
import type { NodeType, AppNode } from './types/nodes'
import { NODE_DEFINITIONS, getPortTypeFromHandle } from './types/nodes'
import Sidebar from './components/Sidebar'
import NodeInspector from './components/NodeInspector'
import ModelManager from './components/ModelManager'
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { checkHealth, startGeneration, pollTask, type TaskStatus } from './api/backend'
import type { PromptData, SamplingParamsData, DenoisingStrengthData, VideoInputData, GenerationData } from './types/nodes'
import VideoInputNode from './components/nodes/VideoInputNode'
import AudioInputNode from './components/nodes/AudioInputNode'
import PromptNode from './components/nodes/PromptNode'
import GenerationNode from './components/nodes/GenerationNode'
import SamplingParamsNode from './components/nodes/SamplingParamsNode'
import DenoisingStrengthNode from './components/nodes/DenoisingStrengthNode'
import OutputNode from './components/nodes/OutputNode'
import PreviewNode from './components/nodes/PreviewNode'

const nodeTypes: NodeTypes = {
  videoInput: VideoInputNode,
  audioInput: AudioInputNode,
  prompt: PromptNode,
  generation: GenerationNode,
  samplingParams: SamplingParamsNode,
  denoisingStrength: DenoisingStrengthNode,
  output: OutputNode,
  preview: PreviewNode,
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  )
}

function AppInner() {
  const [backendOk, setBackendOk] = useState(false)
  const { screenToFlowPosition } = useReactFlow()

  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const onNodesChange = useGraphStore((s) => s.onNodesChange)
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange)
  const onConnect = useGraphStore((s) => s.onConnect)
  const addNode = useGraphStore((s) => s.addNode)
  const selectNode = useGraphStore((s) => s.selectNode)

  const isValidConnection = useCallback((conn: Edge | Connection) => {
    const sourceNode = nodes.find((n) => n.id === conn.source)
    const targetNode = nodes.find((n) => n.id === conn.target)
    if (!sourceNode || !targetNode) return false
    const srcDef = NODE_DEFINITIONS[sourceNode.type as NodeType]
    const tgtDef = NODE_DEFINITIONS[targetNode.type as NodeType]
    const srcType = getPortTypeFromHandle(conn.sourceHandle || '', srcDef)
    const tgtType = getPortTypeFromHandle(conn.targetHandle || '', tgtDef)
    return !!srcType && !!tgtType && srcType === tgtType
  }, [nodes])

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow') as NodeType
      if (!type) return

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      addNode(type, position)
    },
    [screenToFlowPosition, addNode],
  )

  useEffect(() => {
    checkHealth()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false))
  }, [])

  const [generating, setGenerating] = useState(false)
  const setOutputUrl = useGraphStore((s) => s.setOutputUrl)

  const handleGenerate = useCallback(async () => {
    const promptNode = nodes.find((n) => n.type === 'prompt')?.data as PromptData | undefined
    const genNode = nodes.find((n) => n.type === 'generation')?.data as GenerationData | undefined
    const samplingNode = nodes.find((n) => n.type === 'samplingParams')?.data as SamplingParamsData | undefined
    const strengthNode = nodes.find((n) => n.type === 'denoisingStrength')?.data as DenoisingStrengthData | undefined
    const videoNode = nodes.find((n) => n.type === 'videoInput')?.data as VideoInputData | undefined

    if (!promptNode?.positive || !samplingNode) {
      alert('Add at least a Prompt and Sampling node to the graph')
      return
    }

    setGenerating(true)
    try {
      const task = await startGeneration(promptNode.positive, promptNode.negative || '', {
        width: samplingNode.width || 720,
        height: samplingNode.height || 480,
        steps: samplingNode.steps || 50,
        cfg: samplingNode.cfg || 6,
        strength: strengthNode?.strength ?? 0.8,
        seed: samplingNode.seed || 0,
        scheduler: genNode?.scheduler || '',
        model: genNode?.model || 'cogvideox-2b',
        vae_tiling: genNode?.vae_tiling ?? true,
        vae_tile_overlap: genNode?.vae_tile_overlap ?? 0.0,
      }, videoNode?.file)

      let status: TaskStatus
      do {
        await new Promise((r) => setTimeout(r, 2000))
        status = await pollTask(task.task_id)
      } while (status.status === 'pending' || status.status === 'running')

      if (status.status === 'completed' && status.result_url) {
        setOutputUrl(status.result_url)
      } else {
        alert(`Generation failed: ${status.error || 'unknown error'}`)
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setGenerating(false)
    }
  }, [nodes, setOutputUrl])

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f0f0f', color: '#e0e0e0' }}>
      <Sidebar />
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onNodeClick={(_, node) => selectNode(node.id)}
          onPaneClick={() => selectNode(null)}
          nodeTypes={nodeTypes}
          fitView
          colorMode="dark"
          style={{ background: '#0f0f0f' }}
        >
          <Background color="#222" gap={20} />
          <Controls />
          <MiniMap
            style={{ background: '#1a1a1a' }}
            nodeColor={() => '#333'}
            maskColor="rgba(0,0,0,0.7)"
          />
          <Panel position="top-left" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={handleGenerate}
              disabled={generating || !backendOk}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: 'none',
                fontSize: 13,
                fontWeight: 600,
                cursor: generating || !backendOk ? 'not-allowed' : 'pointer',
                background: generating ? '#333' : '#4ade80',
                color: generating ? '#888' : '#0f0f0f',
              }}
            >
              {generating ? 'Generating...' : 'Generate'}
            </button>
          </Panel>
          <Panel position="bottom-center" style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 1 }}>AImotion</div>
            <div style={{ fontSize: 9, color: '#444' }}>beta v0.1.0</div>
          </Panel>
          <Panel position="top-right">
            <ModelManager backendOk={backendOk} />
          </Panel>
        </ReactFlow>
      </div>
      <NodeInspector />
    </div>
  )
}
