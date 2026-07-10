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
  cache_dir?: string
}

interface InstallProgress {
  status: string
  progress_pct: number
  current_file: string
  total_files: number
  downloaded_files: number
  error_msg: string
  requirements?: Array<{
    type: string
    package?: string
    name?: string
    reason: string
    optional: boolean
  }>
  waiting_for_confirmation?: boolean
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

type Status = 'idle' | 'checking' | 'confirming' | 'installing' | 'cancelling' | 'error' | 'done'

export default function ModelManager({ backendOk }: { backendOk: boolean }) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [hfInput, setHfInput] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const [editingAlias, setEditingAlias] = useState<string | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [selectedInstalledKey, setSelectedInstalledKey] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [installingHfName, setInstallingHfName] = useState<string | null>(null)
  const [progress, setProgress] = useState<InstallProgress | null>(null)
  const [modelTab, setModelTab] = useState<'installed' | 'other'>('installed')
  const [customCacheDir, setCustomCacheDir] = useState('')
  const [creds, setCreds] = useState<Record<string, boolean>>({})
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string>>({})
  const [availableServices, setAvailableServices] = useState<string[]>([])
  const [editingCred, setEditingCred] = useState<string | null>(null)
  const [credInput, setCredInput] = useState('')
  const [savingCred, setSavingCred] = useState<string | null>(null)
  const [renamingCred, setRenamingCred] = useState<string | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [pendingServices, setPendingServices] = useState<string[]>([])
  const [suppressedServices, setSuppressedServices] = useState<string[]>([])
  const [addingCustom, setAddingCustom] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const fetchAll = useCallback(async () => {
    try {
      const [mRes, hRes, cRes, pRes] = await Promise.all([
        fetch('/models'),
        fetch('/models/status'),
        fetch('/credentials'),
        fetch('/credentials/providers'),
      ])
      if (mRes.ok) {
        const data = await mRes.json()
        setModels(data.models || [])
      }
      if (hRes.ok) setHealth(await hRes.json())
      if (cRes.ok) {
        const cd = await cRes.json()
        const map: Record<string, boolean> = {}
        const mk: Record<string, string> = {}
        for (const s of (cd.services || [])) {
          map[s] = true
          mk[s] = (cd.masked || {})[s] || ''
        }
        setCreds(map)
        setMaskedKeys(mk)
        setPendingServices(prev => prev.filter(s => !map[s]))
      }
      if (pRes.ok) {
        const pd = await pRes.json()
        setAvailableServices(pd.providers || [])
      }
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

  const startPolling = useCallback((tid: string, hfName: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      if (!mountedRef.current) return
      try {
        const res = await fetch(`/models/install/${tid}/progress`)
        if (!res.ok) {
          stopPolling()
          if (!mountedRef.current) return
          const fresh = await fetch('/models').then(r => r.ok ? r.json() : null).catch(() => null)
          const installed = fresh?.models?.filter((m: any) => m.type === 'installed') ?? []
          const found = installed.find((m: any) => m.hf_name === hfName || (m.alias || m.name) === hfName.split('/').pop())
          if (found) {
            setStatus('done')
            setTaskId(null)
            setStatusMsg('Installed (server restarted)')
            setHfInput('')
            await fetchAll()
          } else {
            setStatus('error')
            setTaskId(null)
            setStatusMsg(`Server restarted during install — progress lost`)
          }
          return
        }
        const p: InstallProgress = await res.json()
        if (!mountedRef.current) return
        setProgress(p)

        if (p.status === 'done') {
          stopPolling()
          setStatus('done')
          setTaskId(null)
          setInstallingHfName(null)
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
          setInstallingHfName(null)
          setStatusMsg(p.error_msg || 'Install failed')
          return
        }
        if (p.status === 'cancelled') {
          stopPolling()
          setStatus('idle')
          setTaskId(null)
          setInstallingHfName(null)
          setProgress(null)
          setStatusMsg('')
          return
        }
        if (p.waiting_for_confirmation) {
          setStatus('confirming')
          setStatusMsg('Waiting for confirmation...')
          return
        }
        setStatus(p.status === 'discovering' ? 'checking' : 'installing')
        const fname = p.current_file ? ` (${p.current_file})` : ''
        setStatusMsg(`${p.status} ${p.progress_pct.toFixed(0)}%${fname}`)
      } catch {
        stopPolling()
        if (!mountedRef.current) return
        setStatus('error')
        setTaskId(null)
        setInstallingHfName(null)
        setStatusMsg('Connection lost during install')
      }
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
    setInstallingHfName(name)
    try {
      const res = await fetch('/models/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hf_name: name,
          alias: name.split('/').pop() || name,
          cache_dir: customCacheDir.trim()
        }),
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
        setInstallingHfName(name)
        startPolling(data.task_id, name)
        return
      }
      setTaskId(data.task_id)
      setInstallingHfName(name)
      startPolling(data.task_id, name)
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

  const handleConfirm = async () => {
    if (!taskId) return
    setStatus('installing')
    setStatusMsg('Installing requirements...')
    try {
      const res = await fetch(`/models/install/${taskId}/confirm`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        setStatus('error')
        setStatusMsg(err.detail || 'Failed to confirm installation')
        return
      }
      setStatusMsg('Installing requirements and downloading model...')
    } catch (e: any) {
      setStatus('error')
      setStatusMsg(e.message || 'Failed to confirm installation')
    }
  }

  const handleUninstall = async (modelKey: string) => {
    try {
      await fetch(`/models/${modelKey}`, { method: 'DELETE' })
      await fetchAll()
    } catch { /* ignore */ }
  }

  const handleCredSave = async (service: string) => {
    if (!credInput.trim()) return
    setSavingCred(service)
    try {
      await fetch(`/credentials/${service}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: credInput.trim() }),
      })
      setEditingCred(null)
      setCredInput('')
      await fetchAll()
    } catch { /* ignore */ }
    setSavingCred(null)
  }

  const handleCredDelete = async (service: string) => {
    await fetch(`/credentials/${service}`, { method: 'DELETE' })
    await fetchAll()
  }

  const handleCredRename = async (oldName: string) => {
    const newName = renameInput.trim().toLowerCase()
    if (!newName || newName === oldName) return
    setSavingCred(oldName)
    try {
      await fetch(`/credentials/${oldName}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: newName }),
      })
      setRenamingCred(null)
      setRenameInput('')
      if (availableServices.includes(oldName)) {
        setSuppressedServices(prev => prev.includes(oldName) ? prev : [...prev, oldName])
      }
      await fetchAll()
    } catch { /* ignore */ }
    setSavingCred(null)
  }

  const handleAddCustom = () => {
    const name = customInput.trim().toLowerCase()
    if (!name) return
    setEditingCred(name)
    setCredInput('')
    setCustomInput('')
    setPendingServices(prev => prev.includes(name) ? prev : [...prev, name])
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
  const other = models.filter(m => m.type === 'future' || m.type === 'api' || m.type === 'installable')

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
                <input
                  value={customCacheDir}
                  onChange={e => setCustomCacheDir(e.target.value)}
                  placeholder={health?.cache_dir || 'Custom cache dir (optional)'}
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

              {/* Requirements confirmation */}
              {status === 'confirming' && progress?.requirements && (
                <div style={{
                  background: '#1a1a2e',
                  border: '1px solid #333',
                  borderRadius: 4,
                  padding: 8,
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#8888ff', marginBottom: 6 }}>
                    This model requires additional dependencies:
                  </div>
                  {progress.requirements.map((req, i) => (
                    <div key={i} style={{ fontSize: 10, color: '#ccc', marginBottom: 4, paddingLeft: 8 }}>
                      <div style={{ fontWeight: 600 }}>
                        {req.type === 'python_package' ? `📦 ${req.package}` : `🔑 ${req.name}`}
                        {req.optional && <span style={{ color: '#888', fontWeight: 400 }}> (optional)</span>}
                      </div>
                      <div style={{ color: '#888' }}>{req.reason}</div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      onClick={handleConfirm}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: 'none',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: '#4ade80',
                        color: '#0f0f0f',
                      }}
                    >
                      Confirm & Install
                    </button>
                    <button
                      onClick={handleCancel}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        borderRadius: 4,
                        border: '1px solid #5a1a1a',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: 'transparent',
                        color: '#f87171',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
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

              {/* Tab bar */}
              <div style={{
                display: 'flex', gap: 2, marginBottom: 6,
                borderBottom: '1px solid #2a2a2a', paddingBottom: 2,
              }}>
                {(['installed', 'other'] as const).map(t => {
                  const count = t === 'installed' ? installed.length : other.length
                  return (
                    <div
                      key={t}
                      onClick={() => setModelTab(t)}
                      style={{
                        padding: '4px 12px',
                        borderRadius: '4px 4px 0 0',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: modelTab === t ? '#2563eb' : 'transparent',
                        color: modelTab === t ? '#fff' : '#888',
                        textTransform: 'capitalize',
                      }}
                    >
                      {t === 'other' ? 'API' : 'Installed'}
                      {count > 0 && (
                        <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>({count})</span>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Tab content */}
              {modelTab === 'installed' && (
                installed.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#666', padding: '8px', textAlign: 'center' }}>
                    No installed models
                  </div>
                ) : (
                  <>
                    <div style={{
                      maxHeight: 170,
                      overflowY: 'auto',
                      border: '1px solid #333',
                      borderRadius: 4,
                      marginBottom: 6,
                    }}>
                      {installed.map(m => {
                        const isSel = selectedInstalledKey === m.key
                        return (
                          <div
                            key={m.key}
                            onClick={() => {
                              setSelectedInstalledKey(isSel ? null : m.key)
                              setEditingAlias(null)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '5px 8px',
                              fontSize: 12,
                              cursor: 'pointer',
                              background: m.loaded ? '#0a2e1a' : (isSel ? '#1a1a2e' : 'transparent'),
                              color: m.loaded ? '#4ade80' : (isSel ? '#8888ff' : '#ccc'),
                              borderBottom: '1px solid #222',
                            }}
                          >
                            <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.alias || m.name}
                            </span>
                            <span style={{ fontSize: 10, color: '#666', whiteSpace: 'nowrap' }}>
                              {m.schedulers.length} sched{m.schedulers.length !== 1 ? 's' : ''}
                            </span>
                            {m.loaded && <span style={{ fontSize: 10, color: '#4ade80' }}>●</span>}
                            <button
                              onClick={e => { e.stopPropagation(); handleUninstall(m.key) }}
                              style={{
                                padding: '2px 6px', borderRadius: 4, border: '1px solid #5a1a1a',
                                background: 'transparent', color: '#f87171', fontSize: 10,
                                cursor: 'pointer',
                              }}
                            >
                              Uninstall
                            </button>
                          </div>
                        )
                      })}
                    </div>

                    {(() => {
                      const sel = selectedInstalledKey
                        ? installed.find(m => m.key === selectedInstalledKey)
                        : null
                      if (!sel) return null
                      return (
                        <div style={{
                          fontSize: 11, color: '#999',
                          padding: '6px 8px', borderRadius: 4,
                          background: '#0f0f0f', marginBottom: 6,
                        }}>
                          {editingAlias === sel.key ? (
                            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                              <input
                                autoFocus
                                value={aliasInput}
                                onChange={e => setAliasInput(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') handleSaveAlias(sel.key)
                                  if (e.key === 'Escape') setEditingAlias(null)
                                }}
                                onBlur={() => handleSaveAlias(sel.key)}
                                style={{
                                  flex: 1, background: '#1a1a1a', border: '1px solid #555',
                                  borderRadius: 4, color: '#ccc', padding: '2px 6px',
                                  fontSize: 11, outline: 'none',
                                }}
                              />
                              <button onClick={() => setEditingAlias(null)}
                                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 11 }}>
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                              <span style={{ fontWeight: 600, color: '#eee' }}>
                                {sel.alias || sel.name}
                              </span>
                              <span onClick={() => startAliasEdit(sel)}
                                style={{ cursor: 'pointer', color: '#666', fontSize: 10 }}>
                                rename
                              </span>
                              {sel.loaded && <span style={{ fontSize: 10, color: '#4ade80' }}>Loaded</span>}
                            </div>
                          )}
                          <div style={{ fontSize: 10, lineHeight: 1.6 }}>
                            {sel.schedulers.length > 0 && (
                              <span>{sel.schedulers.length} scheduler{sel.schedulers.length !== 1 ? 's' : ''}: {sel.schedulers.join(', ')}</span>
                            )}
                            {sel.pipeline_class && (
                              <span style={{ display: 'block', opacity: 0.7 }}>
                                {sel.pipeline_class}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )
              )}

              {modelTab === 'other' && (
                (() => {
                  const visibleKnown = availableServices.filter(s => !suppressedServices.includes(s))
                  const extraServices = Object.keys(creds).filter(s => !visibleKnown.includes(s) && !pendingServices.includes(s))
                  const allServices = [...visibleKnown, ...extraServices, ...pendingServices]

                  return (
                    <div>
                      <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 6 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead>
                            <tr style={{ color: '#888', borderBottom: '1px solid #333' }}>
                              <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 500 }}>Provider</th>
                              <th style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 500 }}>API Key</th>
                              <th style={{ padding: '3px 6px', fontWeight: 500 }} />
                            </tr>
                          </thead>
                          <tbody>
                            {allServices.map(service => {
                              const configured = creds[service] ?? false
                              const renaming = renamingCred === service
                              return (
                                <tr key={service} style={{ borderBottom: '1px solid #222' }}>
                                  <td style={{ padding: '3px 6px', verticalAlign: 'middle' }}>
                                    {renaming ? (
                                      <div style={{ display: 'flex', gap: 3 }}>
                                        <input
                                          autoFocus
                                          value={renameInput}
                                          onChange={e => setRenameInput(e.target.value)}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') handleCredRename(service)
                                            if (e.key === 'Escape') { setRenamingCred(null); setRenameInput('') }
                                          }}
                                          style={{
                                            width: 80, background: '#0f0f0f', border: '1px solid #555',
                                            borderRadius: 3, padding: '1px 4px', fontSize: 11,
                                            color: '#ccc', outline: 'none',
                                          }}
                                          placeholder="New name..."
                                        />
                                        <button onClick={() => handleCredRename(service)} disabled={savingCred === service}
                                          style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #444', cursor: 'pointer', background: '#2563eb', color: '#fff', fontSize: 9, lineHeight: 1.2 }}>
                                          Save
                                        </button>
                                        <button onClick={() => { setRenamingCred(null); setRenameInput('') }}
                                          style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #444', cursor: 'pointer', background: '#111', color: '#ccc', fontSize: 9, lineHeight: 1.2 }}>
                                          ✕
                                        </button>
                                      </div>
                                    ) : (
                                      <span
                                        onClick={() => { setRenamingCred(service); setRenameInput(service) }}
                                        title="Click to rename"
                                        style={{ textTransform: 'capitalize', color: '#ccc', cursor: 'pointer', borderBottom: '1px dotted #555' }}
                                      >
                                        {service}
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: '3px 6px', verticalAlign: 'middle', color: configured ? '#4ade80' : '#555', fontFamily: 'monospace', fontSize: 10 }}>
                                    {configured ? maskedKeys[service] || '—' : '—'}
                                  </td>
                                  <td style={{ padding: '3px 6px', verticalAlign: 'middle', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    {editingCred === service ? (
                                      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                                        <input
                                          autoFocus
                                          type="password"
                                          value={credInput}
                                          onChange={e => setCredInput(e.target.value)}
                                          onKeyDown={e => {
                                            if (e.key === 'Enter') handleCredSave(service)
                                            if (e.key === 'Escape') { setEditingCred(null); setCredInput('') }
                                          }}
                                          style={{
                                            width: 110, background: '#0f0f0f', border: '1px solid #555',
                                            borderRadius: 3, padding: '1px 4px', fontSize: 11,
                                            color: '#ccc', outline: 'none',
                                          }}
                                          placeholder="Paste API key..."
                                        />
                                        <button onClick={() => handleCredSave(service)} disabled={savingCred === service}
                                          style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #444', cursor: 'pointer', background: '#4ade80', color: '#0f0f0f', fontSize: 9, lineHeight: 1.2 }}>
                                          {savingCred === service ? '...' : 'Save'}
                                        </button>
                                        <button onClick={() => { setEditingCred(null); setCredInput('') }}
                                          style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #444', cursor: 'pointer', background: '#111', color: '#ccc', fontSize: 9, lineHeight: 1.2 }}>
                                          ✕
                                        </button>
                                      </div>
                                    ) : (
                                      <div style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}>
                                        <button onClick={() => { setEditingCred(service); setCredInput('') }}
                                          title={configured ? 'Update API key' : 'Set API key'}
                                          style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #444', cursor: 'pointer', background: configured ? '#1a3a1a' : '#111', color: configured ? '#4ade80' : '#888', fontSize: 9, lineHeight: 1.2 }}>
                                          {configured ? 'Update' : 'Set'}
                                        </button>
                                        {configured && (
                                          <button onClick={() => handleCredDelete(service)}
                                            title="Delete credential"
                                            style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #444', cursor: 'pointer', background: '#2a0a0a', color: '#ef4444', fontSize: 9, lineHeight: 1.2 }}>
                                            Del
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {addingCustom ? (
                        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                          <input
                            autoFocus
                            value={customInput}
                            onChange={e => setCustomInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { handleAddCustom(); setAddingCustom(false) }
                              if (e.key === 'Escape') { setAddingCustom(false); setCustomInput('') }
                            }}
                            style={{
                              flex: 1, background: '#0f0f0f', border: '1px solid #555',
                              borderRadius: 3, padding: '3px 6px', fontSize: 11,
                              color: '#ccc', outline: 'none',
                            }}
                            placeholder="Provider name..."
                          />
                          <button onClick={() => { handleAddCustom(); setAddingCustom(false) }}
                            disabled={!customInput.trim()}
                            style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid #444', cursor: 'pointer', background: '#2563eb', color: '#fff', fontSize: 10, lineHeight: 1.3 }}>
                            Add
                          </button>
                          <button onClick={() => { setAddingCustom(false); setCustomInput('') }}
                            style={{ padding: '2px 8px', borderRadius: 3, border: '1px solid #444', cursor: 'pointer', background: '#111', color: '#ccc', fontSize: 10, lineHeight: 1.3 }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setAddingCustom(true)}
                          style={{
                            width: '100%', padding: '3px 0', marginBottom: 6,
                            borderRadius: 3, border: '1px dashed #444',
                            background: 'transparent', color: '#888', fontSize: 11,
                            cursor: 'pointer',
                          }}>
                          + Add provider
                        </button>
                      )}

                      <div style={{ fontSize: 9, color: '#555', lineHeight: 1.4 }}>
                        Keys are encrypted at rest. Click a provider name to rename it.
                      </div>
                    </div>
                  )
                })()
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
