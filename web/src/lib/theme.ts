import { useEffect, useState } from 'react'

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#09090b' : '#fafafa')
    try {
      localStorage.setItem('proxmiu-theme', dark ? 'dark' : 'light')
    } catch {
      /* storage unavailable */
    }
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}
