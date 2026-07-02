import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'
import { NODE_DEFINITIONS, PORT_COLORS, getHandleColor, type NodeType } from '../../../types/nodes'
import NodeWrapper from '../NodeWrapper'

function LLMGeneratorNode(props: NodeProps) {
  const def = NODE_DEFINITIONS[props.type as NodeType]

  return (
    <NodeWrapper def={def} selected={props.selected}>
      <div style={{ padding: '4px 6px', fontSize: 10, color: '#888' }}>
        Language Model — coming soon
      </div>
      <Handle type="target" position={Position.Left} id="prompt_pos" style={{ top: '50%', background: PORT_COLORS.prompt }}>
        <div style={{ position: 'absolute', left: -6, top: -2, transform: 'translateX(-100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Prompt</div>
      </Handle>
      <Handle type="source" position={Position.Right} id="text_out" style={{ top: '50%', background: PORT_COLORS.prompt }}>
        <div style={{ position: 'absolute', right: -6, top: -2, transform: 'translateX(100%)', fontSize: 9, color: PORT_COLORS.prompt, whiteSpace: 'nowrap' }}>Text</div>
      </Handle>
    </NodeWrapper>
  )
}

export default memo(LLMGeneratorNode)
