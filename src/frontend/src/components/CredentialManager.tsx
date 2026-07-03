import { useState, useEffect, useRef } from 'react'

interface CredState {
  [service: string]: { configured: boolean }
}

export default function CredentialManager() {
  const [open, setOpen] = useState(false)
  const [creds, setCreds] = useState<CredState>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [inputVal, setInputVal] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const fetchCreds = () => {
    fetch('/credentials')
      .then(r => r.json())
      .then(d => {
        const map: CredState = {}
        for (const s of (d.services || [])) map[s] = { configured: true }
        setCreds(map)
      })
      .catch(() => {})
  }

  useEffect(() => {
    if (!open) return
    fetchCreds()
    const iv = setInterval(fetchCreds, 5000)
    return () => clearInterval(iv)
  }, [open])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setEditing(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSave = async (service: string) => {
    if (!inputVal.trim()) return
    setSaving(service)
    try {
      await fetch(`/credentials/${service}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: inputVal.trim() }),
      })
      setEditing(null)
      setInputVal('')
      fetchCreds()
    } catch { /* ignore */ }
    setSaving(null)
  }

  const handleDelete = async (service: string) => {
    await fetch(`/credentials/${service}`, { method: 'DELETE' })
    fetchCreds()
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(x => !x)}
        title="Manage API credentials"
        style={{
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid #444',
          fontSize: 12,
          cursor: 'pointer',
          background: '#1a1a1a',
          color: '#ccc',
          lineHeight: 1,
        }}
      >
        🔑 Keys
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            width: 300,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 6,
            zIndex: 100,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            padding: 10,
            fontSize: 12,
            color: '#ccc',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#999' }}>API Credentials</div>
          {['kling', 'seedance', 'runway', 'pika', 'luma'].map(service => {
            const configured = creds[service]?.configured ?? false
            return (
              <div
                key={service}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 0',
                  borderBottom: '1px solid #2a2a2a',
                }}
              >
                <span style={{ flex: 1, textTransform: 'capitalize' }}>{service}</span>
                {editing === service ? (
                  <div style={{ display: 'flex', gap: 4, flex: 1, justifyContent: 'flex-end' }}>
                    <input
                      autoFocus
                      type="password"
                      value={inputVal}
                      onChange={e => setInputVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSave(service); if (e.key === 'Escape') { setEditing(null); setInputVal('') } }}
                      style={{
                        flex: 1,
                        background: '#0f0f0f',
                        border: '1px solid #555',
                        borderRadius: 3,
                        padding: '2px 4px',
                        fontSize: 11,
                        color: '#ccc',
                        outline: 'none',
                      }}
                      placeholder="Paste API key..."
                    />
                    <button onClick={() => handleSave(service)} disabled={saving === service} style={{ ...btnStyle, background: '#4ade80', color: '#0f0f0f' }}>
                      {saving === service ? '...' : 'Save'}
                    </button>
                    <button onClick={() => { setEditing(null); setInputVal('') }} style={btnStyle}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: configured ? '#4ade80' : '#666' }}>
                      {configured ? '✓ configured' : '—'}
                    </span>
                    <button
                      onClick={() => { setEditing(service); setInputVal('') }}
                      style={{ ...btnStyle, color: '#888', fontSize: 10 }}
                    >
                      {configured ? 'Update' : 'Set'}
                    </button>
                    {configured && (
                      <button onClick={() => handleDelete(service)} style={{ ...btnStyle, color: '#ef4444', fontSize: 10 }}>Del</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ marginTop: 8, fontSize: 9, color: '#555' }}>
            Keys are encrypted at rest. Used by cloud providers (Kling, Seedance, etc.).
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 3,
  border: '1px solid #444',
  cursor: 'pointer',
  background: '#111',
  lineHeight: 1.3,
}
