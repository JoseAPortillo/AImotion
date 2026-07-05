import { useCallback } from 'react'

interface NumberInputProps {
  value: number
  onChange: (val: number) => void
  min?: number
  max?: number
  step?: number
  style?: React.CSSProperties
}

const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#ccc',
  cursor: 'pointer',
  fontSize: 11,
  lineHeight: '16px',
  padding: '0 6px',
  height: 22,
  userSelect: 'none',
  flexShrink: 0,
}

export default function NumberInput({ value, onChange, min, max, step = 1, style }: NumberInputProps) {
  const dec = useCallback(() => {
    const next = value - step
    if (min != null && next < min) return
    onChange(next)
  }, [value, step, min, onChange])

  const inc = useCallback(() => {
    const next = value + step
    if (max != null && next > max) return
    onChange(next)
  }, [value, step, max, onChange])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, ...style }}>
      <button type="button" onClick={dec} style={btnStyle}>−</button>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const v = step % 1 !== 0 ? parseFloat(e.target.value) : parseInt(e.target.value, 10)
          if (isNaN(v)) return
          if (min != null && v < min) return
          if (max != null && v > max) return
          onChange(v)
        }}
        style={{
          background: '#0f0f0f',
          border: '1px solid #333',
          borderRadius: 4,
          color: '#ccc',
          padding: '2px 4px',
          fontSize: 10,
          outline: 'none',
          width: '100%',
          textAlign: 'center',
          MozAppearance: 'textfield',
          height: 22,
          boxSizing: 'border-box',
        }}
      />
      <button type="button" onClick={inc} style={btnStyle}>+</button>
    </div>
  )
}
