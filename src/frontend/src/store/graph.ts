import { create } from 'zustand'
import {
  type Node,
  type Edge,
  type Connection,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react'
import { NODE_DEFINITIONS, type NodeType, type AppNode, type NodeData, getPortTypeFromHandle, getEdgeStyle } from '../types/nodes'

const NODE_DEFAULT_SIZE: Record<NodeType, { width: number; height: number }> = {
  videoInput: { width: 260, height: 120 },
  imageInput: { width: 260, height: 120 },
  audioInput: { width: 260, height: 120 },
  prompt: { width: 260, height: 180 },
  diffuserGenerator: { width: 260, height: 420 },
  transformersGenerator: { width: 260, height: 350 },
  vlmNode: { width: 260, height: 300 },
  llmGenerator: { width: 260, height: 320 },
  cvTaskProcessor: { width: 260, height: 180 },
  loadLora: { width: 260, height: 180 },
  applyControlNet: { width: 260, height: 200 },
  generation: { width: 260, height: 420 },
  textToImage: { width: 260, height: 420 },
  textToVideo: { width: 260, height: 420 },
  imageToVideo: { width: 260, height: 420 },
  videoToVideo: { width: 260, height: 420 },
  imageToImage: { width: 260, height: 420 },
  samplingParams: { width: 260, height: 180 },
  denoisingStrength: { width: 260, height: 100 },
  output: { width: 260, height: 200 },
  preview: { width: 260, height: 200 },
}

interface GraphState {
  nodes: AppNode[]
  edges: Edge[]
  selectedNode: string | null
  outputUrl: string | null
  resultType: 'image' | 'video' | null
  addNode: (type: NodeType, position: { x: number; y: number }) => void
  onNodesChange: (changes: NodeChange<AppNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void
  selectNode: (nodeId: string | null) => void
  setOutputUrl: (url: string | null, resultType?: 'image' | 'video' | null) => void
  removeNode: (nodeId: string) => void
  clearAll: () => void
  loadWorkflow: (wfNodes: AppNode[], wfEdges: Edge[]) => void
}

let nodeCounter = 0

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  outputUrl: null,
  resultType: null,

  addNode: (type, position) => {
    const def = NODE_DEFINITIONS[type]
    nodeCounter++
    const id = `${type}_${nodeCounter}`
    const defaultSize = NODE_DEFAULT_SIZE[type] || { width: 260, height: 320 }
    const newNode: AppNode = {
      id,
      type,
      position,
      data: { ...def.defaultData } as NodeData,
      width: defaultSize.width,
      height: defaultSize.height,
    }
    set((state) => ({ nodes: [...state.nodes, newNode] }))
  },

  onNodesChange: (changes) => {
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) as AppNode[] }))
  },

  onEdgesChange: (changes) => {
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) }))
  },

  onConnect: (connection) => {
    const nodes = get().nodes
    const sourceNode = nodes.find((n) => n.id === connection.source)
    const targetNode = nodes.find((n) => n.id === connection.target)
    if (!sourceNode || !targetNode) return

    const srcDef = NODE_DEFINITIONS[sourceNode.type as NodeType]
    const tgtDef = NODE_DEFINITIONS[targetNode.type as NodeType]
    const srcPortType = getPortTypeFromHandle(connection.sourceHandle || '', srcDef)
    const tgtPortType = getPortTypeFromHandle(connection.targetHandle || '', tgtDef)

    if (!srcPortType || !tgtPortType || srcPortType !== tgtPortType) return

    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          style: getEdgeStyle(srcPortType),
        },
        state.edges,
      ),
    }))
  },

  updateNodeData: (nodeId, data) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
      ),
    }))
  },

  selectNode: (nodeId) => set({ selectedNode: nodeId }),

  setOutputUrl: (url, resultType = null) => set({ outputUrl: url, resultType }),

  removeNode: (nodeId) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId)
      const remaining = state.nodes.filter((n) => n.id !== nodeId)
      const updates: Partial<GraphState & { outputUrl: string | null; resultType: 'image' | 'video' | null }> = {
        nodes: remaining,
        edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      }
      if (node?.type === 'preview' && !remaining.some((n) => n.type === 'preview')) {
        updates.outputUrl = null
        updates.resultType = null
      }
      return updates
    })
  },

  clearAll: () => set({ nodes: [], edges: [], selectedNode: null, outputUrl: null, resultType: null }),

  loadWorkflow: (wfNodes, wfEdges) => {
    const maxNum = wfNodes.reduce((max, n) => {
      const m = n.id.match(/_(\d+)$/)
      return m ? Math.max(max, parseInt(m[1], 10)) : max
    }, 0)
    nodeCounter = maxNum
    set({ nodes: wfNodes, edges: wfEdges, selectedNode: null, outputUrl: null, resultType: null })
  },
}))
