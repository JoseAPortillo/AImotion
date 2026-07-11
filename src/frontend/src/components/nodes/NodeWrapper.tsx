import { useState, useRef, useEffect, type ReactNode } from 'react'
import { NodeResizer, useNodeId, useStore } from '@xyflow/react'
import { useGraphStore } from '../../store/graph'

interface NodeWrapperProps {
  children: ReactNode
  def: { color: string; label: string }
  selected: boolean
  style?: React.CSSProperties
  headerLabel?: string
  headerRight?: ReactNode
  footer?: ReactNode
  handles?: ReactNode
  progressBar?: ReactNode
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

const menuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 4,
  background: '#2a2a2a',
  border: '2px solid #555',
  borderRadius: 6,
  minWidth: 120,
  zIndex: 100,
  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
  overflow: 'hidden',
}

const menuItemStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 11,
  cursor: 'pointer',
  color: '#ccc',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  borderBottom: '1px solid #333',
}

const COLLAPSED_H = 36

function NodeWrapper({ children, def, selected, headerLabel, headerRight, footer, handles, style: propStyle, progressBar }: NodeWrapperProps) {
  const nodeId = useNodeId()
  const node = useStore(s => (nodeId ? s.nodeLookup.get(nodeId) : undefined))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const toggleNodeCollapse = useGraphStore((s) => s.toggleNodeCollapse)
  const copySelectedNodes = useGraphStore((s) => s.copySelectedNodes)
  const selectNode = useGraphStore((s) => s.selectNode)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const nd = node?.data as Record<string, unknown> | undefined
  const collapsed = !!nd?.collapsed

  const w = (propStyle?.width as number) || node?.width || 260
  const h = collapsed ? COLLAPSED_H : ((propStyle?.height as number) || node?.height || 320)

  const containerStyle: React.CSSProperties = {
    ...rootStyle,
    width: w,
    height: h,
  }

  return (
    <div style={containerStyle}>
      <style>{scrollbarStyles}</style>
      {selected && !collapsed && <NodeResizer handleStyle={{ width: 8, height: 8, borderRadius: '50%', background: '#888', zIndex: 10 }} />}
      <div style={{ background: def.color, padding: '4px 8px', fontSize: 10, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '8px 8px 0 0', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
        <span>{headerLabel ?? def.label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {headerRight}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
              title="Node menu"
              style={{
                background: 'rgba(0,0,0,0.2)',
                border: 'none',
                borderRadius: 3,
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1,
                padding: '0 3px',
                cursor: 'pointer',
                opacity: 0.7,
              }}
            >
              ⋮
            </button>
            {menuOpen && (
              <div style={menuStyle}>
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleNodeCollapse(nodeId!)
                    setMenuOpen(false)
                  }}
                  style={menuItemStyle}
                >
                  {collapsed ? '⬜' : '⬛'} {collapsed ? 'Expand' : 'Collapse'}
                </div>
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    if (nodeId) selectNode(nodeId)
                    copySelectedNodes()
                    setMenuOpen(false)
                  }}
                  style={{ ...menuItemStyle, borderBottom: 'none' }}
                >
                  📋 Copy
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {!collapsed && (
        <div className="node-content" style={contentStyle}>
          {children}
        </div>
      )}
      {!collapsed && progressBar}
      {handles}
      {!collapsed && footer && (
        <div style={{ borderTop: '1px solid #2a2a2a', padding: '4px 8px', background: '#1a1a1a', flexShrink: 0 }}>
          {footer}
        </div>
      )}
    </div>
  )
}

export default NodeWrapper