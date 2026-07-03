import { useState, useEffect } from 'react'

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

export default function VramStatusBar() {
  const [data, setData] = useState<VramData | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchVram = () => {
      fetch('/hardware/vram')
        .then(r => r.json())
        .then(d => { if (!cancelled) setData(d) })
        .catch(() => {})
    }
    fetchVram()
    const iv = setInterval(fetchVram, 10000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const blocked = !data || !data.gpu_available
  const pct = data?.vram_percent ?? 0
  const used = data?.vram_used_gb ?? 0
  const total = data?.vram_total_gb ?? 0

  const stripeBg = (color: string) => `repeating-linear-gradient(
    -45deg,
    ${color} 0px,
    ${color} 3px,
    ${color}99 3px,
    ${color}99 6px
  )`

  let usedColor = '#5dade2'
  let freeColor = '#1a2a3e'
  if (blocked) {
    usedColor = '#444'
    freeColor = '#1a1a1a'
  } else if (data!.alert || pct > 85) {
    usedColor = '#e74c3c'
    freeColor = '#2e1a1a'
  } else if (pct > 65) {
    usedColor = '#f39c12'
    freeColor = '#2e261a'
  }

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
          background: freeColor,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: blocked ? 100 : `${Math.min(pct, 100)}%`,
            height: '100%',
            background: stripeBg(usedColor),
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
