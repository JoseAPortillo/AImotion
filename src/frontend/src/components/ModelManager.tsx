import { useState, useEffect, useCallback, useRef } from 'react'

interface ModelEntry {
  key: string
  name: string
  hf_name: string | null
  type: string
  size_gb: number | null
  cached: boolean
  loaded: boolean
  schedulers: string[]
  default_scheduler: string | null
  alias?: string
  pipeline_class?: string
}

interface HealthInfo {
  gpu_available: boolean
  gpu_name?: string
  vram_total_gb?: number
  vram_free_gb?: number
  current_model?: string | null
  current_v2v_model?: string | null
}

interface InstallProgress {
  status: string
  progress_pct: number
  current_file: string
  total_files: number
  downloaded_files: number
  error_msg: string
}

const popover: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 6,
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 8,
  minWidth: 420,
  maxWidth: 460,
  maxHeight: 480,
  overflow: 'auto',
  zIndex: 100,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  padding: 12,
}

const sectionTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 6,
  marginTop: 12,
}

type Status = 'idle' | 'checking' | 'installing' | 'cancelling' | 'error' | 'done'

export default function ModelManager({ backendOk }: { backendOk: boolean }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [hfInput, setHfInput] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [editingAlias, setEditingAlias] = useState<string | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const fetchAll = useCallback(async () => {
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
    } catch { /* offline */ }
  }, [])

  useEffect(() => {
    if (!open) return
    fetchAll()
    const iv = setInterval(fetchAll, 5000)
    return () => clearInterval(iv)
  }, [open, fetchAll])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const startPolling = useCallback((tid: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) return
      try {
        const res = await fetch(`/models/install/${tid}/progress`)
        if (!res.ok) { stopPolling(); return }
        const p: InstallProgress = await res.json()
        if (!mountedRef.current) return
        setProgress(p)

        if (p.status === 'done') {
          stopPolling()
          setStatus('done')
          setTaskId(null)
          const d = p as any
          const ptype = d.pipeline_class?.replace('Pipeline', '') || ''
          setStatusMsg(`Installed${ptype ? ` (${ptype})` : ''}`)
          setHfInput('')
          await fetchAll()
          return
        }
        if (p.status === 'error') {
          stopPolling()
          setStatus('error')
          setTaskId(null)
          setStatusMsg(p.error_msg || 'Install failed')
          return
        }
        if (p.status === 'cancelled') {
          stopPolling()
          setStatus('idle')
          setTaskId(null)
          setProgress(null)
          setStatusMsg('')
          return
        }
        setStatus(p.status === 'discovering' ? 'checking' : 'installing')
        const fname = p.current_file ? ` (${p.current_file})` : ''
        setStatusMsg(`${p.status} ${p.progress_pct.toFixed(0)}%${fname}`)
      } catch { stopPolling() }
    }, 400)
  }, [stopPolling, fetchAll])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const handleInstall = async () => {
    const name = hfInput.trim()
    if (!name) return
    setStatus('checking')
    setStatusMsg(`Starting install for ${name}...`)
    setProgress(null)
    try {
      const res = await fetch('/models/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hf_name: name, alias: name.split('/').pop() || name }),
      })
      const text = await res.text()
      let data: any = {}
      try { data = JSON.parse(text) } catch {}
      if (!res.ok) {
        setStatus('error')
        setStatusMsg(data.detail || text || `HTTP ${res.status}`)
        return
      }
      if (data.status === 'already_installed') {
        setStatus('done')
        setStatusMsg('Already installed')
        return
      }
      if (data.status === 'already_in_progress') {
        setStatus('installing')
        setStatusMsg('Already in progress')
        setTaskId(data.task_id)
        startPolling(data.task_id)
        return
      }
      setTaskId(data.task_id)
      startPolling(data.task_id)
    } catch (e: any) {
      setStatus('error')
      setStatusMsg(e.message || 'Connection failed')
    }
  }

  const handleCancel = async () => {
    if (!taskId) return
    setStatus('cancelling')
    setStatusMsg('Cancelling...')
    try {
      await fetch(`/models/install/${taskId}`, { method: 'DELETE' })
    } catch { /* ignore */ }
  }

  const handleUninstall = async (modelKey: string) => {
    try {
      await fetch(`/models/${modelKey}`, { method: 'DELETE' })
      await fetchAll()
    } catch { /* ignore */ }
  }

  const handleSaveAlias = async (modelKey: string) => {
    if (!aliasInput.trim()) return
    try {
      await fetch(`/models/${modelKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: aliasInput.trim() }),
      })
      setEditingAlias(null)
      await fetchAll()
    } catch { /* ignore */ }
  }

  const startAliasEdit = (entry: ModelEntry) => {
    setEditingAlias(entry.key)
    setAliasInput(entry.alias || entry.name)
  }

  const installed = models.filter(m => m.type === 'installed')
  const builtin = models.filter(m => m.type === 'builtin')
  const other = models.filter(m => m.type === 'future' || m.type === 'api')

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
          <span style={{ fontSize: 10, opacity: 0.7 }}>{health.vram_free_gb}GB free</span>
        )}
        {installed.length > 0 && (
          <span style={{ fontSize: 10, opacity: 0.6 }}>({installed.length} installed)</span>
        )}
      </div>
      {open && (
        <div style={popover}>
          {!backendOk ? (
            <div style={{ padding: 10, textAlign: 'center', color: '#f87171', fontSize: 12 }}>Backend offline</div>
          ) : (
            <>
              {/* VRAM and loaded model info */}
              {health && (
                <div style={{ fontSize: 11, color: '#999', padding: '0 0 6px', borderBottom: '1px solid #2a2a2a', marginBottom: 8 }}>
                  {health.gpu_name && <span>{health.gpu_name} — </span>}
                  {health.vram_free_gb != null && health.vram_total_gb != null && (
                    <span>{health.vram_free_gb}GB / {health.vram_total_gb}GB free</span>
                  )}
                  {health.current_model && (
                    <span style={{ display: 'block', marginTop: 2, color: '#888' }}>
                      T2V: {health.current_model}{health.current_v2v_model ? ` | V2V: ${health.current_v2v_model}` : ''}
                    </span>
                  )}
                </div>
              )}

              {/* Install form */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input
                  value={hfInput}
                  onChange={e => setHfInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleInstall()}
                  placeholder="HF model name (e.g. THUDM/CogVideoX-2b)"
                  style={{
                    flex: 1,
                    background: '#0f0f0f',
                    border: '1px solid #333',
                    borderRadius: 4,
                    color: '#ccc',
                    padding: '6px 8px',
                    fontSize: 11,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleInstall}
                  disabled={status === 'checking' || status === 'installing' || status === 'cancelling' || !hfInput.trim()}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 4,
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: status === 'checking' || status === 'installing' || status === 'cancelling' ? 'not-allowed' : 'pointer',
                    background: status === 'checking' || status === 'installing' || status === 'cancelling' ? '#333' : '#2563eb',
                    color: status === 'checking' || status === 'installing' || status === 'cancelling' ? '#888' : '#fff',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {status === 'checking' ? 'Checking...' : status === 'installing' || status === 'cancelling' ? 'Installing...' : 'Install'}
                </button>
              </div>

              {/* Status message */}
              {status !== 'idle' && (
                <div style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 4,
                  marginBottom: 4,
                  background: status === 'error' ? '#2e0a0a' : status === 'done' ? '#0a2e1a' : '#1a1a2e',
                  color: status === 'error' ? '#f87171' : status === 'done' ? '#4ade80' : '#8888ff',
                }}>
                  {statusMsg}
                  {(status === 'error' || status === 'done') && (
                    <span onClick={() => { setStatus('idle'); setProgress(null) }} style={{ marginLeft: 8, cursor: 'pointer', opacity: 0.6 }}>✕</span>
                  )}
                </div>
              )}

              {/* Progress bar + cancel */}
              {(status === 'checking' || status === 'installing' || status === 'cancelling') && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <div style={{
                    flex: 1,
                    height: 8,
                    borderRadius: 4,
                    background: '#2a2a2a',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.min(progress?.progress_pct ?? 0, 100)}%`,
                      height: '100%',
                      borderRadius: 4,
                      background: status === 'cancelling' ? '#888' : '#2563eb',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: '#999', minWidth: 32, textAlign: 'right' }}>
                    {progress ? `${progress.progress_pct.toFixed(0)}%` : '...'}
                  </span>
                  {status !== 'cancelling' && (
                    <button
                      onClick={handleCancel}
                      title="Cancel install"
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: '1px solid #5a1a1a',
                        background: 'transparent',
                        color: '#f87171',
                        fontSize: 10,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}

              {/* Installed models */}
              {installed.length > 0 && (
                <>
                  <div style={sectionTitle}>Installed Models</div>
                  {installed.map(m => (
                    <div key={m.key} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 8px', borderRadius: 6, fontSize: 12,
                      background: m.loaded ? '#0a1a0a' : 'transparent',
                    }}>
                      {editingAlias === m.key ? (
                        <input
                          autoFocus
                          value={aliasInput}
                          onChange={e => setAliasInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveAlias(m.key)
                            if (e.key === 'Escape') setEditingAlias(null)
                          }}
                          onBlur={() => handleSaveAlias(m.key)}
                          style={{
                            flex: 1, background: '#0f0f0f', border: '1px solid #555',
                            borderRadius: 4, color: '#ccc', padding: '2px 6px',
                            fontSize: 11, outline: 'none',
                          }}
                        />
                      ) : (
                        <span
                          style={{ fontWeight: 600, cursor: 'pointer', flex: 1 }}
                          onClick={() => startAliasEdit(m)}
                          title="Click to rename"
                        >
                          {m.alias || m.name}
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: '#666' }}>
                        {m.schedulers.length} sched{m.schedulers.length !== 1 ? 's' : ''}
                      </span>
                      {m.loaded && <span style={{ fontSize: 10, color: '#4ade80' }}>Loaded</span>}
                      <button
                        onClick={() => handleUninstall(m.key)}
                        style={{
                          padding: '2px 6px', borderRadius: 4, border: '1px solid #5a1a1a',
                          background: 'transparent', color: '#f87171', fontSize: 10,
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}
                      >
                        Uninstall
                      </button>
                    </div>
                  ))}
                </>
              )}

              {/* Built-in cached models */}
              <div style={sectionTitle}>Built-in Models</div>
              {builtin.filter(m => m.cached).map(m => (
                <div key={m.key} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 8px', borderRadius: 6, fontSize: 12,
                  background: m.loaded ? '#0a1a0a' : 'transparent',
                }}>
                  <span style={{ fontWeight: 600, minWidth: 110 }}>{m.name}</span>
                  {m.schedulers.length > 0 && (
                    <span style={{ fontSize: 10, color: '#666' }}>{m.schedulers.join(', ')}</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                    {m.loaded && <span style={{ fontSize: 10, color: '#4ade80' }}>Loaded</span>}
                  </div>
                </div>
              ))}
              {builtin.filter(m => !m.cached).length > 0 && (
                <div style={{ fontSize: 11, color: '#666', padding: '4px 8px' }}>
                  {builtin.filter(m => !m.cached).map(m => m.name).join(', ')} — not cached
                </div>
              )}

              {/* Other models */}
              {other.length > 0 && (
                <>
                  <div style={sectionTitle}>Coming Soon / API</div>
                  {other.map(m => (
                    <div key={m.key} style={{ display: 'flex', gap: 6, padding: '4px 8px', fontSize: 12, opacity: 0.5 }}>
                      <span style={{ fontWeight: 600 }}>{m.name}</span>
                      <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>
                        {m.type === 'api' ? 'API' : 'Pending integration'}
                      </span>
                    </div>
                  ))}
                </>
              )}

              {/* Actions */}
              <div style={{ marginTop: 8, borderTop: '1px solid #2a2a2a', paddingTop: 6, display: 'flex', gap: 6 }}>
                <button onClick={() => { fetchAll() }} style={{
                  flex: 1, padding: '5px 0', borderRadius: 4, border: '1px solid #333',
                  background: 'transparent', color: '#999', fontSize: 11, cursor: 'pointer',
                }}>
                  Refresh
                </button>
                <button onClick={async () => { await fetch('/models/unload', { method: 'POST' }); await fetchAll() }} style={{
                  flex: 1, padding: '5px 0', borderRadius: 4, border: '1px solid #5a1a1a',
                  background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer',
                }}>
                  Unload VRAM
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
