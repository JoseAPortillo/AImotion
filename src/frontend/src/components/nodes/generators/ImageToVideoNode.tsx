import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { MODALITY_FILTERS } from '../../../types/nodes'
import GeneratorNodeBase from './GeneratorNodeBase'

function ImageToVideoNode(props: NodeProps) {
  return (
    <GeneratorNodeBase
      {...props}
      modalityFilter={MODALITY_FILTERS.imageToVideo}
      activeInputs={['prompt_pos', 'prompt_neg', 'image_in']}
      outputLabel="Video"
      outputColor="#a855f7"
    />
  )
}

export default memo(ImageToVideoNode)
