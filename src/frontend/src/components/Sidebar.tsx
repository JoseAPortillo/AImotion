import { useState, type DragEvent } from 'react'
import type { NodeType } from '../types/nodes'
import { NODE_DEFINITIONS } from '../types/nodes'

function onDragStart(event: DragEvent<HTMLDivElement>, nodeType: NodeType) {
  event.dataTransfer.setData('application/reactflow', nodeType)
  event.dataTransfer.effectAllowed = 'move'
}

const ALL_PORT_TYPES = [
  { type: 'video_tensor', label: 'Video Tensor', color: '#6366f1' },
  { type: 'audio_features', label: 'Audio Features', color: '#ec4899' },
  { type: 'prompt', label: 'Prompt', color: '#22c55e' },
  { type: 'params', label: 'Params', color: '#f59e0b' },
] as const

interface NodeGroup {
  label: string
  nodes?: NodeType[]
  children?: NodeGroup[]
}

const NODE_GROUPS: NodeGroup[] = [
  {
    label: 'Inputs',
    nodes: ['videoInput', 'imageInput', 'audioInput', 'prompt'],
  },
  {
    label: 'Models',
    children: [
      {
        label: 'Diffusers',
        nodes: ['textToImage', 'textToVideo', 'imageToVideo', 'videoToVideo', 'imageToImage'],
      },
      {
        label: 'Cloud',
        nodes: ['runwayVideoToVideo', 'runwayImageToVideo'],
      },
      {
        label: 'Transformers',
        nodes: ['transformersGenerator'],
      },
      {
        label: 'Vision',
        nodes: ['vlmNode'],
      },
      {
        label: 'LLM',
        nodes: ['llmGenerator'],
      },
    ],
  },
  {
    label: 'Adapters',
    nodes: ['loadLora', 'applyControlNet'],
  },
  {
    label: 'Processors',
    nodes: ['cvTaskProcessor'],
  },
  {
    label: 'Outputs',
    nodes: ['output', 'preview'],
  },
  {
    label: 'Groups',
    nodes: ['groupNode'],
  },
]

function NodeItem({ nodeType }: { nodeType: NodeType }) {
  const def = NODE_DEFINITIONS[nodeType]
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, nodeType)}
      style={{
        borderRadius: 8,
        background: '#0f0f0f',
        padding: '10px 12px',
        marginBottom: 8,
        cursor: 'grab',
        borderLeft: `3px solid ${def.color}`,
        fontSize: 13,
        color: '#c0c0c0',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: def.color,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 500 }}>{def.label}</span>
      </div>

      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888' }}>
        {def.inputs.length > 0 && (
          <span>
            ←{' '}
            {def.inputs.map((p) => (
              <span key={p.id} style={{ color: def.color }}>
                {p.label}
              </span>
            ))}
          </span>
        )}
        {def.outputs.length > 0 && (
          <span>
            →{' '}
            {def.outputs.map((p) => (
              <span key={p.id} style={{ color: def.color }}>
                {p.label}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

function CollapsibleGroup({ group, defaultOpen = true, isSubGroup = false }: { group: NodeGroup; defaultOpen?: boolean; isSubGroup?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div style={{ marginBottom: 8, marginLeft: isSubGroup ? 12 : 0 }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          color: isSubGroup ? '#888' : '#a0a0a0',
          fontSize: isSubGroup ? 11 : 12,
          fontWeight: 600,
          padding: isSubGroup ? '4px 0' : '6px 0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        <span style={{ fontSize: isSubGroup ? 9 : 10, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          ▶
        </span>
        {group.label}
      </button>
      {isOpen && (
        <div style={{ marginTop: 4 }}>
          {group.nodes?.map((nodeType) => (
            <NodeItem key={nodeType} nodeType={nodeType} />
          ))}
          {group.children?.map((child) => (
            <CollapsibleGroup key={child.label} group={child} defaultOpen={true} isSubGroup={true} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside
      style={{
        width: 240,
        background: '#1a1a1a',
        borderRight: '1px solid #2a2a2a',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        overflow: 'hidden',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e0e0e0' }}>
        Nodes
      </h2>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {NODE_GROUPS.map((group) => (
          <CollapsibleGroup key={group.label} group={group} defaultOpen={true} />
        ))}
      </div>

      <div
        style={{
          borderTop: '1px solid #2a2a2a',
          paddingTop: 12,
          fontSize: 11,
          color: '#888',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, color: '#a0a0a0' }}>Ports</div>
        {ALL_PORT_TYPES.map((pt) => (
          <div key={pt.type} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: pt.color,
                flexShrink: 0,
              }}
            />
            <span>{pt.label}</span>
          </div>
        ))}
      </div>
    </aside>
  )
}
