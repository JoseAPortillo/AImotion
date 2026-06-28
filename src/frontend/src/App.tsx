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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGraphStore } from './store/graph'
import type { NodeType, AppNode } from './types/nodes'
import Sidebar from './components/Sidebar'
import NodeInspector from './components/NodeInspector'
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { checkHealth } from './api/backend'
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
          <Panel position="top-right">
            <div
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 12,
                background: backendOk ? '#0a2e1a' : '#2e0a0a',
                color: backendOk ? '#4ade80' : '#f87171',
                border: `1px solid ${backendOk ? '#166534' : '#7f1d1d'}`,
              }}
            >
              {backendOk ? 'Backend connected' : 'Backend offline'}
            </div>
          </Panel>
        </ReactFlow>
      </div>
      <NodeInspector />
    </div>
  )
}
