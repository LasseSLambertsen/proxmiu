import { useId } from 'react'

/** Tiny area chart for a 0–100 series. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const id = useId()
  if (values.length < 2) return <div className={className} />
  const w = 100
  const h = 32
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - (Math.min(100, Math.max(0, v)) / 100) * (h - 2) - 1])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brand)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
