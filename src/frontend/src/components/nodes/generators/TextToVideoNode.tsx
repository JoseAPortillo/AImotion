import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { MODALITY_FILTERS } from '../../../types/nodes'
import GeneratorNodeBase from './GeneratorNodeBase'

function TextToVideoNode(props: NodeProps) {
  return (
    <GeneratorNodeBase
      {...props}
      modalityFilter={MODALITY_FILTERS.textToVideo}
      activeInputs={['prompt_pos', 'prompt_neg']}
      outputLabel="Video"
      outputColor="#4ade80"
    />
  )
}

export default memo(TextToVideoNode)
