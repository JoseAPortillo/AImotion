import { useState, useEffect, useCallback, useRef } from 'react'

interface ModelInfo {
  key: string
  name: string
  type: string
  pipeline: string
  source: string
  description: string
  cached: boolean
  size_gb: number | null
  loaded: boolean
}

interface HealthInfo {
  gpu_available: boolean
  gpu_name?: string
  vram_total_gb?: number
  vram_free_gb?: number
  current_model?: string | null
  current_v2v_model?: string | null
}

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 6,
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 8,
  minWidth: 360,
  maxWidth: 420,
  maxHeight: 420,
  overflow: 'auto',
  zIndex: 100,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  padding: 10,
}

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 6,
  marginTop: 10,
}

const pillStyle = (bg: string, color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 600,
  background: bg,
  color,
  marginLeft: 'auto',
})

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
}

export default function ModelManager({ backendOk }: { backendOk: boolean }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const fetchModels = useCallback(async () => {
    try {
      const [mRes, hRes] = await Promise.all([
        fetch('/models'),
        fetch('/models/status'),
      ])
      if (mRes.ok) {
        const data = await mRes.json()
        setModels(data.models || [])
      }
      if (hRes.ok) setHealth(await hRes.json())
    } catch {
      // backend offline
    }
  }, [])

  useEffect(() => {
    if (!open) return
    fetchModels()
    const interval = setInterval(fetchModels, 5000)
    return () => clearInterval(interval)
  }, [open, fetchModels])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleInstall = async (modelKey: string) => {
    setBusy(modelKey)
    try {
      await fetch(`/models/install/${modelKey}`, { method: 'POST' })
      await fetchModels()
    } catch {}
    setBusy(null)
  }

  const handleUnload = async () => {
    await fetch('/models/unload', { method: 'POST' })
    await fetchModels()
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 12,
          background: backendOk ? '#0a2e1a' : '#2e0a0a',
          color: backendOk ? '#4ade80' : '#f87171',
          border: `1px solid ${backendOk ? '#166534' : '#7f1d1d'}`,
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 10 }}>{backendOk ? '●' : '○'}</span>
        <span>Models</span>
        {health?.vram_free_gb != null && (
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            {health.vram_free_gb}GB free
          </span>
        )}
      </div>
      {open && (
        <div style={popoverStyle}>
          {!backendOk && (
            <div style={{ padding: 10, textAlign: 'center', color: '#f87171', fontSize: 12 }}>
              Backend offline
            </div>
          )}
          {backendOk && (
            <>
              {health && (
                <div style={{ fontSize: 11, color: '#999', padding: '0 8px 4px' }}>
                  {health.gpu_name && <span>{health.gpu_name} — </span>}
                  {health.vram_free_gb != null && health.vram_total_gb != null && (
                    <span>{health.vram_free_gb}GB / {health.vram_total_gb}GB free</span>
                  )}
                  {health.current_model && (
                    <span style={{ display: 'block', marginTop: 2, color: '#888' }}>
                      T2V: {health.current_model || 'none'}
                      {health.current_v2v_model && ` | V2V: ${health.current_v2v_model}`}
                    </span>
                  )}
                </div>
              )}
              <div style={sectionTitle}>Local Models (Diffusers)</div>
              {models.filter(m => m.type === 'local' && m.pipeline !== 'Custom').map(m => (
                <div key={m.key} style={rowStyle}>
                  <span style={{ fontWeight: 600, minWidth: 110, fontSize: 12 }}>{m.name}</span>
                  <span style={{ fontSize: 10, color: '#888' }}>
                    {m.size_gb ? `${m.size_gb}GB` : ''}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                    {m.loaded && <span style={pillStyle('#0a2e1a', '#4ade80')}>Loaded</span>}
                    {m.cached && !m.loaded && <span style={pillStyle('#1a3a1a', '#66bb6a')}>Cached</span>}
                    {!m.cached && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleInstall(m.key) }}
                        disabled={busy === m.key}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: '1px solid #555',
                          background: 'transparent',
                          color: busy === m.key ? '#888' : '#4ade80',
                          fontSize: 10,
                          cursor: busy === m.key ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {busy === m.key ? '...' : 'Install'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div style={sectionTitle}>Coming Soon</div>
              {models.filter(m => m.pipeline === 'Custom').map(m => (
                <div key={m.key} style={{ ...rowStyle, opacity: 0.5 }}>
                  <span style={{ fontWeight: 600, minWidth: 110, fontSize: 12 }}>{m.name}</span>
                  <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>Not integrated</span>
                </div>
              ))}
              <div style={sectionTitle}>API Models</div>
              {models.filter(m => m.type === 'api').map(m => (
                <div key={m.key} style={{ ...rowStyle, opacity: 0.6 }}>
                  <span style={{ fontWeight: 600, minWidth: 110, fontSize: 12 }}>{m.name}</span>
                  <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>{m.source}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, borderTop: '1px solid #2a2a2a', paddingTop: 6 }}>
                <button
                  onClick={handleUnload}
                  style={{
                    width: '100%',
                    padding: '5px 0',
                    borderRadius: 4,
                    border: '1px solid #5a1a1a',
                    background: 'transparent',
                    color: '#f87171',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Unload all from VRAM
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
