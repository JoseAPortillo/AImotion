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
import { NODE_DEFINITIONS, type NodeType, type AppNode, type NodeData, type GroupNodeData, getPortTypeFromHandle, getEdgeStyle } from '../types/nodes'

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
  groupNode: { width: 400, height: 400 },
}

interface GraphState {
  nodes: AppNode[]
  edges: Edge[]
  selectedNode: string | null
  outputUrl: string | null
  resultType: 'image' | 'video' | null
  nodeOutputs: Record<string, { url: string; type: 'image' | 'video' }>
  addNode: (type: NodeType, position: { x: number; y: number }) => string
  onNodesChange: (changes: NodeChange<AppNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void
  selectNode: (nodeId: string | null) => void
  setOutputUrl: (url: string | null, resultType?: 'image' | 'video' | null) => void
  setNodeOutput: (nodeId: string, url: string, type: 'image' | 'video') => void
  removeNode: (nodeId: string) => void
  clearAll: () => void
  loadWorkflow: (
    wfNodes: AppNode[],
    wfEdges: Edge[],
    restoration?: {
      nodeOutputs?: Record<string, { url: string; type: 'image' | 'video' }>
      outputUrl?: string | null
      resultType?: 'image' | 'video' | null
    },
  ) => void
  addNodesToGroup: (groupId: string, childIds: string[]) => void
  removeNodesFromGroup: (groupId: string, childIds: string[]) => void
  toggleGroupCollapse: (groupId: string) => void
  createGroupFromSelection: (selectedIds: string[]) => string | null
  resizeGroupWithChildren: (groupId: string, newWidth: number, newHeight: number) => void
}

let nodeCounter = 0

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  outputUrl: null,
  resultType: null,
  nodeOutputs: {},

