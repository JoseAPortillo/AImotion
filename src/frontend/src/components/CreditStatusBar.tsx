import { useState, useEffect } from 'react'

interface TierInfo {
  maxMonthlyCreditSpend?: number
  daily_generations?: Record<string, { maxConcurrentGenerations: number; maxDailyGenerations: number }>
  monthly_spend?: number
  monthly_spend_cap?: number
}

interface ProviderCredits {
  configured: boolean
  balance: Record<string, unknown> | null
  cached: Record<string, unknown> | null
  tier_info: TierInfo | null
  low_balance: boolean
}

interface UsageCredit {
  model: string
  amount: number
}

interface UsageDay {
  date: string
  usedCredits: UsageCredit[]
}

interface RunwayUsageResponse {
  results: UsageDay[]
  models: string[]
}

interface DailyEntry {
  date: string
  models: Record<string, number>
}

interface CreditsData {
  providers: Record<string, ProviderCredits>
  total_credits_used: number
  by_provider: Record<string, number>
  recent: Array<{ provider: string; model: string; credits: number; timestamp: string }>
  daily_summary: DailyEntry[]
}

function getBalanceVal(p: ProviderCredits): number | null {
  const b = p.balance?.balance
  if (typeof b === 'number') return b
  const c = p.cached?.balance
  if (typeof c === 'number') return c
  return null
}

function balanceColor(val: number | null): string {
  if (val === null) return '#888'
  if (val < 100) return '#e74c3c'
  if (val < 500) return '#f0ad4e'
  return '#4ade80'
}

