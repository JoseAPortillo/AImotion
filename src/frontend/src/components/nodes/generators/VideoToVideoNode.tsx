import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { MODALITY_FILTERS } from '../../../types/nodes'
import GeneratorNodeBase from './GeneratorNodeBase'

function VideoToVideoNode(props: NodeProps) {
  return (
    <GeneratorNodeBase
      {...props}
      modalityFilter={MODALITY_FILTERS.videoToVideo}
      activeInputs={['prompt_pos', 'prompt_neg', 'video_in']}
      outputLabel="Video"
      outputColor="#ef4444"
    />
  )
}

export default memo(VideoToVideoNode)
