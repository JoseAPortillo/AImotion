import {
  ReactFlow,
  Background,
  BackgroundVariant,
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
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGraphStore } from './store/graph'
import type { NodeType, AppNode, GroupNodeData } from './types/nodes'
import { NODE_DEFINITIONS, getPortTypeFromHandle } from './types/nodes'
import Sidebar from './components/Sidebar'
import NodeInspector from './components/NodeInspector'
import ModelManager from './components/ModelManager'
import VramStatusBar from './components/VramStatusBar'
import CreditStatusBar from './components/CreditStatusBar'
import { useCallback, useEffect, useState, useRef, useMemo, type DragEvent } from 'react'
import { checkHealth, startGeneration, pollTask, type TaskStatus } from './api/backend'
import type { PromptData, ImageInputData, VideoInputData, GenerationData } from './types/nodes'
import ToastContainer from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import { useToastStore } from './store/toast'
import { saveWorkflowToDirectory, downloadWorkflowJson, loadWorkflowFromDirectory, hasDirectorySupport } from './utils/workflowIO'
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
import TextToImageNode from './components/nodes/generators/TextToImageNode'
import TextToVideoNode from './components/nodes/generators/TextToVideoNode'
import ImageToVideoNode from './components/nodes/generators/ImageToVideoNode'
import VideoToVideoNode from './components/nodes/generators/VideoToVideoNode'
import ImageToImageNode from './components/nodes/generators/ImageToImageNode'
import RunwayVideoToVideoNode from './components/nodes/generators/RunwayVideoToVideoNode'
import RunwayImageToVideoNode from './components/nodes/generators/RunwayImageToVideoNode'
import TransformersGeneratorNode from './components/nodes/generators/TransformersGeneratorNode'
import VLMNode from './components/nodes/generators/VLMNode'
import LLMGeneratorNode from './components/nodes/generators/LLMGeneratorNode'
import CVTaskProcessorNode from './components/nodes/processors/CVTaskProcessorNode'
import LoadLoRANode from './components/nodes/adapters/LoadLoRANode'
import ApplyControlNetNode from './components/nodes/adapters/ApplyControlNetNode'
import GroupNode from './components/nodes/GroupNode'
import EdgeWithDelete from './components/EdgeWithDelete'
import type { EdgeTypes } from '@xyflow/react'

const nodeTypes: NodeTypes = {
  videoInput: VideoInputNode,
  imageInput: ImageInputNode,
  audioInput: AudioInputNode,
  prompt: PromptNode,
  diffuserGenerator: DiffuserGeneratorNode,
  textToImage: TextToImageNode,
  textToVideo: TextToVideoNode,
  imageToVideo: ImageToVideoNode,
  videoToVideo: VideoToVideoNode,
  imageToImage: ImageToImageNode,
  runwayVideoToVideo: RunwayVideoToVideoNode,
  runwayImageToVideo: RunwayImageToVideoNode,
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
  groupNode: GroupNode,
}

