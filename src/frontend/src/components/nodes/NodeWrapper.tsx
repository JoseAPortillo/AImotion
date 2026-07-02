import { useState, useLayoutEffect, useRef, type ReactNode } from 'react'
import { NodeResizer } from '@xyflow/react'

interface NodeWrapperProps {
  children: ReactNode
  def: { color: string; label: string }
  selected: boolean
  headerRight?: ReactNode
  footer?: ReactNode
  handles?: ReactNode
  style?: React.CSSProperties
}

export const FIELD_DESCS: Record<string, string> = {
  steps: 'Number of denoising steps. More steps = higher quality but slower generation.',
  cfg: 'Classifier-Free Guidance scale. Higher values = generation follows the prompt more closely.',
  seed: 'Random seed for reproducibility. 0 = random seed each run.',
  strength: 'How much of the original image/video is preserved. Lower values = more change.',
  width: 'Output width in pixels. Must be a multiple of 8.',
  height: 'Output height in pixels. Must be a multiple of 8.',
  num_frames: 'Number of frames to generate. More frames = longer video.',
  max_sequence_length: 'Maximum sequence length for text encoding. Higher = more context.',
  vae_tiling: 'Process the VAE in tiles to reduce VRAM usage.',
  vae_tile_overlap: 'Overlap between VAE tiles. Higher = fewer seams but more VRAM.',
  noise_aug_strength: 'Strength of noise augmentation applied to the input image (SVD). Higher = more variation from the input.',
  fps: 'Frames per second in the generated video.',
  motion_bucket_id: 'Motion bucket ID for SVD. Higher values = more motion in the output.',
  decode_chunk_size: 'Number of frames to decode at once. Lower = less VRAM usage.',
  min_guidance_scale: 'Minimum guidance scale for SVD. Used for classifier-free guidance range.',
  max_guidance_scale: 'Maximum guidance scale for SVD. Used for classifier-free guidance range.',
  temperature: 'Sampling temperature. Higher = more random output. Lower = more deterministic.',
  max_tokens: 'Maximum number of tokens to generate.',
  top_p: 'Nucleus sampling threshold. Only tokens with cumulative probability above this are considered.',
  top_k: 'Top-K sampling. Only the top K most likely tokens are considered at each step.',
  loraFile: 'Path to the LoRA weights file.',
  scale: 'Strength of the LoRA adapter. Higher = more pronounced effect.',
  model: 'HuggingFace model to use for generation.',
  scheduler: 'Noise scheduler for the diffusion process. Different schedulers trade off speed vs quality.',
  positive: 'Positive prompt describing what you want to generate.',
  negative: 'Negative prompt describing what to avoid in generation.',
  controlnetModel: 'ControlNet model to use for conditioning.',
  image_guidance_scale: 'How strongly the InstructPix2Pix edit follows the instruction. Higher = more change.',
}

export function InfoLabel({ label, desc, style }: { label: string; desc?: string; style?: React.CSSProperties }) {
  return (
    <span style={{ fontSize: 9, color: '#888', display: 'block', marginBottom: 1, ...style }}>
      {label}
      {desc && (
        <span
          title={desc}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 4,
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#333',
            color: '#999',
            fontSize: 8,
            cursor: 'help',
            lineHeight: 1,
            verticalAlign: 'middle',
          }}
        >
          ?
        </span>
      )}
    </span>
  )
}

export function CollapsibleSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <div style={{ marginTop: 4 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'none',
          border: 'none',
          color: '#999',
          fontSize: 9,
          fontWeight: 600,
          padding: '3px 0',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          borderTop: open ? '1px solid #2a2a2a' : 'none',
        }}
      >
        {title}
        <span style={{ fontSize: 8, color: '#555' }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div style={{ paddingTop: 2 }}>{children}</div>}
    </div>
  )
}

const rootStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 8,
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const contentStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
}

const scrollbarStyles = `
  .node-content::-webkit-scrollbar {
    width: 4px;
  }
  .node-content::-webkit-scrollbar-track {
    background: #000;
  }
  .node-content::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 2px;
  }
  .node-content::-webkit-scrollbar-thumb:hover {
    background: #666;
  }
`

function NodeWrapper({ children, def, selected, headerRight, footer, handles, style }: NodeWrapperProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [frozenHeight, setFrozenHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (rootRef.current && frozenHeight === null) {
      setFrozenHeight(rootRef.current.offsetHeight)
    }
  }, [frozenHeight])

  const dynamicRoot = frozenHeight
    ? { ...rootStyle, maxHeight: frozenHeight, height: frozenHeight, ...style }
    : { ...rootStyle, ...style }

  return (
    <div ref={rootRef} style={dynamicRoot}>
      <style>{scrollbarStyles}</style>
      {selected && <NodeResizer handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
      <div style={{ background: def.color, padding: '4px 8px', fontSize: 10, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '8px 8px 0 0', overflow: 'hidden', flexShrink: 0 }}>
        <span>{def.label}</span>
        {headerRight}
      </div>
      <div className="node-content" style={contentStyle}>
        {children}
      </div>
      {handles}
      {footer && (
        <div style={{ borderTop: '1px solid #2a2a2a', padding: '4px 8px', background: '#1a1a1a', flexShrink: 0 }}>
          {footer}
        </div>
      )}
    </div>
  )
}

export default NodeWrapper
