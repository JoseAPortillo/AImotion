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
import VramStatusBar from './components/VramStatusBar'
import { useCallback, useEffect, useState, useRef, type DragEvent } from 'react'
import { checkHealth, startGeneration, pollTask, type TaskStatus } from './api/backend'
import type { PromptData, ImageInputData, VideoInputData, GenerationData } from './types/nodes'
import ToastContainer from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import { useToastStore } from './store/toast'
import ImageInputNode from './components/nodes/ImageInputNode'
import VideoInputNode from './components/nodes/VideoInputNode'
import AudioInputNode from './components/nodes/AudioInputNode'
import PromptNode from './components/nodes/PromptNode'
import GenerationNode from './components/nodes/GenerationNode'
import SamplingParamsNode from './components/nodes/SamplingParamsNode'
import DenoisingStrengthNode from './components/nodes/DenoisingStrengthNode'
import OutputNode from './components/nodes/OutputNode'
import PreviewNode from './components/nodes/PreviewNode'
import DiffuserGeneratorNode from './components/nodes/generators/DiffuserGeneratorNode'
import TransformersGeneratorNode from './components/nodes/generators/TransformersGeneratorNode'
import VLMNode from './components/nodes/generators/VLMNode'
import LLMGeneratorNode from './components/nodes/generators/LLMGeneratorNode'
import CVTaskProcessorNode from './components/nodes/processors/CVTaskProcessorNode'
import LoadLoRANode from './components/nodes/adapters/LoadLoRANode'
import ApplyControlNetNode from './components/nodes/adapters/ApplyControlNetNode'

const nodeTypes: NodeTypes = {
  videoInput: VideoInputNode,
  imageInput: ImageInputNode,
  audioInput: AudioInputNode,
  prompt: PromptNode,
  diffuserGenerator: DiffuserGeneratorNode,
  transformersGenerator: TransformersGeneratorNode,
  vlmNode: VLMNode,
  llmGenerator: LLMGeneratorNode,
  cvTaskProcessor: CVTaskProcessorNode,
  loadLora: LoadLoRANode,
  applyControlNet: ApplyControlNetNode,
  generation: GenerationNode,
  samplingParams: SamplingParamsNode,
  denoisingStrength: DenoisingStrengthNode,
  output: OutputNode,
  preview: PreviewNode,
}

export default function App() {
  return (
    <ErrorBoundary>
      <ReactFlowProvider>
        <AppInner />
      </ReactFlowProvider>
    </ErrorBoundary>
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
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const setOutputUrl = useGraphStore((s) => s.setOutputUrl)
  const addToast = useToastStore((s) => s.addToast)
  const clearAll = useGraphStore((s) => s.clearAll)
  const loadWorkflow = useGraphStore((s) => s.loadWorkflow)
  const openRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSave = useCallback(() => {
    const workflow = {
      version: 1,
      nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
      edges: edges.map(({ id, source, target, sourceHandle, targetHandle, style }) => ({ id, source, target, sourceHandle, targetHandle, style })),
    }
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    addToast('Workflow saved', 'success')
  }, [nodes, edges])

  const handleOpen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const wf = JSON.parse(text)
      if (!wf.nodes || !wf.edges) {
        addToast('Invalid workflow file', 'error')
        return
      }
      loadWorkflow(wf.nodes, wf.edges)
      addToast(`Workflow loaded: ${file.name}`, 'success')
    } catch {
      addToast('Failed to load workflow file', 'error')
    }
    e.target.value = ''
  }, [loadWorkflow])

  const handleNew = useCallback(() => {
    if (nodes.length === 0 && edges.length === 0) return
    if (confirm('Clear the canvas? This cannot be undone.')) {
      clearAll()
      addToast('Canvas cleared', 'info')
    }
  }, [nodes, edges, clearAll])

  const handleGenerate = useCallback(async () => {
    const promptNode = nodes.find((n) => n.type === 'prompt')?.data as PromptData | undefined
    const genNode = (nodes.find((n) => n.type === 'diffuserGenerator')?.data || nodes.find((n) => n.type === 'generation')?.data) as GenerationData | undefined
    const videoNode = nodes.find((n) => n.type === 'videoInput')?.data as VideoInputData | undefined

    if (!promptNode?.positive || !genNode) {
      addToast('Add at least a Prompt and a Diffuser Generator node to the graph', 'info')
      return
    }

    setGenerating(true)
    try {
      const task = await startGeneration(promptNode.positive, promptNode.negative || '', {
        width: genNode.width ?? 720,
        height: genNode.height ?? 480,
        steps: genNode.steps ?? 50,
        cfg: genNode.cfg ?? 6,
        strength: genNode.strength ?? 0.8,
        seed: genNode.seed ?? 0,
        scheduler: genNode.scheduler || '',
        model: genNode.model || 'cogvideox-2b',
        execution_mode: genNode.execution_mode || 'local',
        vae_tiling: genNode.vae_tiling ?? true,
        vae_tile_overlap: genNode.vae_tile_overlap ?? 0.0,
      }, videoNode?.file)

      let status: TaskStatus
      do {
        await new Promise((r) => setTimeout(r, 2000))
        status = await pollTask(task.task_id)
      } while (status.status === 'pending' || status.status === 'running')

      if (status.status === 'completed' && status.result_url) {
        setOutputUrl(status.result_url)
      } else {
        addToast(`Generation failed: ${status.error || 'unknown error'}`, 'error')
      }
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error')
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
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setMenuOpen((x) => !x)}
                title="Workflow menu"
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid #444',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  background: '#1a1a1a',
                  color: '#ccc',
                  lineHeight: 1,
                }}
              >
                ☰
              </button>
              {menuOpen && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  background: '#1a1a1a',
                  border: '1px solid #333',
                  borderRadius: 6,
                  minWidth: 120,
                  zIndex: 100,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                }}>
                  <div
                    onClick={() => { handleNew(); setMenuOpen(false) }}
                    style={{ padding: '8px 14px', fontSize: 12, cursor: 'pointer', color: '#ccc', borderBottom: '1px solid #2a2a2a' }}
                  >New</div>
                  <div
                    onClick={() => { handleSave(); setMenuOpen(false) }}
                    style={{ padding: '8px 14px', fontSize: 12, cursor: 'pointer', color: '#ccc', borderBottom: '1px solid #2a2a2a' }}
                  >Save</div>
                  <div
                    onClick={() => { openRef.current?.click(); setMenuOpen(false) }}
                    style={{ padding: '8px 14px', fontSize: 12, cursor: 'pointer', color: '#ccc' }}
                  >Open</div>
                </div>
              )}
              <input ref={openRef} type="file" accept=".json" onChange={handleOpen} style={{ display: 'none' }} />
            </div>
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
          <Panel position="top-center">
            <VramStatusBar />
          </Panel>
          <Panel position="bottom-center" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 1 }}>AImation</div>
            <div style={{ fontSize: 9, color: '#444' }}>beta v0.1.0</div>
          </Panel>
          <Panel position="top-right" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <ModelManager backendOk={backendOk} />
          </Panel>
        </ReactFlow>
        <ToastContainer />
      </div>
      <NodeInspector />
    </div>
  )
}