const edgeTypes: EdgeTypes = {
  default: EdgeWithDelete,
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
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange)

    // Derive display edges: when a group is collapsed, route child→outside and outside→child
  // edges through the group's proxy handles so visuals stay clean.
  // If both endpoints are inside DIFFERENT collapsed groups, route group→group directly.
  const displayEdges = useMemo(() => {
    const proxyEdges: Edge[] = []
    const groups = nodes.filter((n) => n.type === 'groupNode')
    const hiddenSet = new Set<string>()
    const routedEdgeIds = new Set<string>()

    for (const group of groups) {
      const gd = group.data as GroupNodeData
      if (!gd.collapsed || !gd.childIds?.length) continue

      const childSet = new Set(gd.childIds)

      for (const edge of edges) {
        if (routedEdgeIds.has(edge.id)) continue

        const isInternalSource = childSet.has(edge.source)
        const isInternalTarget = childSet.has(edge.target)

        if (!isInternalSource && !isInternalTarget) continue

        hiddenSet.add(edge.id)

        if (isInternalSource && !isInternalTarget) {
          // Check if target is inside ANOTHER collapsed group
          const targetGroup = groups.find(
            (g) =>
              g.id !== group.id &&
              (g.data as GroupNodeData).collapsed &&
              (g.data as GroupNodeData).childIds?.includes(edge.target),
          )
          if (targetGroup) {
            // Route group → other collapsed group directly
            proxyEdges.push({
              id: `_proxy_${group.id}_${edge.id}`,
              source: group.id,
              sourceHandle: `source:${edge.source}:${edge.sourceHandle}`,
              target: targetGroup.id,
              targetHandle: `target:${edge.target}:${edge.targetHandle}`,
              style: edge.style,
            })
            routedEdgeIds.add(edge.id)
          } else {
            // Route group → visible target node
            proxyEdges.push({
              id: `_proxy_${group.id}_${edge.id}`,
              source: group.id,
              sourceHandle: `source:${edge.source}:${edge.sourceHandle}`,
              target: edge.target,
              targetHandle: edge.targetHandle,
              style: edge.style,
            })
          }
        }

        if (!isInternalSource && isInternalTarget) {
          // Check if source is inside ANOTHER collapsed group
          const sourceGroup = groups.find(
            (g) =>
              g.id !== group.id &&
              (g.data as GroupNodeData).collapsed &&
              (g.data as GroupNodeData).childIds?.includes(edge.source),
          )
          if (sourceGroup) continue // source group already routed this edge
          // Route visible source node → group
          proxyEdges.push({
            id: `_proxy_${group.id}_${edge.id}`,
            source: edge.source,
            sourceHandle: edge.sourceHandle,
            target: group.id,
            targetHandle: `target:${edge.target}:${edge.targetHandle}`,
            style: edge.style,
          })
        }
      }
    }

    return edges.map((e) => (hiddenSet.has(e.id) ? { ...e, hidden: true } : e)).concat(proxyEdges)
  }, [nodes, edges])
  const onConnect = useGraphStore((s) => s.onConnect)
  const addNode = useGraphStore((s) => s.addNode)
  const selectNode = useGraphStore((s) => s.selectNode)
  const addNodesToGroup = useGraphStore((s) => s.addNodesToGroup)
  const createGroupFromSelection = useGraphStore((s) => s.createGroupFromSelection)

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    useGraphStore.setState((state) => {
      let newNodes = applyNodeChanges(changes, state.nodes) as AppNode[]
      // Normalize z-index so non-group nodes are always above groups
      newNodes = newNodes.map((n) => {
        if (n.type === 'groupNode' && (n.zIndex ?? 0) !== -100) return { ...n, zIndex: -100 }
        if (n.type !== 'groupNode' && (n.zIndex ?? 0) < 100) return { ...n, zIndex: 100 }
        return n
      })
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const oldNode = state.nodes.find((n) => n.id === change.id)
          const newNode = newNodes.find((n) => n.id === change.id)
          if (oldNode && newNode && oldNode.type === 'groupNode') {
            const oldData = oldNode.data as GroupNodeData
            if (oldData.collapsed) continue
            const dx = newNode.position.x - oldNode.position.x
            const dy = newNode.position.y - oldNode.position.y
            if (dx !== 0 || dy !== 0) {
              const childIds: string[] = oldData.childIds ?? []
              for (let i = 0; i < newNodes.length; i++) {
                if (childIds.includes(newNodes[i].id)) {
                  newNodes[i] = {
                    ...newNodes[i],
                    position: {
                      x: newNodes[i].position.x + dx,
                      y: newNodes[i].position.y + dy,
                    },
                  }
                }
              }
            }
          }
        }
      }
      return { nodes: newNodes }
    })
  }, [])

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

      const newId = addNode(type, position)

      if (newId) {
        setTimeout(() => {
          const state = useGraphStore.getState()

          // If dropping a group node, absorb currently selected nodes
          if (type === 'groupNode') {
            const selectedIds = state.nodes
              .filter((n) => n.selected && n.id !== newId)
              .map((n) => n.id)
            if (selectedIds.length > 0) {
              const selectedNodes = state.nodes.filter((n) => selectedIds.includes(n.id))
              const minX = Math.min(...selectedNodes.map((n) => n.position.x))
              const minY = Math.min(...selectedNodes.map((n) => n.position.y))
              const maxX = Math.max(...selectedNodes.map((n) => n.position.x + (n.width ?? 260)))
              const maxY = Math.max(...selectedNodes.map((n) => n.position.y + (n.height ?? 320)))
              const padding = 40
              useGraphStore.setState((s) => ({
                nodes: s.nodes.map((n) =>
                  n.id === newId
                    ? { ...n, position: { x: minX - padding, y: minY - padding }, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
                    : n,
                ),
              }))
              addNodesToGroup(newId, selectedIds)
              return
            }
          }

          // Otherwise, check if dropped into an existing expanded group
          const droppedNode = state.nodes.find((n) => n.id === newId)
          if (!droppedNode) return
          const nx = droppedNode.position.x
          const ny = droppedNode.position.y
          const nw = droppedNode.width ?? 40
          const nh = droppedNode.height ?? 40
          const groups = state.nodes.filter(
            (n) => n.type === 'groupNode' && !n.data.collapsed && n.id !== newId,
          )
          for (const g of groups) {
            const gx = g.position.x
            const gy = g.position.y
            const gw = g.width ?? 400
            const gh = g.height ?? 400
            const overlap =
              nx < gx + gw && nx + nw > gx && ny < gy + gh && ny + nh > gy
            if (overlap) {
              addNodesToGroup(g.id, [newId])
              break
            }
          }
        }, 0)
      }
    },
    [screenToFlowPosition, addNode, addNodesToGroup],
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey
      if (meta && e.key === 'g') {
        e.preventDefault()
        const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id)
        if (selectedIds.length > 0) {
          createGroupFromSelection(selectedIds)
        }
        return
      }
      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useGraphStore.getState().undo()
        return
      }
      if (meta && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        useGraphStore.getState().redo()
        return
      }
      if (meta && e.key === 'y') {
        e.preventDefault()
        useGraphStore.getState().redo()
        return
      }
      if (meta && e.key === 'c') {
        const active = document.activeElement
        const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
        if (!isInput) {
          e.preventDefault()
          useGraphStore.getState().copySelectedNodes()
        }
        return
      }
      if (meta && e.key === 'v') {
        const active = document.activeElement
        const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement
        if (!isInput) {
          e.preventDefault()
          useGraphStore.getState().pasteNodes()
        }
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nodes, createGroupFromSelection])

  // Drag-stop: auto-add/remove node from group if dropped inside/outside bounds
  const onNodeDragStop = useCallback(
    (_: MouseEvent | TouchEvent, node: AppNode) => {
      const state = useGraphStore.getState()
      const nx = (node.position.x ?? 0) + (node.width ?? 0) / 2
      const ny = (node.position.y ?? 0) + (node.height ?? 0) / 2

      // Find which group this node belongs to, if any
      const parentGroup = state.nodes.find(
        (n) =>
          n.type === 'groupNode' &&
          (n.data as GroupNodeData).childIds?.includes(node.id),
      )

      // If belongs to a group: check if center is still inside, otherwise unlink
      if (parentGroup) {
        const gx = parentGroup.position.x ?? 0
        const gy = parentGroup.position.y ?? 0
        const gw = parentGroup.width ?? 400
        const gh = parentGroup.height ?? 400
        const inside = nx >= gx && nx <= gx + gw && ny >= gy && ny <= gy + gh
        if (!inside) {
          useGraphStore.getState().removeNodesFromGroup(parentGroup.id, [node.id])
        }
        return
      }

      // Not in any group: check if center is inside any expanded group
      const groups = state.nodes.filter((n) => n.type === 'groupNode' && !n.data.collapsed)
      for (const g of groups) {
        if (g.id === node.id) continue
        const gx = g.position.x ?? 0
        const gy = g.position.y ?? 0
        const gw = g.width ?? 400
        const gh = g.height ?? 400
        const inside = nx >= gx && nx <= gx + gw && ny >= gy && ny <= gy + gh
        if (inside) {
          useGraphStore.getState().addNodesToGroup(g.id, [node.id])
          break
        }
      }
    },
    [],
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
  const setNodeOutput = useGraphStore((s) => s.setNodeOutput)
  const addToast = useToastStore((s) => s.addToast)
  const clearAll = useGraphStore((s) => s.clearAll)
  const loadWorkflow = useGraphStore((s) => s.loadWorkflow)
  const nodeOutputs = useGraphStore((s) => s.nodeOutputs)
  const autoPreviews = useGraphStore((s) => s.autoPreviews)
  const outputUrl = useGraphStore((s) => s.outputUrl)
  const resultType = useGraphStore((s) => s.resultType)
  const openRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSave = useCallback(async () => {
    if (hasDirectorySupport()) {
      try {
        await saveWorkflowToDirectory(nodes, edges, nodeOutputs, autoPreviews, outputUrl, resultType)
        addToast('Workflow saved', 'success')
        return
      } catch (err: any) {
        console.error('[handleSave] Directory save failed:', err)
        if (err?.name === 'AbortError' || err?.name === 'SecurityError') return
      }
    }
    downloadWorkflowJson(nodes, edges, nodeOutputs, autoPreviews, outputUrl, resultType)
    addToast('Workflow saved (JSON fallback)', 'success')
  }, [nodes, edges, nodeOutputs, autoPreviews, outputUrl, resultType, addToast])

  const handleOpen = useCallback(async () => {
    if (hasDirectorySupport()) {
      try {
        const { workflow, mediaBlobs, previewBlobs } = await loadWorkflowFromDirectory()
        const restoration: Record<string, { url: string; type: 'image' | 'video' }> = {}
        for (const [nodeId, entry] of Object.entries(mediaBlobs)) {
          restoration[nodeId] = { url: URL.createObjectURL(entry.blob), type: entry.type }
        }
        const previewRestoration: Record<string, { url: string; type: 'image' | 'video' }> = {}
        for (const [nodeId, entry] of Object.entries(previewBlobs)) {
          previewRestoration[nodeId] = { url: URL.createObjectURL(entry.blob), type: entry.type }
        }
        loadWorkflow(workflow.nodes, workflow.edges, {
          nodeOutputs: Object.keys(restoration).length > 0 ? restoration : undefined,
          autoPreviews: Object.keys(previewRestoration).length > 0 ? previewRestoration : undefined,
          outputUrl: workflow.outputUrl ?? null,
          resultType: workflow.resultType ?? null,
        })
        addToast('Workflow loaded', 'success')
        return
      } catch (err: any) {
        if (err?.name === 'AbortError') return
      }
    }
    openRef.current?.click()
  }, [loadWorkflow, addToast])

  const handleOpenFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const wf = JSON.parse(text)
      if (!wf.nodes || !wf.edges) {
        addToast('Invalid workflow file', 'error')
        return
      }
      const restoration: Record<string, { url: string; type: 'image' | 'video' }> = {}
      if (wf.media) {
        for (const [nodeId, media] of Object.entries(wf.media)) {
          const m = media as { path: string; type: 'image' | 'video' }
          if (m.path) restoration[nodeId] = { url: m.path, type: m.type }
        }
      }
      const previewRestoration: Record<string, { url: string; type: 'image' | 'video' }> = {}
      if (wf.autoPreviews) {
        for (const [nodeId, media] of Object.entries(wf.autoPreviews)) {
          const m = media as { path: string; type: 'image' | 'video' }
          if (m.path) previewRestoration[nodeId] = { url: m.path, type: m.type }
        }
      }
      loadWorkflow(wf.nodes, wf.edges, {
        nodeOutputs: Object.keys(restoration).length > 0 ? restoration : undefined,
        autoPreviews: Object.keys(previewRestoration).length > 0 ? previewRestoration : undefined,
        outputUrl: wf.outputUrl ?? null,
        resultType: wf.resultType ?? null,
      })
      addToast(`Workflow loaded: ${file.name}`, 'success')
    } catch {
      addToast('Failed to load workflow file', 'error')
    }
    e.target.value = ''
  }, [loadWorkflow, addToast])

  const handleNew = useCallback(() => {
    if (nodes.length === 0 && edges.length === 0) return
    if (confirm('Clear the canvas? This cannot be undone.')) {
      clearAll()
      addToast('Canvas cleared', 'info')
    }
  }, [nodes, edges, clearAll])

  const handleGenerate = useCallback(async () => {
    const promptNode = nodes.find((n) => n.type === 'prompt')?.data as PromptData | undefined
    const genNodeData = (nodes.find((n) => n.type === 'diffuserGenerator')?.data || nodes.find((n) => n.type === 'generation')?.data) as GenerationData | undefined
    const genNode = nodes.find((n) => n.type === 'diffuserGenerator') || nodes.find((n) => n.type === 'generation')
    const videoNode = nodes.find((n) => n.type === 'videoInput')?.data as VideoInputData | undefined

    if (!promptNode?.positive || !genNodeData || !genNode) {
      addToast('Add at least a Prompt and a Diffuser Generator node to the graph', 'info')
      return
    }

    setGenerating(true)
    try {
      const task = await startGeneration(promptNode.positive, promptNode.negative || '', {
        width: genNodeData.width ?? 720,
        height: genNodeData.height ?? 480,
        steps: genNodeData.steps ?? 50,
        cfg: genNodeData.cfg ?? 6,
        strength: genNodeData.strength ?? 0.8,
        seed: genNodeData.seed ?? 0,
        scheduler: genNodeData.scheduler || '',
        model: genNodeData.model || 'cogvideox-2b',
        execution_mode: genNodeData.execution_mode || 'local',
        vae_tiling: genNodeData.vae_tiling ?? true,
        vae_tile_overlap: genNodeData.vae_tile_overlap ?? 0.0,
      }, videoNode?.file)

      let status: TaskStatus
      do {
        await new Promise((r) => setTimeout(r, 2000))
        status = await pollTask(task.task_id)
      } while (status.status === 'pending' || status.status === 'running')

      if (status.status === 'completed' && status.result_url) {
        setOutputUrl(status.result_url)
        setNodeOutput(genNode.id, status.result_url, status.result_type || 'image')
      } else {
        addToast(`Generation failed: ${status.error || 'unknown error'}`, 'error')
      }
    } catch (err: any) {
      addToast(`Error: ${err.message}`, 'error')
    } finally {
      setGenerating(false)
    }
  }, [nodes, setOutputUrl, setNodeOutput])

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f0f0f', color: '#e0e0e0' }}>
      <Sidebar />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#747474' }}>
        <img
          src="/aimation_logo.png"
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            opacity: 0.12,
            pointerEvents: 'none',
            zIndex: 0,
            filter: 'grayscale(100%)',
          }}
        />
        <ReactFlow
          nodes={nodes}
          edges={displayEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onNodeClick={(_, node) => selectNode(node.id)}
          onPaneClick={() => selectNode(null)}
          onNodeDragStop={onNodeDragStop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          minZoom={0.1}
          maxZoom={8}
          colorMode="dark"
          panOnDrag={false}
          panActivationKeyCode={'Shift'}
          selectionOnDrag
          selectionKeyCode={null}
          onContextMenu={(e) => e.preventDefault()}
          style={{ background: 'transparent' }}
        >
          <Background color="#2e2e2e" gap={20} size={0.5} variant={BackgroundVariant.Lines} />
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
                    onClick={() => { handleOpen(); setMenuOpen(false) }}
                    style={{ padding: '8px 14px', fontSize: 12, cursor: 'pointer', color: '#ccc' }}
                  >Open</div>
                </div>
              )}
              <input ref={openRef} type="file" accept=".json,.aimation" onChange={handleOpenFile} style={{ display: 'none' }} />
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
          <Panel position="top-center" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <VramStatusBar />
            <CreditStatusBar />
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
