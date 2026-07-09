import { useState, useEffect } from 'react'

interface ProviderCredits {
  configured: boolean
  balance: Record<string, unknown> | null
  cached: Record<string, unknown> | null
}

interface CreditsData {
  providers: Record<string, ProviderCredits>
  total_credits_used: number
  by_provider: Record<string, number>
}

function getBalanceVal(p: ProviderCredits): number | null {
  const b = p.balance?.balance
  if (typeof b === 'number') return b
  const c = p.cached?.balance
  if (typeof c === 'number') return c
  return null
}

const STARTUP_DELAY = 3000

export default function CreditStatusBar() {
  const [data, setData] = useState<CreditsData | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchCredits = () => {
      fetch('/credits')
        .then(r => r.json())
        .then(d => { if (!cancelled) setData(d) })
        .catch(() => {})
    }
    const timer = setTimeout(fetchCredits, STARTUP_DELAY)
    const iv = setInterval(fetchCredits, 30000)
    return () => { cancelled = true; clearTimeout(timer); clearInterval(iv) }
  }, [])

  const configuredProviders = Object.entries(data?.providers ?? {})
    .filter(([, v]) => v.configured)

  if (configuredProviders.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 12,
        color: '#888',
        background: '#111',
        padding: '3px 10px',
        border: '1px solid #2a2a2a',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontWeight: 600, color: '#aaa' }}>Credits</span>
      {configuredProviders.map(([name, p]) => {
        const bal = getBalanceVal(p)
        const used = data?.by_provider[name]
        return (
          <span key={name} style={{ color: '#f0ad4e', fontSize: 11 }}>
            {name}: {bal != null ? `${bal}` : '?'} rem
            {used != null ? ` · ${used} used` : ''}
          </span>
        )
      })}
    </div>
  )
}