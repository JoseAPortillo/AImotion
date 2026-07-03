import { useState, useRef, useEffect } from 'react'

interface ModelEntry {
  key: string
  name: string
  pipeline_class?: string
  accepts?: Record<string, boolean>
  is_video?: boolean
}

interface ModelSelectProps {
  value: string
  models: ModelEntry[]
  onChange: (key: string) => void
  placeholder?: string
  disabled?: boolean
}

function getModality(cfg: ModelEntry | undefined): string {
  if (!cfg) return ''
  const isVid = cfg.is_video ?? cfg.pipeline_class?.includes('Video') ?? false
  const a = cfg.accepts ?? {}
  if (a.image) return isVid ? 'Image-to-Video' : 'Image-to-Image'
  if (a.video) return 'Video-to-Video'
  return isVid ? 'Text-to-Video' : 'Text-to-Image'
}

export default function ModelSelect({ value, models, onChange, placeholder, disabled }: ModelSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = models.find(m => m.key === value)
  const displayText = selected ? selected.name : (placeholder || 'Select model')

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
        onClick={() => { if (!disabled) setOpen(!open) }}
        style={{
          background: '#0f0f0f',
          border: '1px solid #333',
          borderRadius: 4,
          color: selected ? '#ccc' : '#666',
          padding: '2px 4px',
          fontSize: 10,
          outline: 'none',
          width: '100%',
          cursor: disabled ? 'not-allowed' : 'pointer',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          boxSizing: 'border-box',
        }}
      >
        {displayText}
      </div>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 4,
            maxHeight: 200,
            overflowY: 'auto',
            marginTop: 2,
            boxShadow: '0 4px 12px rgba(0,0,0,.5)',
          }}
        >
          {models.length === 0 && (
            <div style={{ padding: '4px 6px', color: '#666', fontSize: 10 }}>No models</div>
          )}
          {models.map(m => {
            const mm = getModality(m)
            return (
              <div
                key={m.key}
                role="option"
                aria-selected={m.key === value}
                onClick={() => { onChange(m.key); setOpen(false) }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '4px 6px',
                  fontSize: 10,
                  cursor: 'pointer',
                  background: m.key === value ? '#2a2a2a' : 'transparent',
                  color: '#ccc',
                  gap: 8,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2a2a2a' }}
                onMouseLeave={e => { if (m.key !== value) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                {mm && <span style={{ color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>{mm}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
