import { type DragEvent } from 'react'
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
        {(Object.keys(NODE_DEFINITIONS) as NodeType[]).filter((key) => !NODE_DEFINITIONS[key].paletteHidden).map((key) => {
          const def = NODE_DEFINITIONS[key]
          return (
            <div
              key={key}
              draggable
              onDragStart={(e) => onDragStart(e, key)}
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
        })}
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
