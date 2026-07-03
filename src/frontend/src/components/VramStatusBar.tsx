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

  if (!data || !data.gpu_available) return null

  const pct = data.vram_percent ?? 0
  const used = data.vram_used_gb ?? 0
  const total = data.vram_total_gb ?? 0
  const free = data.vram_free_gb ?? 0

  let barColor = '#4ade80'
  if (data.alert || pct > 85) barColor = '#ef4444'
  else if (pct > 65) barColor = '#facc15'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: '#888',
        background: '#111',
        borderRadius: 4,
        padding: '3px 10px',
        border: '1px solid #333',
        whiteSpace: 'nowrap',
      }}
      title={data.message ?? `${data.gpu_name ?? 'GPU'}`}
    >
      <span style={{ fontWeight: 600, color: '#aaa' }}>VRAM</span>
      <div
        style={{
          width: 75,
          height: 8,
          background: '#222',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(pct, 100)}%`,
            height: '100%',
            background: barColor,
            borderRadius: 3,
            transition: 'width .3s, background .3s',
          }}
        />
      </div>
      <span style={{ color: pct > 65 ? barColor : '#888' }}>
        {used.toFixed(1)} / {total.toFixed(0)} GB
      </span>
    </div>
  )
}
