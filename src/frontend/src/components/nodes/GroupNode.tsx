import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position, NodeResizer } from '@xyflow/react'
import { NODE_DEFINITIONS, getHandleColor, type NodeType, type GroupNodeData, type PortType } from '../../types/nodes'
import { useGraphStore } from '../../store/graph'

function GroupNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]
  const data = props.data as GroupNodeData
  const { collapsed, childIds, label, previewUrl, previewType } = data
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const selectedNode = useGraphStore((s) => s.selectedNode)
  const outputUrl = useGraphStore((s) => s.outputUrl)
  const resultType = useGraphStore((s) => s.resultType)
  const nodeOutputs = useGraphStore((s) => s.nodeOutputs)
  const addNodesToGroup = useGraphStore((s) => s.addNodesToGroup)
  const toggleGroupCollapse = useGraphStore((s) => s.toggleGroupCollapse)
  const removeNodesFromGroup = useGraphStore((s) => s.removeNodesFromGroup)
  const updateNodeData = useGraphStore((s) => s.updateNodeData)
  const resizeGroupWithChildren = useGraphStore((s) => s.resizeGroupWithChildren)

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(label ?? def.label)
  const inputRef = useRef<HTMLInputElement>(null)
  const origSizeRef = useRef<{ w: number; h: number; x: number; y: number; children: Map<string, { x: number; y: number; w: number | null; h: number | null }> } | null>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commitLabel = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== label) {
      updateNodeData(props.id, { label: trimmed })
    }
    setEditing(false)
  }

  const childCount = childIds?.length ?? 0

  // Collapsed: proxy handles for INPUT edges (outside → child)
  const inputProxyHandles = useMemo(() => {
    if (!collapsed || !childIds?.length) return null
    const childSet = new Set(childIds)
    const handles: Array<{
      id: string
      color: string
      label: string
    }> = []
    const seen = new Set<string>()

    for (const edge of edges) {
      if (childSet.has(edge.target) && !childSet.has(edge.source)) {
        const key = `target:${edge.target}:${edge.targetHandle}`
        if (seen.has(key)) continue
        seen.add(key)
        const portType = 'video_tensor' as PortType
        handles.push({
          id: key,
          color: getHandleColor(edge.targetHandle ?? '', portType),
          label: edge.targetHandle ?? '',
        })
      }
    }
    return handles.length > 0 ? handles : null
  }, [collapsed, childIds, edges])

  // Collapsed: proxy handles for OUTPUT edges (child → outside)
  const outputProxyHandles = useMemo(() => {
    if (!collapsed || !childIds?.length) return null
    const childSet = new Set(childIds)
    const handles: Array<{
      id: string
      color: string
      label: string
    }> = []
    const seen = new Set<string>()

    for (const edge of edges) {
      if (childSet.has(edge.source) && !childSet.has(edge.target)) {
        const key = `source:${edge.source}:${edge.sourceHandle}`
        if (seen.has(key)) continue
        seen.add(key)
        const sourceNode = nodes.find((n) => n.id === edge.source)
        const sourceDef = sourceNode ? NODE_DEFINITIONS[sourceNode.type as NodeType] : undefined
        const portDef = sourceDef?.outputs.find((p) => p.id === edge.sourceHandle)
        const portType: PortType = portDef?.type ?? 'video_tensor'
        handles.push({
          id: key,
          color: getHandleColor(edge.sourceHandle ?? '', portType),
          label: edge.sourceHandle ?? '',
        })
      }
    }
    return handles.length > 0 ? handles : null
  }, [collapsed, childIds, edges, nodes])

  const otherSelectedNodes = useMemo(() => {
    if (!selectedNode || selectedNode === props.id) return []
    return nodes.filter((n) => n.id === selectedNode && !childIds?.includes(n.id))
  }, [selectedNode, nodes, childIds, props.id])

  const handleAbsorb = () => {
    const ids = otherSelectedNodes.map((n) => n.id)
    if (ids.length > 0) addNodesToGroup(props.id, ids)
  }

  const handleRemoveSelected = () => {
    const selectedNodeId = useGraphStore.getState().selectedNode
    if (selectedNodeId && childIds?.includes(selectedNodeId)) {
      removeNodesFromGroup(props.id, [selectedNodeId])
    }
  }

  const handleResizeStart = useCallback(() => {
    const state = useGraphStore.getState()
    const group = state.nodes.find((n) => n.id === props.id)
    if (!group) return
    const childIds: string[] = (group.data as GroupNodeData).childIds ?? []
    const children = new Map<string, { x: number; y: number; w: number | null; h: number | null }>()
    for (const n of state.nodes) {
      if (childIds.includes(n.id)) {
        children.set(n.id, {
          x: n.position.x,
          y: n.position.y,
          w: n.width ?? null,
          h: n.height ?? null,
        })
      }
    }
    origSizeRef.current = {
      w: group.width ?? 260,
      h: group.height ?? 320,
      x: group.position.x,
      y: group.position.y,
      children,
    }
  }, [props.id])

  const handleResize = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      const orig = origSizeRef.current
      if (orig) {
        resizeGroupWithChildren(props.id, params.width, params.height, orig.w, orig.h, orig.x, orig.y, orig.children)
      }
    },
    [props.id, resizeGroupWithChildren],
  )

  const handleResizeEnd = useCallback(() => {
    origSizeRef.current = null
  }, [])

  const displayLabel = label ?? def.label

  const childPreview = useMemo(() => {
    if (!childIds?.length) return null
    for (let i = childIds.length - 1; i >= 0; i--) {
      const out = nodeOutputs[childIds[i]]
      if (out?.url) return out
    }
    return null
  }, [childIds, nodeOutputs])

  const resolvedUrl = previewUrl ?? nodeOutputs[props.id]?.url ?? childPreview?.url ?? outputUrl
  const resolvedType = previewType ?? nodeOutputs[props.id]?.type ?? childPreview?.type ?? resultType

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: collapsed ? '#1e1e2e' : 'rgba(30, 30, 46, 0.3)',
        border: collapsed ? '2px solid #6b7280' : '2px dashed #6b7280',
        borderRadius: 12,
        position: 'relative',
        overflow: 'visible',
        minWidth: 80,
        minHeight: 80,
      }}
    >
      {props.selected && (
        <NodeResizer
          handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }}
          minWidth={80}
          minHeight={80}
          onResizeStart={handleResizeStart}
          onResize={handleResize}
          onResizeEnd={handleResizeEnd}
        />
      )}

      {/* Input proxy handles when collapsed */}
      {inputProxyHandles?.map((h) => (
        <Handle
          key={h.id}
          type="target"
          position={Position.Left}
          id={h.id}
          style={{
            background: h.color,
            width: 10,
            height: 10,
            border: '2px solid #1a1a1a',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: -6,
              top: -2,
              transform: 'translateX(-100%)',
              fontSize: 8,
              color: h.color,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {h.label}
          </div>
        </Handle>
      ))}

      {/* Output proxy handles when collapsed — child → outside */}
      {outputProxyHandles?.map((h) => (
        <Handle
          key={h.id}
          type="source"
          position={Position.Right}
          id={h.id}
          style={{
            background: h.color,
            width: 10,
            height: 10,
            border: '2px solid #1a1a1a',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: -6,
              top: -2,
              transform: 'translateX(100%)',
              fontSize: 8,
              color: h.color,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {h.label}
          </div>
        </Handle>
      ))}

      {/* Header — always interactive */}
      <div
        style={{
          background: def.color,
          padding: '4px 8px',
          fontSize: 10,
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderRadius: '10px 10px 0 0',
          cursor: 'move',
          flexShrink: 0,
          pointerEvents: 'auto',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel()
              if (e.key === 'Escape') {
                setEditValue(label ?? def.label)
                setEditing(false)
              }
            }}
            style={{
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid #888',
              borderRadius: 3,
              color: '#fff',
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 4px',
              width: 100,
              outline: 'none',
            }}
          />
        ) : (
          <span
            onDoubleClick={() => {
              setEditValue(displayLabel)
              setEditing(true)
            }}
            style={{ cursor: 'text', flex: 1 }}
          >
            {displayLabel}
          </span>
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          {otherSelectedNodes.length > 0 && (
            <button
              onClick={handleAbsorb}
              title={`Add ${otherSelectedNodes.length} selected node(s) to group`}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                borderRadius: 4,
                color: '#fff',
                fontSize: 8,
                padding: '2px 5px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              +{otherSelectedNodes.length}
            </button>
          )}
          {childCount > 0 && selectedNode && childIds.includes(selectedNode) && (
            <button
              onClick={handleRemoveSelected}
              title="Remove selected node from group"
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                borderRadius: 4,
                color: '#fca5a5',
                fontSize: 8,
                padding: '2px 5px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              -1
            </button>
          )}
          <button
            onClick={() => toggleGroupCollapse(props.id)}
            title={collapsed ? 'Expand group' : 'Collapse group'}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 4,
              color: '#fff',
              fontSize: 9,
              padding: '2px 6px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            {collapsed ? '⬜' : '⬛'}
          </button>
        </div>
      </div>

      {/* Content area — double-click to collapse/expand */}
      <div
        style={{
          position: 'absolute',
          inset: '26px 0 0 0',
          pointerEvents: collapsed || childCount === 0 ? 'auto' : 'none',
          cursor: 'pointer',
        }}
        onDoubleClick={() => toggleGroupCollapse(props.id)}
      >
        {collapsed && (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            {resolvedUrl ? (
              resolvedType === 'video' ? (
                <video
                  src={resolvedUrl}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={resolvedUrl}
                  alt="preview"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                />
              )
            ) : (
              <div style={{ fontSize: 10, color: '#666', textAlign: 'center', padding: 8 }}>
                {childCount > 0 ? `${childCount} node(s)` : 'Empty group'}
              </div>
            )}
          </div>
        )}

        {!collapsed && childCount === 0 && (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              color: '#555',
            }}
          >
            Double-click to collapse
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(GroupNode)
