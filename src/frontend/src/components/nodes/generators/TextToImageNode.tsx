import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { MODALITY_FILTERS } from '../../../types/nodes'
import GeneratorNodeBase from './GeneratorNodeBase'

function TextToImageNode(props: NodeProps) {
  return (
    <GeneratorNodeBase
      {...props}
      modalityFilter={MODALITY_FILTERS.textToImage}
      activeInputs={['prompt_pos', 'prompt_neg']}
      outputLabel="Image"
      outputColor="#f97316"
    />
  )
}

export default memo(TextToImageNode)
