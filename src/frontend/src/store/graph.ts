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

interface GraphState {
  nodes: AppNode[]
  edges: Edge[]
  selectedNode: string | null
  outputUrl: string | null
  addNode: (type: NodeType, position: { x: number; y: number }) => void
  onNodesChange: (changes: NodeChange<AppNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void
  selectNode: (nodeId: string | null) => void
  setOutputUrl: (url: string | null) => void
  removeNode: (nodeId: string) => void
}

let nodeCounter = 0

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  outputUrl: null,

  addNode: (type, position) => {
    const def = NODE_DEFINITIONS[type]
    nodeCounter++
    const id = `${type}_${nodeCounter}`
    const newNode: AppNode = {
      id,
      type,
      position,
      data: { ...def.defaultData } as NodeData,
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

  setOutputUrl: (url) => set({ outputUrl: url }),

  removeNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }))
  },
}))
