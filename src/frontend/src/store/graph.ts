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
  runwayVideoToVideo: { width: 260, height: 240 },
  runwayImageToVideo: { width: 260, height: 240 },
  samplingParams: { width: 260, height: 180 },
  denoisingStrength: { width: 260, height: 100 },
  output: { width: 260, height: 200 },
  preview: { width: 260, height: 200 },
  groupNode: { width: 400, height: 400 },
}

type Snapshot = { nodes: AppNode[]; edges: Edge[] }

interface GraphState {
  nodes: AppNode[]
  edges: Edge[]
  selectedNode: string | null
  outputUrl: string | null
  resultType: 'image' | 'video' | null
  nodeOutputs: Record<string, { url: string; type: 'image' | 'video' }>
  autoPreviews: Record<string, { url: string; type: 'image' | 'video' }>
  _historyPast: Snapshot[]
  _historyFuture: Snapshot[]
  _clipboard: Snapshot | null
  addNode: (type: NodeType, position: { x: number; y: number }) => string
  onNodesChange: (changes: NodeChange<AppNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (connection: Connection) => void
  updateNodeData: (nodeId: string, data: Partial<NodeData>) => void
  selectNode: (nodeId: string | null) => void
  setOutputUrl: (url: string | null, resultType?: 'image' | 'video' | null) => void
  setNodeOutput: (nodeId: string, url: string, type: 'image' | 'video') => void
  setAutoPreview: (nodeId: string, url: string, type: 'image' | 'video') => void
  removeNode: (nodeId: string) => void
  clearAll: () => void
  loadWorkflow: (
    wfNodes: AppNode[],
    wfEdges: Edge[],
    restoration?: {
      nodeOutputs?: Record<string, { url: string; type: 'image' | 'video' }>
      autoPreviews?: Record<string, { url: string; type: 'image' | 'video' }>
      outputUrl?: string | null
      resultType?: 'image' | 'video' | null
    },
  ) => void
  addNodesToGroup: (groupId: string, childIds: string[]) => void
  removeNodesFromGroup: (groupId: string, childIds: string[]) => void
  toggleGroupCollapse: (groupId: string) => void
  createGroupFromSelection: (selectedIds: string[]) => string | null
  resizeGroupWithChildren: (groupId: string, newWidth: number, newHeight: number, origWidth?: number, origHeight?: number, origX?: number, origY?: number, origChildren?: Map<string, { x: number; y: number; w: number | null; h: number | null }>) => void
  _snapshot: () => void
  undo: () => void
  redo: () => void
  deleteEdge: (edgeId: string) => void
  toggleNodeCollapse: (nodeId: string) => void
  copySelectedNodes: () => void
  pasteNodes: () => void
}

function revokeBlobUrl(url: string) {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
}

function revokeAllBlobUrls(record: Record<string, { url: string; type: string }>) {
  for (const entry of Object.values(record)) {
    revokeBlobUrl(entry.url)
  }
}

let nodeCounter = 0
let updateDataTimer: ReturnType<typeof setTimeout> | null = null

function cloneSnapshot(nodes: AppNode[], edges: Edge[]): Snapshot {
  return {
    nodes: nodes.map(n => ({ ...n, data: { ...n.data } })),
    edges: edges.map(e => ({ ...e })),
  }
}

const MAX_HISTORY = 50

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  outputUrl: null,
  resultType: null,
  nodeOutputs: {},
  autoPreviews: {},
  _historyPast: [],
  _historyFuture: [],
  _clipboard: null,

