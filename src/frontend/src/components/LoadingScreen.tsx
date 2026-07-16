import { useState, useEffect } from 'react'

const SPINNER_KEYFRAMES = `
@keyframes aimation-spin {
  to { transform: rotate(360deg); }
}
`

interface LoadingScreenProps {
  ready: boolean
}

export default function LoadingScreen({ ready }: LoadingScreenProps) {
  const [visible, setVisible] = useState(true)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    if (ready && !fadeOut) {
      setFadeOut(true)
      const timer = setTimeout(() => setVisible(false), 800)
      return () => clearTimeout(timer)
    }
  }, [ready, fadeOut])

  if (!visible) return null

  return (
    <>
      <style>{SPINNER_KEYFRAMES}</style>
      {/* Dark overlay — masked with logo shape so app peeks through the logo */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: '#0f0f0f',
          WebkitMaskImage: 'url(/AImation_logo_3.png)',
          WebkitMaskSize: 'min(70vw, 600px)',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          WebkitMaskComposite: 'xor',
          maskImage: 'url(/AImation_logo_3.png)',
          maskSize: 'min(70vw, 600px)',
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
          maskComposite: 'exclude',
          transition: 'opacity 0.8s ease-out',
          opacity: fadeOut ? 0 : 1,
          pointerEvents: fadeOut ? 'none' : 'auto',
        }}
      />
      {/* Logo + spinner on top */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          transition: 'opacity 0.8s ease-out',
          opacity: fadeOut ? 0 : 1,
        }}
      >
        <img
          src="/AImation_logo_3.png"
          alt="AImation"
          style={{
            width: 'min(70vw, 600px)',
            height: 'auto',
            filter: 'drop-shadow(0 0 60px rgba(74, 222, 128, 0.2))',
          }}
        />
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 24,
        }}>
          <div style={{
            width: 14,
            height: 14,
            border: '2px solid #333',
            borderTopColor: '#4ade80',
            borderRadius: '50%',
            animation: 'aimation-spin 0.8s linear infinite',
          }} />
          <span style={{
            fontSize: 13,
            color: '#555',
            letterSpacing: 1,
            fontWeight: 500,
          }}>
            Loading...
          </span>
        </div>
      </div>
    </>
  )
}
