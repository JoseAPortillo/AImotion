import { useState, useEffect, useRef } from 'react'

interface VramData {
  gpu_available: boolean
  gpu_name?: string | null
  vram_total_gb?: number | null
  vram_free_gb?: number | null
  vram_used_gb?: number | null
  vram_percent?: number | null
  alert: boolean
  message?: string | null
}

const STARTUP_DELAY = 3000

export default function VramStatusBar() {
  const [data, setData] = useState<VramData | null>(null)
  const started = useRef(false)

  useEffect(() => {
    let cancelled = false
    const fetchVram = () => {
      fetch('/hardware/vram')
        .then(r => r.json())
        .then(d => { if (!cancelled) setData(d) })
        .catch(() => {})
    }
    const timer = setTimeout(() => {
      if (!cancelled) {
        started.current = true
        fetchVram()
      }
    }, STARTUP_DELAY)
    const iv = setInterval(fetchVram, 10000)
    return () => { cancelled = true; clearTimeout(timer); clearInterval(iv) }
  }, [])

  const blocked = !data || !data.gpu_available
  const pct = data?.vram_percent ?? 0
  const used = data?.vram_used_gb ?? 0
  const total = data?.vram_total_gb ?? 0

  const color = blocked ? '#555' : '#5dade2'
  const freeBg = blocked ? '#1a1a1a' : '#142438'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: '#888',
        background: '#111',
        padding: '3px 10px',
        border: blocked ? '1px solid #2a2a2a' : '1px solid #333',
        whiteSpace: 'nowrap',
        opacity: blocked ? 0.6 : 1,
      }}
      title={blocked ? (!data ? 'Checking GPU...' : 'No GPU available') : (data!.message ?? `${data!.gpu_name ?? 'GPU'}`)}
    >
      <span style={{ fontWeight: 600, color: blocked ? '#555' : '#aaa' }}>VRAM</span>
      <div
        style={{
          width: 120,
          height: 12,
          background: freeBg,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: blocked ? 100 : `${Math.min(pct, 100)}%`,
            height: '100%',
            backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1px)`,
            backgroundSize: '4px 4px',
            transition: 'width .3s',
          }}
        />
      </div>
      <span style={{ color: blocked ? '#555' : '#888' }}>
        {blocked ? (!data ? 'checking...' : 'blocked') : `${used.toFixed(1)} / ${total.toFixed(0)} GB`}
      </span>
    </div>
  )
}
