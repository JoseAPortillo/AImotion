import { useToastStore } from '../store/toast'

const typeColors: Record<string, { bg: string; border: string; text: string }> = {
  error: { bg: '#2e0a0a', border: '#7f1d1d', text: '#fca5a5' },
  success: { bg: '#0a2e1a', border: '#166534', text: '#86efac' },
  info: { bg: '#0a0a2e', border: '#1e1e7f', text: '#93c5fd' },
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      maxWidth: 600,
      width: '90%',
    }}>
      {toasts.map((t) => {
        const c = typeColors[t.type]
        return (
          <div
            key={t.id}
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              padding: '10px 14px',
              color: c.text,
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              userSelect: 'text',
              WebkitUserSelect: 'text',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0, userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}>
              {t.message}
            </div>
            <button
              onClick={() => removeToast(t.id)}
              style={{
                background: 'none',
                border: 'none',
                color: c.text,
                opacity: 0.5,
                cursor: 'pointer',
                fontSize: 14,
                padding: '0 2px',
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
