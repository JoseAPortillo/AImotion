import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { MODALITY_FILTERS } from '../../../types/nodes'
import GeneratorNodeBase from './GeneratorNodeBase'

function ImageToImageNode(props: NodeProps) {
  return (
    <GeneratorNodeBase
      {...props}
      modalityFilter={MODALITY_FILTERS.imageToImage}
      activeInputs={['prompt_pos', 'prompt_neg', 'image_in']}
      outputLabel="Image"
      outputColor="#f97316"
    />
  )
}

export default memo(ImageToImageNode)