  addNode: (type, position) => {
    const def = NODE_DEFINITIONS[type]
    nodeCounter++
    const id = `${type}_${nodeCounter}`
    const defaultSize = NODE_DEFAULT_SIZE[type] || { width: 260, height: 320 }
    const isGroup = type === 'groupNode'
    const newNode: AppNode = {
      id,
      type,
      position,
      data: { ...def.defaultData } as NodeData,
      width: defaultSize.width,
      height: defaultSize.height,
      zIndex: isGroup ? -100 : 100,
    }
    set((state) => ({ nodes: [...state.nodes, newNode] }))
    return id
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

  setNodeOutput: (nodeId, url, type) => {
    set((state) => {
      const outputs: Record<string, { url: string; type: 'image' | 'video' }> = {
        ...state.nodeOutputs,
        [nodeId]: { url, type },
      }
      // Propagate to parent group if this node is a child of one
      const parentGroup = state.nodes.find(
        (n) => n.type === 'groupNode' && (n.data as GroupNodeData).childIds?.includes(nodeId)
      )
      if (parentGroup) {
        outputs[parentGroup.id] = { url, type }
      }
      return { nodeOutputs: outputs }
    })
  },

  removeNode: (nodeId) => {
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId)
      const remaining = state.nodes.filter((n) => n.id !== nodeId)
      const { [nodeId]: _, ...restOutputs } = state.nodeOutputs
      const updates: Partial<GraphState & { outputUrl: string | null; resultType: 'image' | 'video' | null }> = {
        nodes: remaining,
        edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
        nodeOutputs: restOutputs,
      }
      if (node?.type === 'preview' && !remaining.some((n) => n.type === 'preview')) {
        updates.outputUrl = null
        updates.resultType = null
      }
      return updates
    })
  },

  clearAll: () => set({ nodes: [], edges: [], selectedNode: null, outputUrl: null, resultType: null, nodeOutputs: {} }),

  loadWorkflow: (wfNodes, wfEdges, restoration) => {
    const maxNum = wfNodes.reduce((max, n) => {
      const m = n.id.match(/_(\d+)$/)
      return m ? Math.max(max, parseInt(m[1], 10)) : max
    }, 0)
    nodeCounter = maxNum

    // Collect all collapsed group child IDs
    const collapsedChildren = new Set<string>()
    for (const n of wfNodes) {
      if (n.type === 'groupNode' && (n.data as GroupNodeData).collapsed) {
        for (const cid of (n.data as GroupNodeData).childIds ?? []) {
          collapsedChildren.add(cid)
        }
      }
    }

    const collapsedSize = { width: 200, height: 240 }
    const nodesWithSize = wfNodes.map((n) => {
      const isCollapsedGroup = n.type === 'groupNode' && (n.data as GroupNodeData).collapsed
      return {
        ...n,
        hidden: collapsedChildren.has(n.id) ? true : n.hidden,
        width: isCollapsedGroup ? collapsedSize.width : (n.width ?? NODE_DEFAULT_SIZE[n.type as NodeType]?.width ?? 260),
        height: isCollapsedGroup ? collapsedSize.height : (n.height ?? NODE_DEFAULT_SIZE[n.type as NodeType]?.height ?? 320),
        zIndex: n.type === 'groupNode' ? -100 : (n.zIndex ?? 100),
        style: collapsedChildren.has(n.id) ? { ...n.style, display: 'none' as const } : n.style,
      }
    })
    set({
      nodes: nodesWithSize,
      edges: wfEdges,
      selectedNode: null,
      outputUrl: restoration?.outputUrl ?? null,
      resultType: restoration?.resultType ?? null,
      nodeOutputs: restoration?.nodeOutputs ?? {},
    })
  },

  addNodesToGroup: (groupId, childIds) => {
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group) return state
      const existingChildIds: string[] = (group.data as GroupNodeData).childIds ?? []
      const merged = [...new Set([...existingChildIds, ...childIds])]
      const updatedNodes = state.nodes.map((node) => {
        if (node.id === groupId) {
          return { ...node, data: { ...node.data, childIds: merged } as GroupNodeData }
        }
        if (childIds.includes(node.id) && !node.zIndex) {
          return { ...node, zIndex: 100 }
        }
        return node
      })
      return { ...state, nodes: updatedNodes }
    })
  },

  removeNodesFromGroup: (groupId, childIds) => {
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group) return state
      const existingChildIds: string[] = (group.data as GroupNodeData).childIds ?? []
      const remaining = existingChildIds.filter((id) => !childIds.includes(id))
      const updatedNodes = state.nodes.map((node) => {
        if (node.id === groupId) {
          return { ...node, data: { ...node.data, childIds: remaining } as GroupNodeData }
        }
        if (childIds.includes(node.id)) {
          const { hidden, style, ...rest } = node
          const { display: _, ...cleanStyle } = style || {}
          return {
            ...rest,
            hidden: false,
            style: Object.keys(cleanStyle).length ? cleanStyle : undefined,
          }
        }
        return node
      })
      return { ...state, nodes: updatedNodes }
    })
  },

  toggleGroupCollapse: (groupId) => {
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group || group.type !== 'groupNode') return state

      const data = group.data as GroupNodeData
      const willCollapse = !data.collapsed
      const childIds: string[] = data.childIds ?? []
      const collapsedSize = { width: 200, height: 240 }

      const updatedNodes = state.nodes.map((node) => {
        if (node.id === groupId) {
          if (willCollapse) {
            const expW = node.width ?? data.expandedWidth ?? collapsedSize.width
            const dx = expW - collapsedSize.width
            return {
              ...node,
              position: { x: node.position.x + dx, y: node.position.y },
              width: collapsedSize.width,
              height: collapsedSize.height,
              data: {
                ...node.data,
                collapsed: willCollapse,
                expandedWidth: node.width ?? data.expandedWidth,
                expandedHeight: node.height ?? data.expandedHeight,
                expandedX: node.position.x,
              } as GroupNodeData,
            }
          }
          const expX = data.expandedX ?? node.position.x
          return {
            ...node,
            position: { x: expX, y: node.position.y },
            width: data.expandedWidth ?? node.width,
            height: data.expandedHeight ?? node.height,
            data: {
              ...node.data,
              collapsed: willCollapse,
              expandedWidth: undefined,
              expandedHeight: undefined,
              expandedX: undefined,
            } as GroupNodeData,
          }
        }
        if (childIds.includes(node.id)) {
          if (willCollapse) {
            return { ...node, hidden: true, style: { ...node.style, display: 'none' } }
          }
          const { style, ...rest } = node
          const { display: _, ...cleanStyle } = style || {}
          return { ...rest, hidden: false, style: Object.keys(cleanStyle).length ? cleanStyle : undefined }
        }
        return node
      })

      return { ...state, nodes: updatedNodes }
    })
  },

  createGroupFromSelection: (selectedIds) => {
    const state = get()
    if (selectedIds.length === 0) return null

    const selectedNodes = state.nodes.filter((n) => selectedIds.includes(n.id))
    if (selectedNodes.length === 0) return null

    const minX = Math.min(...selectedNodes.map((n) => n.position.x))
    const minY = Math.min(...selectedNodes.map((n) => n.position.y))
    const maxX = Math.max(...selectedNodes.map((n) => n.position.x + (n.width ?? 260)))
    const maxY = Math.max(...selectedNodes.map((n) => n.position.y + (n.height ?? 320)))

    const padding = 40
    const groupX = minX - padding
    const groupY = minY - padding
    const groupW = maxX - minX + padding * 2
    const groupH = maxY - minY + padding * 2

    nodeCounter++
    const groupId = `groupNode_${nodeCounter}`
    const newNode: AppNode = {
      id: groupId,
      type: 'groupNode',
      position: { x: groupX, y: groupY },
      data: { collapsed: false, childIds: selectedIds, label: 'Group' } as GroupNodeData,
      width: groupW,
      height: groupH,
      zIndex: -100,
    }

    const updatedNodes = state.nodes.map((node) => {
      if (selectedIds.includes(node.id)) {
        return { ...node, selected: false }
      }
      return node
    })

    set({
      nodes: [...updatedNodes, newNode],
      selectedNode: groupId,
    })
    return groupId
  },

  resizeGroupWithChildren: (groupId, newWidth, newHeight) => {
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group || group.type !== 'groupNode') return state

      const oldW = group.width ?? newWidth
      const oldH = group.height ?? newHeight
      const sx = oldW > 0 ? newWidth / oldW : 1
      const sy = oldH > 0 ? newHeight / oldH : 1

      const childIds: string[] = (group.data as GroupNodeData).childIds ?? []

      const updatedNodes = state.nodes.map((node) => {
        if (node.id === groupId) {
          return { ...node, width: newWidth, height: newHeight }
        }
        if (childIds.includes(node.id)) {
          const relX = node.position.x - group.position.x
          const relY = node.position.y - group.position.y
          return {
            ...node,
            position: {
              x: group.position.x + relX * sx,
              y: group.position.y + relY * sy,
            },
            width: node.width ? node.width * sx : node.width,
            height: node.height ? node.height * sy : node.height,
          }
        }
        return node
      })

      return { nodes: updatedNodes }
    })
  },
}))
