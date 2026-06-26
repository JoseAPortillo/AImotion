import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  useNodesState,
  useEdgesState,
  Panel,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGraphStore } from './store/graph'
import type { NodeType } from './types/nodes'
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

  const store = useGraphStore()
  const [, onNodesChange] = useNodesState(store.nodes)
  const [, onEdgesChange, onConnect] = useEdgesState(store.edges)

  const handleNodesChange = useCallback(
    (changes: any) => {
      store.onNodesChange(changes)
      onNodesChange(changes)
    },
    [store, onNodesChange],
  )

  const handleEdgesChange = useCallback(
    (changes: any) => {
      store.onEdgesChange(changes)
      onEdgesChange(changes)
    },
    [store, onEdgesChange],
  )

  const handleConnect = useCallback(
    (connection: any) => {
      store.onConnect(connection)
      onConnect(connection)
    },
    [store, onConnect],
  )

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

      store.addNode(type, position)
    },
    [screenToFlowPosition, store],
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
          nodes={store.nodes}
          edges={store.edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onNodeClick={(_, node) => store.selectNode(node.id)}
          onPaneClick={() => store.selectNode(null)}
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