function formatNum(n: number | null | undefined): string {
  if (n == null) return '?'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

const STARTUP_DELAY = 3000

export default function CreditStatusBar() {
  const [data, setData] = useState<CreditsData | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [usageData, setUsageData] = useState<Record<string, unknown> | null>(null)

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

  const toggleExpand = () => {
    const next = !expanded
    setExpanded(next)
    if (next) {
      fetch('/credits/usage?provider=runway&days=30')
        .then(r => r.json())
        .then(d => setUsageData(d))
        .catch(() => {})
    }
  }

  const runwayUsage: UsageDay[] = (() => {
    if (!usageData) return []
    const u = (usageData as { usage: RunwayUsageResponse | null }).usage
    return (u?.results ?? []).filter(d => d.usedCredits.length > 0)
  })()

  const configuredProviders = Object.entries(data?.providers ?? {})
    .filter(([, v]) => v.configured)

  if (configuredProviders.length === 0) return null

  const hasAlert = configuredProviders.some(([, p]) => p.low_balance)

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={toggleExpand}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
          color: '#888',
          background: '#111',
          padding: '3px 10px',
          border: hasAlert ? '1px solid #e74c3c' : '1px solid #2a2a2a',
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontWeight: 600, color: '#aaa' }}>Credits</span>
        {configuredProviders.map(([name, p]) => {
          const bal = getBalanceVal(p)
          const used = data?.by_provider[name]
          const color = balanceColor(bal)
          const tier = p.tier_info
          const dailyGens = tier?.daily_generations
          const monthlySpend = tier?.monthly_spend
          const monthlyCap = tier?.monthly_spend_cap

          return (
            <span key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              {p.low_balance && (
                <span style={{ color: '#e74c3c', fontWeight: 700 }} title="Low balance!">!</span>
              )}
              {tier && tier.maxMonthlyCreditSpend != null && (
                <span
                  style={{
                    background: '#222',
                    color: '#aaa',
                    padding: '1px 5px',
                    borderRadius: 3,
                    fontSize: 9,
                    fontWeight: 600,
                  }}
                  title={`Tier: ${JSON.stringify(tier)}`}
                >
                  {typeof tier.maxMonthlyCreditSpend === 'number'
                    ? `$${tier.maxMonthlyCreditSpend / 100}/mo`
                    : 'Tier'}
                </span>
              )}
              <span style={{ color, fontWeight: 600 }}>
                {formatNum(bal)}
              </span>
              {used != null && used > 0 && (
                <span style={{ color: '#666' }}>
                  {formatNum(used)} used
                </span>
              )}
              {dailyGens && Object.entries(dailyGens).map(([model, info]) => (
                <span
                  key={model}
                  style={{ color: '#555', fontSize: 9 }}
                  title={`${model}: ${info.maxDailyGenerations} max/day, ${info.maxConcurrentGenerations} concurrent`}
                >
                  {model}/{info.maxDailyGenerations}
                </span>
              ))}
              {monthlySpend != null && monthlyCap != null && monthlyCap > 0 && (
                <span
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  title={`Monthly: ${formatNum(monthlySpend)} / ${formatNum(monthlyCap)}`}
                >
                  <span style={{
                    width: 40,
                    height: 6,
                    background: '#1a1a1a',
                    display: 'inline-block',
                    overflow: 'hidden',
                  }}>
                    <span style={{
                      width: `${Math.min((monthlySpend / monthlyCap) * 100, 100)}%`,
                      height: '100%',
                      background: monthlySpend / monthlyCap > 0.8 ? '#e74c3c' : '#4ade80',
                      display: 'block',
                      transition: 'width .3s',
                    }} />
                  </span>
                  <span style={{ color: '#555', fontSize: 9 }}>
                    {formatNum(monthlySpend)}/{formatNum(monthlyCap)}
                  </span>
                </span>
              )}
            </span>
          )
        })}
        <span style={{ color: '#444', fontSize: 9, marginLeft: 2 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: '#111',
            border: '1px solid #2a2a2a',
            padding: 10,
            fontSize: 11,
            color: '#888',
            minWidth: 360,
            maxHeight: 400,
            overflowY: 'auto',
            zIndex: 100,
          }}
        >
          {data?.daily_summary && data.daily_summary.length > 0 && (
            <>
              <div style={{ fontWeight: 600, color: '#aaa', marginBottom: 6 }}>Local Usage</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                <thead>
                  <tr style={{ color: '#555', fontSize: 9, textAlign: 'left' }}>
                    <th style={{ padding: '2px 6px' }}>Date</th>
                    <th style={{ padding: '2px 6px' }}>Model</th>
                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily_summary.slice(0, 15).map((day) =>
                    Object.entries(day.models).map(([model, credits], i) => (
                      <tr key={`local-${day.date}-${model}`} style={{ color: '#777' }}>
                        <td style={{ padding: '2px 6px', fontSize: 10 }}>
                          {i === 0 ? day.date : ''}
                        </td>
                        <td style={{ padding: '2px 6px', color: '#f0ad4e', fontSize: 10 }}>
                          {model}
                        </td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', fontSize: 10 }}>
                          {formatNum(credits)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          )}

          {runwayUsage.length > 0 && (
            <>
              <div style={{ fontWeight: 600, color: '#aaa', marginBottom: 6 }}>Runway API Usage</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#555', fontSize: 9, textAlign: 'left' }}>
                    <th style={{ padding: '2px 6px' }}>Date</th>
                    <th style={{ padding: '2px 6px' }}>Model</th>
                    <th style={{ padding: '2px 6px', textAlign: 'right' }}>Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {runwayUsage.slice(0, 15).map((day) =>
                    day.usedCredits.map((uc, i) => (
                      <tr key={`api-${day.date}-${uc.model}`} style={{ color: '#777' }}>
                        <td style={{ padding: '2px 6px', fontSize: 10 }}>
                          {i === 0 ? day.date : ''}
                        </td>
                        <td style={{ padding: '2px 6px', color: '#f0ad4e', fontSize: 10 }}>
                          {uc.model}
                        </td>
                        <td style={{ padding: '2px 6px', textAlign: 'right', fontSize: 10 }}>
                          {formatNum(uc.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          )}

          {(!data?.daily_summary || data.daily_summary.length === 0) && runwayUsage.length === 0 && (
            <div style={{ color: '#555', fontSize: 10 }}>No usage recorded yet</div>
          )}
        </div>
      )}
    </div>
  )
}