  addNode: (type, position) => {
    get()._snapshot()
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
    get()._snapshot()
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
    const state = get()
    if (!updateDataTimer) state._snapshot()
    if (updateDataTimer) clearTimeout(updateDataTimer)
    updateDataTimer = setTimeout(() => { updateDataTimer = null }, 500)
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

  setAutoPreview: (nodeId, url, type) => {
    set((state) => ({
      autoPreviews: { ...state.autoPreviews, [nodeId]: { url, type } },
    }))
  },

  removeNode: (nodeId) => {
    get()._snapshot()
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId)
      revokeBlobUrl(state.nodeOutputs[nodeId]?.url ?? '')
      revokeBlobUrl(state.autoPreviews[nodeId]?.url ?? '')
      const remaining = state.nodes.filter((n) => n.id !== nodeId)
      const { [nodeId]: _, ...restOutputs } = state.nodeOutputs
      const { [nodeId]: _ap, ...restPreviews } = state.autoPreviews
      const updates: Partial<GraphState & { outputUrl: string | null; resultType: 'image' | 'video' | null }> = {
        nodes: remaining,
        edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
        nodeOutputs: restOutputs,
        autoPreviews: restPreviews,
      }
      if (node?.type === 'preview' && !remaining.some((n) => n.type === 'preview')) {
        updates.outputUrl = null
        updates.resultType = null
      }
      return updates
    })
  },

  clearAll: () => {
    get()._snapshot()
    const state = get()
    revokeAllBlobUrls(state.nodeOutputs)
    revokeAllBlobUrls(state.autoPreviews)
    set({ nodes: [], edges: [], selectedNode: null, outputUrl: null, resultType: null, nodeOutputs: {}, autoPreviews: {}, _historyPast: [], _historyFuture: [] })
  },

  loadWorkflow: (wfNodes, wfEdges, restoration) => {
    get()._snapshot()
    const state = get()
    revokeAllBlobUrls(state.nodeOutputs)
    revokeAllBlobUrls(state.autoPreviews)
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
      autoPreviews: restoration?.autoPreviews ?? {},
    })
  },

  addNodesToGroup: (groupId, childIds) => {
    get()._snapshot()
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
    get()._snapshot()
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
    get()._snapshot()
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group || group.type !== 'groupNode') return state

      const data = group.data as GroupNodeData
      const willCollapse = !data.collapsed
      const childIds: string[] = data.childIds ?? []
      const collapsedSize = { width: 200, height: 240 }

      const expW = data.expandedWidth ?? group.width ?? collapsedSize.width
      const expH = data.expandedHeight ?? group.height ?? collapsedSize.height
      const dx = expW - collapsedSize.width
      const dy = expH - collapsedSize.height

      const updatedNodes = state.nodes.map((node) => {
        if (node.id === groupId) {
          if (willCollapse) {
            const savedChildPositions: Record<string, { relX: number; relY: number }> = {}
            for (const childId of childIds) {
              const child = state.nodes.find((n) => n.id === childId)
              if (child) {
                savedChildPositions[childId] = {
                  relX: child.position.x - node.position.x,
                  relY: child.position.y - node.position.y,
                }
              }
            }
            return {
              ...node,
              position: { x: node.position.x + dx / 2, y: node.position.y + dy / 2 },
              width: collapsedSize.width,
              height: collapsedSize.height,
              data: {
                ...node.data,
                collapsed: willCollapse,
                expandedWidth: node.width ?? data.expandedWidth,
                expandedHeight: node.height ?? data.expandedHeight,
                savedChildPositions,
              } as GroupNodeData,
            }
          }
          const newGroupX = node.position.x - dx / 2
          const newGroupY = node.position.y - dy / 2
          return {
            ...node,
            position: { x: newGroupX, y: newGroupY },
            width: expW,
            height: expH,
            data: {
              ...node.data,
              collapsed: willCollapse,
              expandedWidth: undefined,
              expandedHeight: undefined,
              savedChildPositions: undefined,
            } as GroupNodeData,
          }
        }
        if (childIds.includes(node.id)) {
          if (willCollapse) {
            return { ...node, hidden: true, style: { ...node.style, display: 'none' } }
          }
          const saved = data.savedChildPositions?.[node.id]
          const groupX = group.position.x - dx / 2
          const groupY = group.position.y - dy / 2
          const { style, ...rest } = node
          const { display: _, ...cleanStyle } = style || {}
          return {
            ...rest,
            hidden: false,
            position: saved
              ? { x: groupX + saved.relX, y: groupY + saved.relY }
              : node.position,
            style: Object.keys(cleanStyle).length ? cleanStyle : undefined,
          }
        }
        return node
      })

      return { ...state, nodes: updatedNodes }
    })
  },

  createGroupFromSelection: (selectedIds) => {
    get()._snapshot()
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

  resizeGroupWithChildren: (groupId, newWidth, newHeight, origWidth, origHeight, origX, origY, origChildren) => {
    set((state) => {
      const group = state.nodes.find((n) => n.id === groupId)
      if (!group || group.type !== 'groupNode') return state

      const oldW = origWidth ?? group.width ?? newWidth
      const oldH = origHeight ?? group.height ?? newHeight
      const sx = oldW > 0 ? newWidth / oldW : 1
      const sy = oldH > 0 ? newHeight / oldH : 1

      const groupOrigX = origX ?? group.position.x
      const groupOrigY = origY ?? group.position.y

      const childIds: string[] = (group.data as GroupNodeData).childIds ?? []

      const updatedNodes = state.nodes.map((node) => {
        if (node.id === groupId) {
          return { ...node, width: newWidth, height: newHeight }
        }
        if (childIds.includes(node.id)) {
          const orig = origChildren?.get(node.id)
          const origX = orig?.x ?? node.position.x
          const origY = orig?.y ?? node.position.y
          const origW = orig?.w ?? node.width
          const origH = orig?.h ?? node.height
          const relX = origX - groupOrigX
          const relY = origY - groupOrigY
          return {
            ...node,
            position: {
              x: group.position.x + relX * sx,
              y: group.position.y + relY * sy,
            },
            width: origW ? origW * sx : origW,
            height: origH ? origH * sy : origH,
          }
        }
        return node
      })

      return { nodes: updatedNodes }
    })
  },

  deleteEdge: (edgeId) => {
    get()._snapshot()
    set((s) => ({ edges: s.edges.filter((e) => e.id !== edgeId) }))
  },

  toggleNodeCollapse: (nodeId) => {
    get()._snapshot()
    set((s) => {
      const node = s.nodes.find((n) => n.id === nodeId)
      if (!node) return s
      const nd = node.data as Record<string, unknown>
      const wasCollapsed = !!nd.collapsed
      if (!wasCollapsed) {
        return {
          nodes: s.nodes.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, collapsed: true, _origH: n.height } as NodeData, height: 36 }
              : n,
          ),
        }
      }
      const origH = (nd._origH as number) || node.height || 120
      return {
        nodes: s.nodes.map((n) => {
          if (n.id !== nodeId) return n
          const { collapsed: _, _origH: __, ...clean } = n.data as Record<string, unknown>
          return { ...n, data: clean as NodeData, height: origH }
        }),
      }
    })
  },

  _snapshot: () => {
    const { nodes, edges, _historyPast } = get()
    const snap = cloneSnapshot(nodes, edges)
    const past = [..._historyPast, snap].slice(-MAX_HISTORY)
    set({ _historyPast: past, _historyFuture: [] })
  },

  undo: () => {
    const { _historyPast, nodes, edges } = get()
    if (_historyPast.length === 0) return
    const prev = _historyPast[_historyPast.length - 1]
    const current = cloneSnapshot(nodes, edges)
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      _historyPast: _historyPast.slice(0, -1),
      _historyFuture: [...get()._historyFuture, current].slice(-MAX_HISTORY),
    })
  },

  redo: () => {
    const { _historyFuture, nodes, edges } = get()
    if (_historyFuture.length === 0) return
    const next = _historyFuture[_historyFuture.length - 1]
    const current = cloneSnapshot(nodes, edges)
    set({
      nodes: next.nodes,
      edges: next.edges,
      _historyFuture: _historyFuture.slice(0, -1),
      _historyPast: [...get()._historyPast, current].slice(-MAX_HISTORY),
    })
  },

  copySelectedNodes: () => {
    const { nodes, edges } = get()
    const selected = nodes.filter((n) => n.selected)
    if (selected.length === 0) return
    const selectedIds = new Set(selected.map((n) => n.id))
    const internalEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
    )
    set({ _clipboard: cloneSnapshot(selected, internalEdges) })
  },

  pasteNodes: () => {
    const { _clipboard } = get()
    if (!_clipboard || _clipboard.nodes.length === 0) return

    const idMap = new Map<string, string>()
    const newNodes: AppNode[] = _clipboard.nodes.map((n) => {
      nodeCounter++
      const newId = `${n.type}_${nodeCounter}`
      idMap.set(n.id, newId)
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + 50, y: n.position.y + 50 },
        selected: true,
      }
    })

    const newEdges: Edge[] = _clipboard.edges.map((e) => ({
      ...e,
      id: `_paste_${e.id}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }))

    get()._snapshot()
    set((s) => ({
      nodes: [
        ...s.nodes.map((n) => ({ ...n, selected: false })),
        ...newNodes,
      ],
      edges: [...s.edges, ...newEdges],
    }))
  },
}))
