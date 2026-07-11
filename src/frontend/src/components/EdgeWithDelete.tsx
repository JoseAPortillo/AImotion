import { memo, useState } from 'react'
import { BaseEdge, getBezierPath, type EdgeProps, useReactFlow, type EdgeLabelRenderer } from '@xyflow/react'
import { useGraphStore } from '../store/graph'

function EdgeWithDelete(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, selected } = props
  const [hover, setHover] = useState(false)
  const deleteEdge = useGraphStore((s) => s.deleteEdge)

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const show = selected || hover

  return (
    <g
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ cursor: 'pointer' }}
    >
      <BaseEdge path={edgePath} style={style} />
      {show && (
        <foreignObject
          width={20}
          height={20}
          x={(sourceX + targetX) / 2 - 10}
          y={(sourceY + targetY) / 2 - 10}
          style={{ overflow: 'visible', pointerEvents: 'none' }}
        >
          <div
            onClick={(e) => {
              e.stopPropagation()
              deleteEdge(id)
            }}
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#ef4444',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              pointerEvents: 'auto',
              lineHeight: 1,
              border: '2px solid #1a1a1a',
              boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
            }}
          >
            ×
          </div>
        </foreignObject>
      )}
    </g>
  )
}

export default memo(EdgeWithDelete)
